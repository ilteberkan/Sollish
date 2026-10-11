//! Coinflip outcome verification and house settlement using scoped MagicBlock VRF.
//!
//! A request, house reservation, and player nonce commit atomically. The callback
//! only records randomness; permissionless settlement computes the fixed payout.
//! There is no administrator outcome, reroll, timeout refund, or Crash shortcut.
//! Player activity is bounded observational state, not a token claim or promise.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::Discriminator;
use ephemeral_vrf_sdk::anchor::VrfProgram;
use ephemeral_vrf_sdk::consts::{scoped_vrf_identity, DEFAULT_QUEUE, IDENTITY, VRF_PROGRAM_ID};
use ephemeral_vrf_sdk::instructions::{
    create_request_scoped_randomness_ix, RequestRandomnessParams,
};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

declare_id!("8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ");

pub const MAX_EDGE_BPS: u16 = 500;
pub const COINFLIP_AWAITING: u8 = 0;
pub const COINFLIP_READY: u8 = 1;
pub const COINFLIP_SETTLED: u8 = 2;
pub const UNUSED_ACTIVITY_EPOCH: u64 = u64::MAX;

#[program]
pub mod games {
    use super::*;

    pub fn initialize_coinflip(ctx: Context<InitializeCoinflip>, edge_bps: u16) -> Result<()> {
        require!(edge_bps <= MAX_EDGE_BPS, GameError::InvalidHouseEdge);
        let config = &mut ctx.accounts.config;
        config.house = ctx.accounts.house.key();
        config.queue = ctx.accounts.oracle_queue.key();
        config.edge_bps = edge_bps;
        config.bump = ctx.bumps.config;
        emit!(CoinflipInitialized {
            config: config.key(),
            house: config.house,
            queue: config.queue,
            edge_bps,
        });
        Ok(())
    }

    /// Permanent activity summary. It cannot be reset or closed, and creates no
    /// token entitlement. Initialize it before accepting the player's first bet.
    pub fn initialize_activity(ctx: Context<InitializeActivity>) -> Result<()> {
        let activity = &mut ctx.accounts.activity;
        let now = Clock::get()?.unix_timestamp;
        let epoch = activity_epoch(now).unwrap_or(0);
        activity.house = ctx.accounts.house.key();
        activity.player = ctx.accounts.player.key();
        activity.total_wagered_lamports = 0;
        activity.total_payout_lamports = 0;
        activity.settled_bets = 0;
        activity.last_settled_at = 0;
        activity.current = ActivityBucket::empty(epoch);
        activity.previous = ActivityBucket::empty(UNUSED_ACTIVITY_EPOCH);
        activity.bump = ctx.bumps.activity;
        emit!(ActivityInitialized {
            house: activity.house,
            player: activity.player,
            activity: activity.key(),
            current_epoch: epoch,
        });
        Ok(())
    }

    pub fn place_coinflip(
        ctx: Context<PlaceCoinflip>,
        id: u64,
        side: u8,
        stake: u64,
    ) -> Result<()> {
        place_coinflip_impl(ctx.accounts, &ctx.bumps, id, side, stake)
    }

    /// Explicit opt-in: reward reservation and a real escrow/VRF admission are
    /// atomic. Settlement does not require any token or reward accounts.
    pub fn place_coinflip_rewarded(
        ctx: Context<PlaceCoinflipRewarded>,
        id: u64,
        side: u8,
        stake: u64,
        epoch: u64,
    ) -> Result<()> {
        place_coinflip_impl(&mut ctx.accounts.game, &ctx.bumps.game, id, side, stake)?;
        let house = ctx.accounts.game.house.key();
        let bump = [ctx.bumps.incentives_authority];
        let seeds: &[&[u8]] = &[b"incentives_authority", house.as_ref(), &bump];
        incentives::cpi::credit_wager(
            CpiContext::new_with_signer(
                ctx.accounts.incentives_program.key(),
                incentives::cpi::accounts::CreditWager {
                    player: ctx.accounts.game.player.to_account_info(),
                    phase: ctx.accounts.reward_phase.to_account_info(),
                    game_program: ctx.accounts.game.game_program.to_account_info(),
                    game_authority: ctx.accounts.incentives_authority.to_account_info(),
                    player_rewards: ctx.accounts.player_rewards.to_account_info(),
                    epoch_state: ctx.accounts.epoch_state.to_account_info(),
                    participant: ctx.accounts.participant.to_account_info(),
                    system_program: ctx.accounts.game.system_program.to_account_info(),
                },
                &[seeds],
            ),
            epoch,
            stake,
            ctx.accounts.game.bet.key(),
        )?;
        Ok(())
    }

