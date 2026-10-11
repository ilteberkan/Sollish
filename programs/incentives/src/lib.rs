//! Pre-funded, fixed-mint incentives. Staking principal is never an admin asset.
//! No minting, guaranteed APR, expiry of claims, or administrator vault sweep.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint as SplMint,
};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("E5tr12oarJumShYmXvohnSDJNVKrVGuKS4gLm6pdgfHv");
pub mod rewards;
pub use rewards::*;

pub const REWARD_SCALE: u128 = 1_000_000_000_000_000_000;

#[program]
pub mod incentives {
    use super::*;

    pub fn initialize_reward_phase(
        ctx: Context<InitializeRewardPhase>,
        args: RewardPhaseArgs,
    ) -> Result<()> {
        rewards::initialize(ctx, args)
    }
    pub fn credit_wager(
        ctx: Context<CreditWager>,
        epoch: u64,
        stake: u64,
        bet: Pubkey,
    ) -> Result<()> {
        rewards::credit(ctx, epoch, stake, bet)
    }
    pub fn claim_wager_rewards(ctx: Context<ClaimWagerRewards>) -> Result<()> {
        rewards::claim_wager(ctx)
    }
    pub fn claim_hourly(ctx: Context<ClaimHourly>) -> Result<()> {
        rewards::claim_hour(ctx)
    }
    pub fn close_hourly_record(ctx: Context<CloseHourlyRecord>) -> Result<()> {
        rewards::close_participant(ctx)
    }
    pub fn close_reward_player(ctx: Context<CloseRewardPlayer>) -> Result<()> {
        rewards::close_player(ctx)
    }

