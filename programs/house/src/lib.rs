//! SOL custody and collateral reservation for an immutable, authorized game program.
//!
//! This program does not select game outcomes or provide randomness. Only the game
//! program's canonical CPI signer can reserve or settle wagers. Game upgrades are
//! therefore part of the custody trust boundary even though its address is fixed.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use game_math::{available_collateral_lamports, reserved_liability_lamports};

declare_id!("9bHnYHRGiNP8umiqtpAsALJYgcAJu3dKWVE1voGfqAu2");

pub const BET_OPEN: u8 = 0;
pub const BET_SETTLED: u8 = 1;

#[program]
pub mod house {
    use super::*;

    pub fn initialize_house(ctx: Context<InitializeHouse>, game_program: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.game_program.key(),
            game_program,
            HouseError::UnauthorizedGameProgram
        );
        require!(
            game_program != crate::ID && game_program != system_program::ID,
            HouseError::InvalidGameProgram
        );
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.game_program = game_program;
        config.paused = false;
        config.bump = ctx.bumps.config;
        emit!(HouseInitialized {
            config: config.key(),
            authority: config.authority,
            game_program,
        });
        Ok(())
    }

    /// One permanent replay-protection account per player and house configuration.
    /// It cannot be closed or reset, even after all of the player's bets settle.
    pub fn initialize_player(ctx: Context<InitializePlayer>) -> Result<()> {
        let ledger = &mut ctx.accounts.player_ledger;
        ledger.config = ctx.accounts.config.key();
        ledger.player = ctx.accounts.player.key();
        ledger.last_bet_id = 0;
        ledger.bump = ctx.bumps.player_ledger;
        emit!(PlayerInitialized {
            config: ledger.config,
            player: ledger.player,
            player_ledger: ledger.key(),
        });
        Ok(())
    }

    pub fn create_shard(
        ctx: Context<CreateShard>,
        id: u16,
        funding: u64,
        buffer: u64,
        max_stake: u64,
        max_gross: u64,
    ) -> Result<()> {
        require!(
            max_stake > 0 && max_gross >= max_stake,
            HouseError::InvalidShardLimits
        );
        require!(funding >= buffer, HouseError::InsufficientInitialFunding);
        let shard = &mut ctx.accounts.shard;
        shard.config = ctx.accounts.config.key();
        shard.id = id;
        shard.buffer = buffer;
        shard.max_stake = max_stake;
        shard.max_gross = max_gross;
        shard.reserved = 0;
        shard.open_bets = 0;
        shard.total_bets = 0;
        shard.bump = ctx.bumps.shard;

        if funding > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    Transfer {
                        from: ctx.accounts.authority.to_account_info(),
                        to: shard.to_account_info(),
                    },
                ),
                funding,
            )?;
        }
        free_collateral(shard)?;
        emit!(ShardCreated {
            config: shard.config,
            shard: shard.key(),
            id,
            funding,
            buffer,
            max_stake,
            max_gross,
        });
        Ok(())
    }

    /// Contributions are house capital, not deposits with a redemption claim.
    pub fn fund_shard(ctx: Context<FundShard>, amount: u64) -> Result<()> {
        require!(amount > 0, HouseError::AmountMustBePositive);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.funder.to_account_info(),
                    to: ctx.accounts.shard.to_account_info(),
                },
            ),
            amount,
        )?;
        free_collateral(&ctx.accounts.shard)?;
        emit!(ShardFunded {
            config: ctx.accounts.config.key(),
            shard: ctx.accounts.shard.key(),
            funder: ctx.accounts.funder.key(),
            amount,
        });
        Ok(())
    }

    pub fn withdraw_free(ctx: Context<WithdrawFree>, amount: u64) -> Result<()> {
        require!(amount > 0, HouseError::AmountMustBePositive);
        require!(
            amount <= free_collateral(&ctx.accounts.shard)?,
            HouseError::InsufficientCollateral
        );
        transfer_owned_lamports(
            &ctx.accounts.shard.to_account_info(),
            &ctx.accounts.authority.to_account_info(),
            amount,
        )?;
        let remaining_free = free_collateral(&ctx.accounts.shard)?;
        emit!(FreeCollateralWithdrawn {
            config: ctx.accounts.config.key(),
            shard: ctx.accounts.shard.key(),
            authority: ctx.accounts.authority.key(),
            amount,
            remaining_free,
        });
        Ok(())
    }

    /// Pausing stops new liability; it never blocks settlement of an existing bet.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(HousePauseChanged {
            config: ctx.accounts.config.key(),
            authority: ctx.accounts.authority.key(),
            paused,
        });
        Ok(())
    }

    pub fn reserve_bet(
        ctx: Context<ReserveBet>,
        id: u64,
        stake: u64,
        max_gross: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, HouseError::HousePaused);
        require!(stake > 0, HouseError::AmountMustBePositive);
        let ledger = &mut ctx.accounts.player_ledger;
        let next_id = ledger
            .last_bet_id
            .checked_add(1)
            .ok_or(HouseError::PlayerNonceExhausted)?;
        require!(id == next_id, HouseError::InvalidBetNonce);
        let shard = &mut ctx.accounts.shard;
        require!(stake <= shard.max_stake, HouseError::StakeExceedsLimit);
        require!(
            max_gross >= stake && max_gross <= shard.max_gross,
            HouseError::InvalidMaxGross
        );

        // Every recorded stake lamport stays in this bet's escrow until settlement.
        // It is not included in the shard bankroll and is not available to other bets.
        let reserved = reserved_liability_lamports(max_gross, stake);
        require!(
            reserved <= free_collateral(shard)?,
            HouseError::InsufficientCollateral
        );
        shard.reserved = checked_add(shard.reserved, reserved)?;
        shard.open_bets = checked_add(shard.open_bets, 1)?;
        shard.total_bets = checked_add(shard.total_bets, 1)?;
        // The ledger and reservation commit atomically. Failed funding or any
        // later check leaves this nonce available for the player's next attempt.
        ledger.last_bet_id = id;

        let bet = &mut ctx.accounts.bet;
        bet.config = ctx.accounts.config.key();
        bet.shard = shard.key();
        bet.player = ctx.accounts.player.key();
        bet.id = id;
        bet.stake = stake;
        bet.max_gross = max_gross;
        bet.reserved = reserved;
        bet.payout = 0;
        bet.status = BET_OPEN;
        bet.bump = ctx.bumps.bet;

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: bet.to_account_info(),
                },
            ),
            stake,
        )?;
        require_escrow(bet)?;
        free_collateral(shard)?;
        emit!(BetReserved {
            config: bet.config,
            shard: bet.shard,
            bet: bet.key(),
            player: bet.player,
            id,
            stake,
            max_gross,
            reserved,
            shard_reserved: shard.reserved,
        });
        Ok(())
    }

    /// The authorized game must verify its outcome before calling this instruction.
    /// The receipt remains until the game separately authorizes safe cleanup.
    pub fn settle_bet(ctx: Context<SettleBet>, payout: u64) -> Result<()> {
        let bet = &mut ctx.accounts.bet;
        let shard = &mut ctx.accounts.shard;
        require!(bet.status == BET_OPEN, HouseError::BetAlreadySettled);
        require!(payout <= bet.max_gross, HouseError::PayoutExceedsMaximum);
        require_escrow(bet)?;
        free_collateral(shard)?;
        require!(
            bet.reserved == reserved_liability_lamports(bet.max_gross, bet.stake),
            HouseError::InvalidReservation
        );

        let escrow_to_player = payout.min(bet.stake);
        let house_to_player = payout.saturating_sub(bet.stake);
        let escrow_to_house = bet.stake.saturating_sub(payout);
        require!(
            house_to_player <= bet.reserved,
            HouseError::InvalidReservation
        );
        shard.reserved = shard
            .reserved
            .checked_sub(bet.reserved)
            .ok_or(HouseError::InvalidReservation)?;
        shard.open_bets = shard
            .open_bets
            .checked_sub(1)
            .ok_or(HouseError::InvalidReservation)?;
        bet.status = BET_SETTLED;
        bet.payout = payout;

        transfer_owned_lamports(
            &bet.to_account_info(),
            &ctx.accounts.player.to_account_info(),
            escrow_to_player,
        )?;
        transfer_owned_lamports(
            &shard.to_account_info(),
            &ctx.accounts.player.to_account_info(),
            house_to_player,
        )?;
        transfer_owned_lamports(
            &bet.to_account_info(),
            &shard.to_account_info(),
            escrow_to_house,
        )?;

        // Unsolicited donations stay in the receipt; only the recorded stake moves.
        // Recheck both rent and the complete shard reservation/buffer invariant.
        spendable_lamports(&bet.to_account_info())?;
        free_collateral(shard)?;
        emit!(BetSettled {
            config: bet.config,
            shard: bet.shard,
            bet: bet.key(),
            player: bet.player,
            id: bet.id,
            stake: bet.stake,
            payout,
            released_reserve: bet.reserved,
            shard_reserved: shard.reserved,
        });
        Ok(())
    }

    /// The authorized game must persist any reward/claim rights before closing.
    /// The vault checks custody and replay safety; it does not implement rewards.
    /// Rent and any unsolicited receipt donations return to the recorded player.
    pub fn close_bet(ctx: Context<CloseBet>) -> Result<()> {
        let bet = &ctx.accounts.bet;
        require!(bet.status == BET_SETTLED, HouseError::BetNotSettled);
        require!(
            bet.id > 0 && ctx.accounts.player_ledger.last_bet_id >= bet.id,
            HouseError::InvalidBetNonce
        );
        require_keys_neq!(
            bet.key(),
            ctx.accounts.player.key(),
            HouseError::AliasedTransfer
        );
        let returned_lamports = bet.to_account_info().lamports();
        // Anchor performs the actual close on successful instruction exit.
        // Check the recipient addition first so even overflow is a typed error.
        checked_add(
            ctx.accounts.player.to_account_info().lamports(),
            returned_lamports,
        )?;
        emit!(BetClosed {
            config: bet.config,
            shard: bet.shard,
            bet: bet.key(),
            player: bet.player,
            id: bet.id,
            payout: bet.payout,
            returned_lamports,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeHouse<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + HouseConfig::INIT_SPACE,
        seeds = [b"house", authority.key().as_ref()], bump)]
    pub config: Account<'info, HouseConfig>,
    /// CHECK: Executable; its key is checked against the argument in the handler.
    #[account(executable)]
    pub game_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializePlayer<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [b"house", config.authority.as_ref()], bump = config.bump)]
    pub config: Account<'info, HouseConfig>,
    #[account(init, payer = player, space = 8 + PlayerLedger::INIT_SPACE,
        seeds = [b"player", config.key().as_ref(), player.key().as_ref()], bump)]
    pub player_ledger: Account<'info, PlayerLedger>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u16)]