    /// ABI: discriminator || randomness[32] || stored callback arguments (id, tag).
    /// The provider adds its scoped identity signer before our callback accounts.
    pub fn consume_randomness(
        ctx: Context<ConsumeRandomness>,
        randomness: [u8; 32],
        id: u64,
        request_tag: [u8; 32],
    ) -> Result<()> {
        let bet = &mut ctx.accounts.bet;
        require!(
            bet.status == COINFLIP_AWAITING,
            GameError::RandomnessAlreadyConsumed
        );
        require!(bet.id == id, GameError::WrongRequest);
        require!(
            bet.request_tag == request_tag && request_tag == bet.key().to_bytes(),
            GameError::WrongRequest
        );
        bet.randomness = randomness;
        bet.status = COINFLIP_READY;
        emit!(CoinflipReady {
            bet: bet.key(),
            player: bet.player,
            id,
            request_tag,
        });
        Ok(())
    }

    /// Anyone may trigger a ready bet; no caller supplies a result or payout.
    /// Activity recording and SOL payout commit atomically. Activity is not a
    /// token entitlement; no funded rewards phase or token claim exists yet.
    pub fn settle_coinflip(ctx: Context<SettleCoinflip>) -> Result<()> {
        let bet = &mut ctx.accounts.bet;
        require!(bet.status == COINFLIP_READY, GameError::BetNotReady);
        let winning_side = bet.randomness[0] & 1;
        let payout = if bet.side == winning_side {
            bet.max_gross
        } else {
            0
        };
        let settled_at = Clock::get()?.unix_timestamp;
        let hour_recorded =
            record_activity(&mut ctx.accounts.activity, bet.stake, payout, settled_at)?;
        bet.payout = payout;
        bet.settled_at = settled_at;
        bet.hour_recorded = hour_recorded;
        bet.status = COINFLIP_SETTLED;

        let house_key = ctx.accounts.house.key();
        let authority_bump = [ctx.bumps.house_authority];
        let authority_seeds: &[&[u8]] = &[b"house_authority", house_key.as_ref(), &authority_bump];
        house::cpi::settle_bet(
            CpiContext::new_with_signer(
                ctx.accounts.house_program.key(),
                house::cpi::accounts::SettleBet {
                    player: ctx.accounts.player.to_account_info(),
                    config: ctx.accounts.house.to_account_info(),
                    shard: ctx.accounts.shard.to_account_info(),
                    bet: ctx.accounts.house_bet.to_account_info(),
                    game_program: ctx.accounts.game_program.to_account_info(),
                    game_authority: ctx.accounts.house_authority.to_account_info(),
                },
                &[authority_seeds],
            ),
            payout,
        )?;
        // No typed cache of the foreign receipt is used after settlement. The
        // house reloads and verifies its settled state in this second CPI.
        house::cpi::close_bet(CpiContext::new_with_signer(
            ctx.accounts.house_program.key(),
            house::cpi::accounts::CloseBet {
                player: ctx.accounts.player.to_account_info(),
                config: ctx.accounts.house.to_account_info(),
                bet: ctx.accounts.house_bet.to_account_info(),
                game_program: ctx.accounts.game_program.to_account_info(),
                game_authority: ctx.accounts.house_authority.to_account_info(),
                player_ledger: ctx.accounts.player_ledger.to_account_info(),
            },
            &[authority_seeds],
        ))?;
        emit!(CoinflipSettled {
            house: bet.house,
            shard: bet.shard,
            bet: bet.key(),
            player: bet.player,
            id: bet.id,
            stake: bet.stake,
            payout,
            side: bet.side,
            winning_side,
            settled_at,
            hour_recorded,
        });
        Ok(())
    }