    /// All rewards are transferred before the immutable schedule is activated.
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        id: u64,
        start_ts: i64,
        end_ts: i64,
        budget: u64,
    ) -> Result<()> {
        require!(
            start_ts >= 0 && start_ts >= Clock::get()?.unix_timestamp && end_ts > start_ts,
            IncentiveError::InvalidSchedule
        );
        require!(budget > 0, IncentiveError::ZeroAmount);
        validate_mint(&ctx.accounts.mint)?;
        let pool = &mut ctx.accounts.pool;
        pool.house = ctx.accounts.house.key();
        pool.mint = ctx.accounts.mint.key();
        pool.token_program = ctx.accounts.token_program.key();
        pool.id = id;
        pool.start_ts = start_ts;
        pool.end_ts = end_ts;
        pool.budget = budget;
        pool.bump = ctx.bumps.pool;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.funding.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.reward_vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            budget,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.reward_vault.reload()?;
        require!(
            ctx.accounts.reward_vault.amount >= budget,
            IncentiveError::InsufficientReserve
        );
        emit!(PoolInitialized {
            pool: pool.key(),
            house: pool.house,
            mint: pool.mint,
            token_program: pool.token_program,
            id,
            start_ts,
            end_ts,
            budget
        });
        Ok(())
    }

    pub fn initialize_staker(ctx: Context<InitializeStaker>) -> Result<()> {
        let position = &mut ctx.accounts.position;
        position.pool = ctx.accounts.pool.key();
        position.player = ctx.accounts.player.key();
        position.checkpoint = ctx.accounts.pool.reward_per_share;
        position.bump = ctx.bumps.position;
        Ok(())
    }

    pub fn stake(ctx: Context<StakeTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, IncentiveError::ZeroAmount);
        let pool = &mut ctx.accounts.pool;
        require!(
            Clock::get()?.unix_timestamp < pool.end_ts,
            IncentiveError::PoolEnded
        );
        accrue(pool, Clock::get()?.unix_timestamp)?;
        credit_position(pool, &mut ctx.accounts.position)?;
        require!(
            ctx.accounts.principal_vault.amount >= pool.total_staked,
            IncentiveError::InsufficientPrincipal
        );
        pool.total_staked = pool
            .total_staked
            .checked_add(amount)
            .ok_or(IncentiveError::ArithmeticOverflow)?;
        ctx.accounts.position.amount = ctx
            .accounts
            .position
            .amount
            .checked_add(amount)
            .ok_or(IncentiveError::ArithmeticOverflow)?;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.player_tokens.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.principal_vault.to_account_info(),
                    authority: ctx.accounts.player.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.principal_vault.reload()?;
        require!(
            ctx.accounts.principal_vault.amount >= pool.total_staked,
            IncentiveError::InsufficientPrincipal
        );
        emit!(Staked {
            pool: pool.key(),
            player: ctx.accounts.player.key(),
            amount,
            total_staked: pool.total_staked
        });
        Ok(())
    }

    /// Exit is always available, even after the emission schedule ends.
    pub fn unstake(ctx: Context<StakeTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, IncentiveError::ZeroAmount);
        let pool = &mut ctx.accounts.pool;
        accrue(pool, Clock::get()?.unix_timestamp)?;
        credit_position(pool, &mut ctx.accounts.position)?;
        require!(
            ctx.accounts.principal_vault.amount >= pool.total_staked,
            IncentiveError::InsufficientPrincipal
        );
        ctx.accounts.position.amount = ctx
            .accounts
            .position
            .amount
            .checked_sub(amount)
            .ok_or(IncentiveError::InsufficientStake)?;
        pool.total_staked = pool
            .total_staked
            .checked_sub(amount)
            .ok_or(IncentiveError::ArithmeticOverflow)?;
        let id = pool.id.to_le_bytes();
        let bump = [pool.bump];
        let seeds: &[&[u8]] = &[
            b"staking",
            pool.house.as_ref(),
            pool.mint.as_ref(),
            &id,
            &bump,
        ];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.principal_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.player_tokens.to_account_info(),
                    authority: pool.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        emit!(Unstaked {
            pool: pool.key(),
            player: ctx.accounts.player.key(),
            amount,
            total_staked: pool.total_staked
        });
        Ok(())
    }

    pub fn claim_staking(ctx: Context<ClaimStaking>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        accrue(pool, Clock::get()?.unix_timestamp)?;
        credit_position(pool, &mut ctx.accounts.position)?;
        let amount = ctx.accounts.position.pending;
        require!(amount > 0, IncentiveError::NothingToClaim);
        require!(
            ctx.accounts.reward_vault.amount
                >= pool
                    .budget
                    .checked_sub(pool.claimed)
                    .ok_or(IncentiveError::ArithmeticOverflow)?,
            IncentiveError::InsufficientReserve
        );
        pool.claimed = pool
            .claimed
            .checked_add(amount)
            .ok_or(IncentiveError::ArithmeticOverflow)?;
        require!(
            pool.claimed <= pool.allocated && pool.allocated <= pool.budget,
            IncentiveError::InsufficientReserve
        );
        ctx.accounts.position.pending = 0;
        let id = pool.id.to_le_bytes();
        let bump = [pool.bump];
        let seeds: &[&[u8]] = &[
            b"staking",
            pool.house.as_ref(),
            pool.mint.as_ref(),
            &id,
            &bump,
        ];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.reward_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.player_tokens.to_account_info(),
                    authority: pool.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        emit!(StakingClaimed {
            pool: pool.key(),
            player: ctx.accounts.player.key(),
            amount,
            total_claimed: pool.claimed
        });
        Ok(())
    }
}

/// Reject freeze, minting and value-changing extensions. Metadata is harmless to
/// transfer accounting. This must be rerun if future token support is broadened.
fn validate_mint(mint: &InterfaceAccount<Mint>) -> Result<()> {
    require!(
        mint.decimals == reward_math::TOKEN_DECIMALS,
        IncentiveError::InvalidMint
    );
    require!(
        mint.freeze_authority.is_none() && mint.mint_authority.is_none(),
        IncentiveError::MutableMint
    );
    let info = mint.to_account_info();
    let data = info.try_borrow_data()?;
    let extended = StateWithExtensions::<SplMint>::unpack(&data)?;
    for extension in extended.get_extension_types()? {
        require!(
            matches!(
                extension,
                ExtensionType::MetadataPointer | ExtensionType::TokenMetadata
            ),
            IncentiveError::UnsupportedExtension
        );
    }
    Ok(())
}