pub struct CreateShard<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"house", config.authority.as_ref()], bump = config.bump,
        has_one = authority @ HouseError::UnauthorizedAuthority)]
    pub config: Account<'info, HouseConfig>,
    #[account(init, payer = authority, space = 8 + HouseShard::INIT_SPACE,
        seeds = [b"shard", config.key().as_ref(), &id.to_le_bytes()], bump)]
    pub shard: Account<'info, HouseShard>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundShard<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(seeds = [b"house", config.authority.as_ref()], bump = config.bump)]
    pub config: Account<'info, HouseConfig>,
    #[account(mut, seeds = [b"shard", config.key().as_ref(), &shard.id.to_le_bytes()],
        bump = shard.bump, has_one = config @ HouseError::WrongHouse)]
    pub shard: Account<'info, HouseShard>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawFree<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"house", config.authority.as_ref()], bump = config.bump,
        has_one = authority @ HouseError::UnauthorizedAuthority)]
    pub config: Account<'info, HouseConfig>,
    #[account(mut, seeds = [b"shard", config.key().as_ref(), &shard.id.to_le_bytes()],
        bump = shard.bump, has_one = config @ HouseError::WrongHouse)]
    pub shard: Account<'info, HouseShard>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"house", config.authority.as_ref()], bump = config.bump,
        has_one = authority @ HouseError::UnauthorizedAuthority)]
    pub config: Account<'info, HouseConfig>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct ReserveBet<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [b"house", config.authority.as_ref()], bump = config.bump)]
    pub config: Account<'info, HouseConfig>,
    #[account(mut, seeds = [b"shard", config.key().as_ref(), &shard.id.to_le_bytes()],
        bump = shard.bump, has_one = config @ HouseError::WrongHouse)]
    pub shard: Account<'info, HouseShard>,
    #[account(init, payer = player, space = 8 + BetReceipt::INIT_SPACE,
        seeds = [b"bet", config.key().as_ref(), player.key().as_ref(), &id.to_le_bytes()], bump)]
    pub bet: Account<'info, BetReceipt>,
    /// CHECK: The house's immutable authorized program, executable for CPI.
    #[account(address = config.game_program @ HouseError::UnauthorizedGameProgram, executable)]
    pub game_program: UncheckedAccount<'info>,
    // Derivation and signer privilege establish authority, not account ownership.
    // This PDA need not be allocated by the game program.
    #[account(seeds = [b"house_authority", config.key().as_ref()], bump,
        seeds::program = config.game_program)]
    pub game_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(mut, seeds = [b"player", config.key().as_ref(), player.key().as_ref()],
        bump = player_ledger.bump, has_one = config @ HouseError::WrongHouse,
        has_one = player @ HouseError::WrongPlayer)]
    pub player_ledger: Account<'info, PlayerLedger>,
}