    /// Permissionless rent recovery after the settled outcome was included in
    /// permanent activity. Future token rights must be persisted before this
    /// path can be used in a funded rewards phase; none exist in this version.
    pub fn close_coinflip(ctx: Context<CloseCoinflip>) -> Result<()> {
        let bet = &ctx.accounts.bet;
        let activity = &ctx.accounts.activity;
        require!(bet.status == COINFLIP_SETTLED, GameError::BetNotSettled);
        require!(
            bet.id > 0 && ctx.accounts.player_ledger.last_bet_id >= bet.id,
            GameError::InvalidBetNonce
        );
        // These are consistency checks. The exactly-once guarantee comes from
        // this program only writing SETTLED in the same transaction as activity,
        // and the house ledger permanently preventing reuse of this bet ID.
        require!(
            activity.settled_bets > 0
                && activity.total_wagered_lamports >= u128::from(bet.stake)
                && activity.total_payout_lamports >= u128::from(bet.payout)
                && activity.last_settled_at >= bet.settled_at,
            GameError::ActivityNotRecorded
        );
        require_keys_neq!(
            bet.key(),
            ctx.accounts.player.key(),
            GameError::InvalidCloseRecipient
        );
        let returned_lamports = bet.to_account_info().lamports();
        ctx.accounts
            .player
            .to_account_info()
            .lamports()
            .checked_add(returned_lamports)
            .ok_or(GameError::CloseTransferOverflow)?;
        emit!(CoinflipClosed {
            config: bet.config,
            house: bet.house,
            shard: bet.shard,
            bet: bet.key(),
            player: bet.player,
            id: bet.id,
            stake: bet.stake,
            max_gross: bet.max_gross,
            side: bet.side,
            winning_side: bet.randomness[0] & 1,
            randomness: bet.randomness,
            request_tag: bet.request_tag,
            payout: bet.payout,
            created_at: bet.created_at,
            settled_at: bet.settled_at,
            hour_recorded: bet.hour_recorded,
            returned_lamports,
        });
        Ok(())
    }
}