/// Cumulative emission avoids repeated-call truncation of the time budget.
/// Clock regressions emit nothing twice and cannot disable principal withdrawal.
fn accrue(pool: &mut StakingPool, now: i64) -> Result<()> {
    let elapsed = now.clamp(pool.start_ts, pool.end_ts) - pool.start_ts;
    let duration = pool.end_ts - pool.start_ts;
    let target = (u128::from(pool.budget) * elapsed as u128 / duration as u128) as u64;
    let newly_emitted = target.saturating_sub(pool.emitted);
    pool.emitted = pool.emitted.max(target);
    if pool.total_staked != 0 {
        // Keep undistributed fractions across updates instead of letting a caller
        // destroy emission by repeatedly touching the pool with tiny stakes.
        let numerator = u128::from(newly_emitted)
            .checked_mul(REWARD_SCALE)
            .and_then(|v| v.checked_add(pool.emission_fraction))
            .ok_or(IncentiveError::ArithmeticOverflow)?;
        let increment = numerator / u128::from(pool.total_staked);
        pool.emission_fraction = numerator % u128::from(pool.total_staked);
        pool.reward_per_share = pool
            .reward_per_share
            .checked_add(increment)
            .ok_or(IncentiveError::ArithmeticOverflow)?;
        pool.allocated = pool
            .allocated
            .checked_add(newly_emitted)
            .ok_or(IncentiveError::ArithmeticOverflow)?;
    }
    Ok(())
}