#[derive(Accounts)]
pub struct SettleBet<'info> {
    /// CHECK: Exact recorded recipient; receiving SOL requires no owner or signature.
    #[account(mut, address = bet.player @ HouseError::WrongPlayer)]
    pub player: UncheckedAccount<'info>,
    #[account(seeds = [b"house", config.authority.as_ref()], bump = config.bump)]
    pub config: Account<'info, HouseConfig>,
    #[account(mut, seeds = [b"shard", config.key().as_ref(), &shard.id.to_le_bytes()],
        bump = shard.bump, has_one = config @ HouseError::WrongHouse)]
    pub shard: Account<'info, HouseShard>,
    #[account(mut, seeds = [b"bet", config.key().as_ref(), bet.player.as_ref(), &bet.id.to_le_bytes()],
        bump = bet.bump, has_one = config @ HouseError::WrongHouse,
        has_one = shard @ HouseError::WrongShard)]
    pub bet: Account<'info, BetReceipt>,
    /// CHECK: The house's immutable authorized program, executable for CPI.
    #[account(address = config.game_program @ HouseError::UnauthorizedGameProgram, executable)]
    pub game_program: UncheckedAccount<'info>,
    #[account(seeds = [b"house_authority", config.key().as_ref()], bump,
        seeds::program = config.game_program)]
    pub game_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseBet<'info> {
    /// CHECK: Exact recorded player receives rent/donations without a new signature.
    #[account(mut, address = bet.player @ HouseError::WrongPlayer)]
    pub player: UncheckedAccount<'info>,
    #[account(seeds = [b"house", config.authority.as_ref()], bump = config.bump)]
    pub config: Account<'info, HouseConfig>,
    #[account(mut, close = player,
        seeds = [b"bet", config.key().as_ref(), bet.player.as_ref(), &bet.id.to_le_bytes()],
        bump = bet.bump, has_one = config @ HouseError::WrongHouse)]
    pub bet: Account<'info, BetReceipt>,
    /// CHECK: Only the configured executable game may authorize receipt cleanup.
    #[account(address = config.game_program @ HouseError::UnauthorizedGameProgram, executable)]
    pub game_program: UncheckedAccount<'info>,
    #[account(seeds = [b"house_authority", config.key().as_ref()], bump,
        seeds::program = config.game_program)]
    pub game_authority: Signer<'info>,
    #[account(seeds = [b"player", config.key().as_ref(), player.key().as_ref()],
        bump = player_ledger.bump, has_one = config @ HouseError::WrongHouse,
        has_one = player @ HouseError::WrongPlayer)]
    pub player_ledger: Account<'info, PlayerLedger>,
}