fn place_coinflip_impl(
    accounts: &mut PlaceCoinflip<'_>,
    bumps: &PlaceCoinflipBumps,
    id: u64,
    side: u8,
    stake: u64,
) -> Result<()> {
    require!(side <= 1, GameError::InvalidSide);
    require!(stake > 0, GameError::InvalidStake);
    let max_gross = game_math::coinflip_payout_lamports(stake, accounts.config.edge_bps)
        .map_err(|_| error!(GameError::PayoutOverflow))?;
    require!(max_gross >= stake, GameError::InvalidGrossPayout);

    let bet = &mut accounts.bet;
    bet.config = accounts.config.key();
    bet.house = accounts.house.key();
    bet.shard = accounts.shard.key();
    bet.player = accounts.player.key();
    bet.id = id;
    bet.stake = stake;
    bet.max_gross = max_gross;
    // The PDA is unique across game/house/player/nonce and domain-separated
    // by the "coinflip" seed. The same tag binds the request and callback.
    bet.request_tag = bet.key().to_bytes();
    bet.randomness = [0; 32];
    bet.payout = 0;
    // Observation timestamp only: it grants no timeout refund or reroll right.
    bet.created_at = Clock::get()?.unix_timestamp;
    bet.settled_at = 0;
    bet.hour_recorded = false;
    bet.side = side;
    bet.status = COINFLIP_AWAITING;
    bet.bump = bumps.bet;

    let house_key = accounts.house.key();
    let authority_bump = [bumps.house_authority];
    let authority_seeds: &[&[u8]] = &[b"house_authority", house_key.as_ref(), &authority_bump];
    house::cpi::reserve_bet(
        CpiContext::new_with_signer(
            accounts.house_program.key(),
            house::cpi::accounts::ReserveBet {
                player: accounts.player.to_account_info(),
                config: accounts.house.to_account_info(),
                shard: accounts.shard.to_account_info(),
                bet: accounts.house_bet.to_account_info(),
                game_program: accounts.game_program.to_account_info(),
                game_authority: accounts.house_authority.to_account_info(),
                system_program: accounts.system_program.to_account_info(),
                player_ledger: accounts.player_ledger.to_account_info(),
            },
            &[authority_seeds],
        ),
        id,
        stake,
        max_gross,
    )?;

    let mut callback_args = Vec::with_capacity(40);
    callback_args.extend_from_slice(&id.to_le_bytes());
    callback_args.extend_from_slice(&bet.request_tag);
    let request = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: accounts.player.key(),
        oracle_queue: accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: instruction::ConsumeRandomness::DISCRIMINATOR.to_vec(),
        accounts_metas: Some(vec![
            SerializableAccountMeta {
                pubkey: accounts.config.key(),
                is_signer: false,
                is_writable: false,
            },
            SerializableAccountMeta {
                pubkey: bet.key(),
                is_signer: false,
                is_writable: true,
            },
        ]),
        caller_seed: bet.request_tag,
        callback_args: Some(callback_args),
    });
    let identity_bump = [bumps.program_identity];
    invoke_signed(
        &request,
        &[
            accounts.player.to_account_info(),
            accounts.program_identity.to_account_info(),
            accounts.oracle_queue.to_account_info(),
            accounts.system_program.to_account_info(),
            accounts.slot_hashes.to_account_info(),
            accounts.vrf_program.to_account_info(),
        ],
        &[&[IDENTITY, &identity_bump]],
    )?;
    emit!(CoinflipPlaced {
        house: bet.house,
        shard: bet.shard,
        bet: bet.key(),
        player: bet.player,
        id,
        stake,
        side,
        max_gross,
        request_tag: bet.request_tag,
        created_at: bet.created_at,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeCoinflip<'info> {
    #[account(mut, address = house.authority @ GameError::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"house", house.authority.as_ref()], bump = house.bump,
        seeds::program = house::ID, constraint = house.game_program == crate::ID @ GameError::WrongGameProgram)]
    pub house: Account<'info, house::HouseConfig>,
    #[account(init, payer = authority, space = 8 + CoinflipConfig::INIT_SPACE,
        seeds = [b"coinflip_config", house.key().as_ref()], bump)]
    pub config: Account<'info, CoinflipConfig>,
    /// CHECK: Only the SDK's pinned L1 devnet queue, owned by the pinned VRF program.
    #[account(address = DEFAULT_QUEUE @ GameError::WrongQueue, owner = VRF_PROGRAM_ID @ GameError::WrongQueueOwner)]
    pub oracle_queue: UncheckedAccount<'info>,
    pub vrf_program: Program<'info, VrfProgram>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeActivity<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [b"house", house.authority.as_ref()], bump = house.bump,
        seeds::program = house::ID, constraint = house.game_program == crate::ID @ GameError::WrongGameProgram)]
    pub house: Account<'info, house::HouseConfig>,
    #[account(init, payer = player, space = 8 + GamePlayerActivity::INIT_SPACE,
        seeds = [b"activity", house.key().as_ref(), player.key().as_ref()], bump)]
    pub activity: Account<'info, GamePlayerActivity>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct PlaceCoinflip<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [b"house", house.authority.as_ref()], bump = house.bump,
        seeds::program = house::ID, constraint = house.game_program == crate::ID @ GameError::WrongGameProgram)]
    pub house: Account<'info, house::HouseConfig>,
    #[account(seeds = [b"coinflip_config", house.key().as_ref()], bump = config.bump,
        has_one = house @ GameError::WrongHouse)]
    pub config: Account<'info, CoinflipConfig>,
    #[account(mut, seeds = [b"shard", house.key().as_ref(), &shard.id.to_le_bytes()],
        bump = shard.bump, seeds::program = house::ID,
        constraint = shard.config == house.key() @ GameError::WrongHouse)]
    pub shard: Account<'info, house::HouseShard>,
    /// CHECK: Canonical uninitialized receipt; the house CPI initializes/validates it.
    #[account(mut, seeds = [b"bet", house.key().as_ref(), player.key().as_ref(), &id.to_le_bytes()],
        bump, seeds::program = house::ID)]
    pub house_bet: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"player", house.key().as_ref(), player.key().as_ref()],
        bump = player_ledger.bump, seeds::program = house::ID,
        constraint = player_ledger.config == house.key() @ GameError::WrongHouse,
        has_one = player @ GameError::WrongPlayer)]
    pub player_ledger: Account<'info, house::PlayerLedger>,
    #[account(init, payer = player, space = 8 + CoinflipBet::INIT_SPACE,
        seeds = [b"coinflip", house.key().as_ref(), player.key().as_ref(), &id.to_le_bytes()], bump)]
    pub bet: Account<'info, CoinflipBet>,
    /// CHECK: This executable program must be supplied to authenticate the house CPI.
    #[account(address = crate::ID, executable)]
    pub game_program: UncheckedAccount<'info>,
    /// CHECK: This program signs the canonical house authority PDA only for house CPI.
    #[account(seeds = [b"house_authority", house.key().as_ref()], bump)]
    pub house_authority: UncheckedAccount<'info>,
    /// CHECK: This program signs its request identity only for the pinned VRF CPI.
    #[account(seeds = [IDENTITY], bump)]
    pub program_identity: UncheckedAccount<'info>,
    /// CHECK: Pinned queue identity and owner; SDK/provider validates its queue data.
    #[account(mut, address = DEFAULT_QUEUE @ GameError::WrongQueue,
        owner = VRF_PROGRAM_ID @ GameError::WrongQueueOwner,
        constraint = oracle_queue.key() == config.queue @ GameError::WrongQueue)]
    pub oracle_queue: UncheckedAccount<'info>,
    pub vrf_program: Program<'info, VrfProgram>,
    /// CHECK: Required fixed sysvar account; data is consumed by the VRF program.
    #[account(address = ephemeral_vrf_sdk::compat::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub house_program: Program<'info, house::program::House>,
    pub system_program: Program<'info, System>,
    // Require the permanent summary before accepting funds: settlement must
    // never need a fresh player signature to initialize a missing account.
    #[account(seeds = [b"activity", house.key().as_ref(), player.key().as_ref()],
        bump = activity.bump, has_one = house @ GameError::WrongHouse,
        has_one = player @ GameError::WrongPlayer)]
    pub activity: Account<'info, GamePlayerActivity>,
}