fn credit_position(pool: &StakingPool, position: &mut StakePosition) -> Result<()> {
    let delta = pool
        .reward_per_share
        .checked_sub(position.checkpoint)
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    let numerator = u128::from(position.amount)
        .checked_mul(delta)
        .and_then(|v| v.checked_add(position.fraction))
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    let earned =
        u64::try_from(numerator / REWARD_SCALE).map_err(|_| IncentiveError::ArithmeticOverflow)?;
    position.pending = position
        .pending
        .checked_add(earned)
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    position.fraction = numerator % REWARD_SCALE;
    position.checkpoint = pool.reward_per_share;
    Ok(())
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct InitializePool<'info> {
    #[account(mut, address = house.authority @ IncentiveError::Unauthorized)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"house", house.authority.as_ref()], bump = house.bump, seeds::program = house::ID)]
    pub house: Account<'info, house::HouseConfig>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = authority, space = 8 + StakingPool::INIT_SPACE, seeds = [b"staking", house.key().as_ref(), mint.key().as_ref(), &id.to_le_bytes()], bump)]
    pub pool: Account<'info, StakingPool>,
    #[account(init, payer = authority, seeds = [b"principal", pool.key().as_ref()], bump, token::mint = mint, token::authority = pool, token::token_program = token_program)]
    pub principal_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(init, payer = authority, seeds = [b"staking_rewards", pool.key().as_ref()], bump, token::mint = mint, token::authority = pool, token::token_program = token_program)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = authority, token::token_program = token_program)]
    pub funding: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeStaker<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [b"staking", pool.house.as_ref(), pool.mint.as_ref(), &pool.id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, StakingPool>,
    #[account(init, payer = player, space = 8 + StakePosition::INIT_SPACE, seeds = [b"stake", pool.key().as_ref(), player.key().as_ref()], bump)]
    pub position: Account<'info, StakePosition>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StakeTokens<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"staking", pool.house.as_ref(), pool.mint.as_ref(), &pool.id.to_le_bytes()], bump = pool.bump, has_one = mint, has_one = token_program)]
    pub pool: Account<'info, StakingPool>,
    #[account(mut, seeds = [b"stake", pool.key().as_ref(), player.key().as_ref()], bump = position.bump, has_one = pool, has_one = player)]
    pub position: Account<'info, StakePosition>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [b"principal", pool.key().as_ref()], bump, token::mint = mint, token::authority = pool, token::token_program = token_program)]
    pub principal_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = player, token::token_program = token_program)]
    pub player_tokens: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ClaimStaking<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"staking", pool.house.as_ref(), pool.mint.as_ref(), &pool.id.to_le_bytes()], bump = pool.bump, has_one = mint, has_one = token_program)]
    pub pool: Account<'info, StakingPool>,
    #[account(mut, seeds = [b"stake", pool.key().as_ref(), player.key().as_ref()], bump = position.bump, has_one = pool, has_one = player)]
    pub position: Account<'info, StakePosition>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [b"staking_rewards", pool.key().as_ref()], bump, token::mint = mint, token::authority = pool, token::token_program = token_program)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = player, token::token_program = token_program)]
    pub player_tokens: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct StakingPool {
    pub house: Pubkey,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub id: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub budget: u64,
    pub emitted: u64,
    pub allocated: u64,
    pub claimed: u64,
    pub total_staked: u64,
    pub reward_per_share: u128,
    pub emission_fraction: u128,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct StakePosition {
    pub pool: Pubkey,
    pub player: Pubkey,
    pub amount: u64,
    pub pending: u64,
    pub checkpoint: u128,
    pub fraction: u128,
    pub bump: u8,
}

#[event]
pub struct PoolInitialized {
    pub pool: Pubkey,
    pub house: Pubkey,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub id: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub budget: u64,
}
#[event]
pub struct Staked {
    pub pool: Pubkey,
    pub player: Pubkey,
    pub amount: u64,
    pub total_staked: u64,
}
#[event]
pub struct Unstaked {
    pub pool: Pubkey,
    pub player: Pubkey,
    pub amount: u64,
    pub total_staked: u64,
}
#[event]
pub struct StakingClaimed {
    pub pool: Pubkey,
    pub player: Pubkey,
    pub amount: u64,
    pub total_claimed: u64,
}

#[error_code]
pub enum IncentiveError {
    #[msg("Only the house authority may create funded incentive schedules")]
    Unauthorized,
    #[msg("Amount must be positive")]
    ZeroAmount,
    #[msg("Schedule must begin no earlier than now and end after its start")]
    InvalidSchedule,
    #[msg("Reward mint must have six decimals")]
    InvalidMint,
    #[msg("Mint and freeze authority must both be revoked")]
    MutableMint,
    #[msg("Mint extension changes transfer or custody semantics")]
    UnsupportedExtension,
    #[msg("Arithmetic exceeded the representable accounting range")]
    ArithmeticOverflow,
    #[msg("Funded rewards cannot cover their outstanding allocation")]
    InsufficientReserve,
    #[msg("Principal vault does not cover all stakes")]
    InsufficientPrincipal,
    #[msg("Position has fewer tokens than the requested withdrawal")]
    InsufficientStake,
    #[msg("No whole token base units are currently claimable")]
    NothingToClaim,
    #[msg("Reward phase no longer accepts credits")]
    PhaseClosed,
    #[msg("Clock is outside the selected reward phase")]
    OutsidePhase,
    #[msg("Epoch or wallet receipt does not match its canonical phase")]
    WrongEpoch,
    #[msg("Epoch was permanently sealed")]
    EpochSealed,
    #[msg("Reward player does not match its immutable wallet and phase")]
    WrongRewardPlayer,
    #[msg("The funded wager budget cannot cover this admission at the fixed rate")]
    WagerBudgetExhausted,
    #[msg("Current UTC hour has not finished")]
    EpochNotFinished,
    #[msg("Wallet did not meet the fixed minimum wager for this hour")]
    NotQualified,
    #[msg("Unclaimed token rights must be paid before rent is reclaimed")]
    UnclaimedReward,
    #[msg("The staking schedule has ended")]
    PoolEnded,
}