#[account]
#[derive(InitSpace)]
pub struct HouseConfig {
    pub authority: Pubkey,
    pub game_program: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PlayerLedger {
    pub config: Pubkey,
    pub player: Pubkey,
    pub last_bet_id: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct HouseShard {
    pub config: Pubkey,
    pub id: u16,
    pub buffer: u64,
    pub max_stake: u64,
    pub max_gross: u64,
    pub reserved: u64,
    pub open_bets: u64,
    pub total_bets: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BetReceipt {
    pub config: Pubkey,
    pub shard: Pubkey,
    pub player: Pubkey,
    pub id: u64,
    pub stake: u64,
    pub max_gross: u64,
    pub reserved: u64,
    pub payout: u64,
    pub status: u8,
    pub bump: u8,
}

fn checked_add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b)
        .ok_or_else(|| error!(HouseError::ArithmeticOverflow))
}

fn spendable_lamports(account: &AccountInfo<'_>) -> Result<u64> {
    account
        .lamports()
        .checked_sub(Rent::get()?.minimum_balance(account.data_len()))
        .ok_or_else(|| error!(HouseError::AccountRentViolation))
}

fn free_collateral(shard: &Account<'_, HouseShard>) -> Result<u64> {
    available_collateral_lamports(
        spendable_lamports(&shard.to_account_info())?,
        shard.reserved,
        shard.buffer,
    )
    .map_err(|_| error!(HouseError::InsufficientCollateral))
}

fn require_escrow(bet: &Account<'_, BetReceipt>) -> Result<()> {
    require!(
        spendable_lamports(&bet.to_account_info())? >= bet.stake,
        HouseError::InsufficientEscrow
    );
    Ok(())
}

fn transfer_owned_lamports<'info>(
    source: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    require_keys_eq!(*source.owner, crate::ID, HouseError::InvalidSourceOwner);
    require_keys_neq!(*source.key, *recipient.key, HouseError::AliasedTransfer);
    require!(
        amount <= spendable_lamports(source)?,
        HouseError::AccountRentViolation
    );
    let remaining = source
        .lamports()
        .checked_sub(amount)
        .ok_or(HouseError::ArithmeticOverflow)?;
    let received = checked_add(recipient.lamports(), amount)?;
    **source.try_borrow_mut_lamports()? = remaining;
    **recipient.try_borrow_mut_lamports()? = received;
    Ok(())
}