#[derive(Accounts)]
pub struct ConsumeRandomness<'info> {
    #[account(address = scoped_vrf_identity(&crate::ID) @ GameError::UnauthorizedOracle)]
    pub vrf_program_identity: Signer<'info>,
    #[account(seeds = [b"coinflip_config", config.house.as_ref()], bump = config.bump)]
    pub config: Account<'info, CoinflipConfig>,
    #[account(mut, seeds = [b"coinflip", bet.house.as_ref(), bet.player.as_ref(), &bet.id.to_le_bytes()],
        bump = bet.bump, has_one = config @ GameError::WrongConfig,
        constraint = bet.house == config.house @ GameError::WrongHouse)]
    pub bet: Account<'info, CoinflipBet>,
}

#[derive(Accounts)]
pub struct SettleCoinflip<'info> {
    /// CHECK: Exact player recorded before randomness; receiving requires no signature.
    #[account(mut, address = bet.player @ GameError::WrongPlayer)]
    pub player: UncheckedAccount<'info>,
    #[account(seeds = [b"house", house.authority.as_ref()], bump = house.bump,
        seeds::program = house::ID, constraint = house.game_program == crate::ID @ GameError::WrongGameProgram)]
    pub house: Account<'info, house::HouseConfig>,
    #[account(seeds = [b"coinflip_config", house.key().as_ref()], bump = config.bump,
        has_one = house @ GameError::WrongHouse)]
    pub config: Account<'info, CoinflipConfig>,
    #[account(mut, seeds = [b"shard", house.key().as_ref(), &shard.id.to_le_bytes()],
        bump = shard.bump, seeds::program = house::ID,
        constraint = shard.config == house.key() @ GameError::WrongHouse,
        address = bet.shard @ GameError::WrongShard)]
    pub shard: Account<'info, house::HouseShard>,
    /// CHECK: Canonical house-owned receipt; the two house CPIs validate its data.
    #[account(mut, seeds = [b"bet", house.key().as_ref(), player.key().as_ref(), &bet.id.to_le_bytes()],
        bump, seeds::program = house::ID, owner = house::ID)]
    pub house_bet: UncheckedAccount<'info>,
    #[account(seeds = [b"player", house.key().as_ref(), player.key().as_ref()],
        bump = player_ledger.bump, seeds::program = house::ID,
        constraint = player_ledger.config == house.key() @ GameError::WrongHouse,
        has_one = player @ GameError::WrongPlayer)]
    pub player_ledger: Account<'info, house::PlayerLedger>,
    #[account(mut, seeds = [b"coinflip", house.key().as_ref(), player.key().as_ref(), &bet.id.to_le_bytes()],
        bump = bet.bump, has_one = config @ GameError::WrongConfig,
        has_one = house @ GameError::WrongHouse, has_one = player @ GameError::WrongPlayer)]
    pub bet: Account<'info, CoinflipBet>,
    /// CHECK: Exact executable caller program used by house CPI authorization.
    #[account(address = crate::ID, executable)]
    pub game_program: UncheckedAccount<'info>,
    /// CHECK: This program's canonical house capability, used only for house CPI.
    #[account(seeds = [b"house_authority", house.key().as_ref()], bump)]
    pub house_authority: UncheckedAccount<'info>,
    pub house_program: Program<'info, house::program::House>,
    #[account(mut, seeds = [b"activity", house.key().as_ref(), player.key().as_ref()],
        bump = activity.bump, has_one = house @ GameError::WrongHouse,
        has_one = player @ GameError::WrongPlayer)]
    pub activity: Account<'info, GamePlayerActivity>,
}

#[derive(Accounts)]
pub struct PlaceCoinflipRewarded<'info> {
    pub game: PlaceCoinflip<'info>,
    #[account(mut, constraint = reward_phase.house == game.house.key() @ GameError::WrongHouse,
        constraint = reward_phase.game_program == crate::ID @ GameError::WrongGameProgram)]
    pub reward_phase: Account<'info, incentives::RewardPhase>,
    /// CHECK: This program's scoped admission-only capability.
    #[account(seeds = [b"incentives_authority", game.house.key().as_ref()], bump)]
    pub incentives_authority: UncheckedAccount<'info>,
    /// CHECK: Canonical reward accounts are initialized/validated by incentives CPI.
    #[account(mut, seeds = [b"reward_user", reward_phase.key().as_ref(), game.player.key().as_ref()], bump, seeds::program = incentives::ID)]
    pub player_rewards: UncheckedAccount<'info>,
    /// CHECK: Global epoch seal and counters are checked by incentives CPI.
    #[account(mut)]
    pub epoch_state: UncheckedAccount<'info>,
    /// CHECK: Player's epoch receipt is checked by incentives CPI.
    #[account(mut)]
    pub participant: UncheckedAccount<'info>,
    pub incentives_program: Program<'info, incentives::program::Incentives>,
}