#[event]
pub struct HouseInitialized {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub game_program: Pubkey,
}

#[event]
pub struct PlayerInitialized {
    pub config: Pubkey,
    pub player: Pubkey,
    pub player_ledger: Pubkey,
}

#[event]
pub struct ShardCreated {
    pub config: Pubkey,
    pub shard: Pubkey,
    pub id: u16,
    pub funding: u64,
    pub buffer: u64,
    pub max_stake: u64,
    pub max_gross: u64,
}

#[event]
pub struct ShardFunded {
    pub config: Pubkey,
    pub shard: Pubkey,
    pub funder: Pubkey,
    pub amount: u64,
}

#[event]
pub struct FreeCollateralWithdrawn {
    pub config: Pubkey,
    pub shard: Pubkey,
    pub authority: Pubkey,
    pub amount: u64,
    pub remaining_free: u64,
}

#[event]
pub struct HousePauseChanged {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub paused: bool,
}

#[event]
pub struct BetReserved {
    pub config: Pubkey,
    pub shard: Pubkey,
    pub bet: Pubkey,
    pub player: Pubkey,
    pub id: u64,
    pub stake: u64,
    pub max_gross: u64,
    pub reserved: u64,
    pub shard_reserved: u64,
}

#[event]
pub struct BetSettled {
    pub config: Pubkey,
    pub shard: Pubkey,
    pub bet: Pubkey,
    pub player: Pubkey,
    pub id: u64,
    pub stake: u64,
    pub payout: u64,
    pub released_reserve: u64,
    pub shard_reserved: u64,
}

#[event]
pub struct BetClosed {
    pub config: Pubkey,
    pub shard: Pubkey,
    pub bet: Pubkey,
    pub player: Pubkey,
    pub id: u64,
    pub payout: u64,
    pub returned_lamports: u64,
}

#[error_code]
pub enum HouseError {
    #[msg("The house and System Program cannot be configured as the game program")]
    InvalidGameProgram,
    #[msg("Only the configured house authority may perform this operation")]
    UnauthorizedAuthority,
    #[msg("The supplied game program is not the house's immutable authorized program")]
    UnauthorizedGameProgram,
    #[msg("Amount or stake must be greater than zero")]
    AmountMustBePositive,
    #[msg("Shard max stake must be positive and max gross must cover max stake")]
    InvalidShardLimits,
    #[msg("Initial funding must cover the shard's immutable safety buffer")]
    InsufficientInitialFunding,
    #[msg("New bets are paused; existing bets may still settle")]
    HousePaused,
    #[msg("Stake exceeds the shard's immutable limit")]
    StakeExceedsLimit,
    #[msg("Maximum gross payout must cover stake and remain within the shard limit")]
    InvalidMaxGross,
    #[msg("The shard cannot cover reservations, safety buffer, and the requested amount")]
    InsufficientCollateral,
    #[msg("Account belongs to a different house configuration")]
    WrongHouse,
    #[msg("The bet is bound to a different shard")]
    WrongShard,
    #[msg("Payout recipient differs from the recorded player")]
    WrongPlayer,
    #[msg("This bet has already settled")]
    BetAlreadySettled,
    #[msg("Payout exceeds the bet's immutable gross payout reservation")]
    PayoutExceedsMaximum,
    #[msg("Bet escrow does not contain the recorded stake above account rent")]
    InsufficientEscrow,
    #[msg("Recorded liability or open-bet accounting is inconsistent")]
    InvalidReservation,
    #[msg("Lamport balance or accounting counter overflowed")]
    ArithmeticOverflow,
    #[msg("Transfer or balance would violate the account's rent exemption")]
    AccountRentViolation,
    #[msg("Only house-program-owned accounts may be debited")]
    InvalidSourceOwner,
    #[msg("Transfer source and destination must be different accounts")]
    AliasedTransfer,
    #[msg("Bet ID must be the player's next sequential nonce, starting at one")]
    InvalidBetNonce,
    #[msg("The player's permanent bet nonce is exhausted and cannot be reset")]
    PlayerNonceExhausted,
    #[msg("Only a fully settled bet receipt may be closed")]
    BetNotSettled,
}