#[derive(Accounts)]
pub struct CloseCoinflip<'info> {
    /// CHECK: The recorded player receives receipt rent/donations without signing.
    #[account(mut, address = bet.player @ GameError::WrongPlayer)]
    pub player: UncheckedAccount<'info>,
    #[account(seeds = [b"house", house.authority.as_ref()], bump = house.bump,
        seeds::program = house::ID, constraint = house.game_program == crate::ID @ GameError::WrongGameProgram)]
    pub house: Account<'info, house::HouseConfig>,
    #[account(mut, close = player,
        seeds = [b"coinflip", house.key().as_ref(), player.key().as_ref(), &bet.id.to_le_bytes()],
        bump = bet.bump, has_one = house @ GameError::WrongHouse,
        has_one = player @ GameError::WrongPlayer)]
    pub bet: Account<'info, CoinflipBet>,
    #[account(seeds = [b"player", house.key().as_ref(), player.key().as_ref()],
        bump = player_ledger.bump, seeds::program = house::ID,
        constraint = player_ledger.config == house.key() @ GameError::WrongHouse,
        has_one = player @ GameError::WrongPlayer)]
    pub player_ledger: Account<'info, house::PlayerLedger>,
    #[account(seeds = [b"activity", house.key().as_ref(), player.key().as_ref()],
        bump = activity.bump, has_one = house @ GameError::WrongHouse,
        has_one = player @ GameError::WrongPlayer)]
    pub activity: Account<'info, GamePlayerActivity>,
}

#[account]
#[derive(InitSpace)]
pub struct CoinflipConfig {
    pub house: Pubkey,
    pub queue: Pubkey,
    pub edge_bps: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct CoinflipBet {
    pub config: Pubkey,
    pub house: Pubkey,
    pub shard: Pubkey,
    pub player: Pubkey,
    pub id: u64,
    pub stake: u64,
    pub max_gross: u64,
    pub request_tag: [u8; 32],
    pub randomness: [u8; 32],
    pub payout: u64,
    pub created_at: i64,
    pub settled_at: i64,
    pub hour_recorded: bool,
    pub side: u8,
    pub status: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct GamePlayerActivity {
    pub house: Pubkey,
    pub player: Pubkey,
    pub total_wagered_lamports: u128,
    pub total_payout_lamports: u128,
    pub settled_bets: u64,
    /// Maximum observed settlement timestamp, not an expiry or refund deadline.
    pub last_settled_at: i64,
    pub current: ActivityBucket,
    pub previous: ActivityBucket,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy)]
pub struct ActivityBucket {
    pub epoch: u64,
    pub wagered_lamports: u128,
    pub bet_count: u64,
}

impl ActivityBucket {
    fn empty(epoch: u64) -> Self {
        Self {
            epoch,
            wagered_lamports: 0,
            bet_count: 0,
        }
    }
}

fn activity_epoch(timestamp: i64) -> Option<u64> {
    u64::try_from(timestamp).ok().map(|seconds| seconds / 3_600)
}

/// Observational UTC-hour buckets only: two buckets cannot represent an exact
/// rolling 60-minute total or preserve an offline user's funded token rights.
fn record_activity(
    activity: &mut GamePlayerActivity,
    stake: u64,
    payout: u64,
    now: i64,
) -> Result<bool> {
    activity.total_wagered_lamports = activity
        .total_wagered_lamports
        .checked_add(u128::from(stake))
        .ok_or(GameError::ActivityOverflow)?;
    activity.total_payout_lamports = activity
        .total_payout_lamports
        .checked_add(u128::from(payout))
        .ok_or(GameError::ActivityOverflow)?;
    activity.settled_bets = activity
        .settled_bets
        .checked_add(1)
        .ok_or(GameError::ActivityOverflow)?;
    activity.last_settled_at = activity.last_settled_at.max(now);

    let Some(epoch) = activity_epoch(now) else {
        return Ok(false);
    };
    if epoch > activity.current.epoch {
        activity.previous = if epoch - activity.current.epoch == 1 {
            activity.current
        } else {
            ActivityBucket::empty(epoch - 1)
        };
        activity.current = ActivityBucket::empty(epoch);
    }
    let bucket = if epoch == activity.current.epoch {
        &mut activity.current
    } else if epoch == activity.previous.epoch {
        &mut activity.previous
    } else {
        // A clock regression outside our retained window does not block payment
        // or erase a newer hour. Lifetime counters still include the outcome.
        return Ok(false);
    };
    bucket.wagered_lamports = bucket
        .wagered_lamports
        .checked_add(u128::from(stake))
        .ok_or(GameError::ActivityOverflow)?;
    bucket.bet_count = bucket
        .bet_count
        .checked_add(1)
        .ok_or(GameError::ActivityOverflow)?;
    Ok(true)
}

#[event]
pub struct CoinflipInitialized {
    pub config: Pubkey,
    pub house: Pubkey,
    pub queue: Pubkey,
    pub edge_bps: u16,
}

#[event]
pub struct ActivityInitialized {
    pub house: Pubkey,
    pub player: Pubkey,
    pub activity: Pubkey,
    pub current_epoch: u64,
}

#[event]
pub struct CoinflipPlaced {
    pub house: Pubkey,
    pub shard: Pubkey,
    pub bet: Pubkey,
    pub player: Pubkey,
    pub id: u64,
    pub stake: u64,
    pub side: u8,
    pub max_gross: u64,
    pub request_tag: [u8; 32],
    pub created_at: i64,
}

#[event]
pub struct CoinflipReady {
    pub bet: Pubkey,
    pub player: Pubkey,
    pub id: u64,
    pub request_tag: [u8; 32],
}

#[event]
pub struct CoinflipSettled {
    pub house: Pubkey,
    pub shard: Pubkey,
    pub bet: Pubkey,
    pub player: Pubkey,
    pub id: u64,
    pub stake: u64,
    pub payout: u64,
    pub side: u8,
    pub winning_side: u8,
    pub settled_at: i64,
    pub hour_recorded: bool,
}

#[event]
pub struct CoinflipClosed {
    pub config: Pubkey,
    pub house: Pubkey,
    pub shard: Pubkey,
    pub bet: Pubkey,
    pub player: Pubkey,
    pub id: u64,
    pub stake: u64,
    pub max_gross: u64,
    pub side: u8,
    pub winning_side: u8,
    pub randomness: [u8; 32],
    pub request_tag: [u8; 32],
    pub payout: u64,
    pub created_at: i64,
    pub settled_at: i64,
    pub hour_recorded: bool,
    pub returned_lamports: u64,
}

#[error_code]
pub enum GameError {
    #[msg("House edge must be between zero and 500 basis points")]
    InvalidHouseEdge,
    #[msg("Only the house authority may initialize its Coinflip configuration")]
    UnauthorizedAuthority,
    #[msg("The house is not configured to authorize this game program")]
    WrongGameProgram,
    #[msg("Account belongs to a different house")]
    WrongHouse,
    #[msg("Account belongs to a different Coinflip configuration")]
    WrongConfig,
    #[msg("The bet belongs to a different house shard")]
    WrongShard,
    #[msg("Player does not match the immutable recorded player")]
    WrongPlayer,
    #[msg("Only the pinned default VRF queue is supported")]
    WrongQueue,
    #[msg("VRF queue is not owned by the pinned VRF program")]
    WrongQueueOwner,
    #[msg("Coinflip side must be zero or one")]
    InvalidSide,
    #[msg("Coinflip stake must be greater than zero")]
    InvalidStake,
    #[msg("Winning gross payout cannot be represented in lamports")]
    PayoutOverflow,
    #[msg("Winning gross payout must cover the wager stake")]
    InvalidGrossPayout,
    #[msg("Callback must be signed by this game's scoped VRF identity")]
    UnauthorizedOracle,
    #[msg("Randomness may be recorded only once while the bet is awaiting it")]
    RandomnessAlreadyConsumed,
    #[msg("Callback ID or request tag does not match the pending request")]
    WrongRequest,
    #[msg("Coinflip has no unconsumed verified randomness available for settlement")]
    BetNotReady,
    #[msg("Player activity counter overflowed")]
    ActivityOverflow,
    #[msg("Only a settled Coinflip receipt may be closed")]
    BetNotSettled,
    #[msg("Permanent player activity is inconsistent with this settled receipt")]
    ActivityNotRecorded,
    #[msg("The permanent house ledger has not consumed this bet nonce")]
    InvalidBetNonce,
    #[msg("Returning receipt lamports would overflow the player's balance")]
    CloseTransferOverflow,
    #[msg("The receipt and its close recipient must be different accounts")]
    InvalidCloseRecipient,
}
