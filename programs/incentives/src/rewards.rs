//! Admission-based funded rewards. Only the house's immutable game program may
//! credit an actual accepted wager. No indexer, administrator or Merkle root can
//! create claims. Epoch receipts may close only after their global epoch seals.
use super::*;

pub const MAX_PHASE_HOURS: u64 = 24 * 90;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct RewardPhaseArgs {
    pub id: u64,
    pub start_epoch: u64,
    pub end_epoch: u64,
    pub wager_budget: u64,
    pub rate_units_per_sol: u64,
    pub hourly_budget: u64,
    pub minimum_wager_lamports: u64,
}

pub fn initialize(ctx: Context<InitializeRewardPhase>, args: RewardPhaseArgs) -> Result<()> {
    let now = current_epoch()?;
    let hours = args
        .end_epoch
        .checked_sub(args.start_epoch)
        .ok_or(IncentiveError::InvalidSchedule)?;
    require!(
        args.start_epoch > now
            && hours > 0
            && hours <= MAX_PHASE_HOURS
            && args.end_epoch <= i64::MAX as u64 / 3600,
        IncentiveError::InvalidSchedule
    );
    require!(args.minimum_wager_lamports > 0, IncentiveError::ZeroAmount);
    validate_mint(&ctx.accounts.mint)?;
    let total_budget = args
        .hourly_budget
        .checked_mul(hours)
        .and_then(|v| v.checked_add(args.wager_budget))
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    require!(total_budget > 0, IncentiveError::ZeroAmount);
    let phase = &mut ctx.accounts.phase;
    phase.house = ctx.accounts.house.key();
    phase.game_program = ctx.accounts.house.game_program;
    phase.mint = ctx.accounts.mint.key();
    phase.token_program = ctx.accounts.token_program.key();
    phase.id = args.id;
    phase.start_epoch = args.start_epoch;
    phase.end_epoch = args.end_epoch;
    phase.wager_budget = args.wager_budget;
    phase.rate_units_per_sol = args.rate_units_per_sol;
    phase.hourly_budget = args.hourly_budget;
    phase.minimum_wager_lamports = args.minimum_wager_lamports;
    phase.total_budget = total_budget;
    phase.bump = ctx.bumps.phase;
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
        total_budget,
        ctx.accounts.mint.decimals,
    )?;
    ctx.accounts.reward_vault.reload()?;
    phase.check_reserve(ctx.accounts.reward_vault.amount)?;
    emit!(RewardPhaseInitialized {
        phase: phase.key(),
        house: phase.house,
        mint: phase.mint,
        token_program: phase.token_program,
        args,
        total_budget
    });
    Ok(())
}

pub fn credit(ctx: Context<CreditWager>, epoch: u64, stake: u64, bet: Pubkey) -> Result<()> {
    require!(stake > 0, IncentiveError::ZeroAmount);
    let phase = &mut ctx.accounts.phase;
    require!(!phase.credits_closed, IncentiveError::PhaseClosed);
    require!(
        epoch == current_epoch()? && epoch >= phase.start_epoch && epoch < phase.end_epoch,
        IncentiveError::OutsidePhase
    );
    let epoch_state = &mut ctx.accounts.epoch_state;
    if epoch_state.phase == Pubkey::default() {
        epoch_state.phase = phase.key();
        epoch_state.epoch = epoch;
        epoch_state.bump = ctx.bumps.epoch_state;
    }
    require!(
        epoch_state.phase == phase.key() && epoch_state.epoch == epoch,
        IncentiveError::WrongEpoch
    );
    require!(!epoch_state.sealed, IncentiveError::EpochSealed);
    let participant = &mut ctx.accounts.participant;
    if participant.phase == Pubkey::default() {
        participant.phase = phase.key();
        participant.player = ctx.accounts.player.key();
        participant.epoch = epoch;
        participant.bump = ctx.bumps.participant;
    }
    require!(
        participant.phase == phase.key()
            && participant.player == ctx.accounts.player.key()
            && participant.epoch == epoch,
        IncentiveError::WrongEpoch
    );
    let player_rewards = &mut ctx.accounts.player_rewards;
    if player_rewards.phase == Pubkey::default() {
        player_rewards.phase = phase.key();
        player_rewards.player = ctx.accounts.player.key();
        player_rewards.bump = ctx.bumps.player_rewards;
    }
    require!(
        player_rewards.phase == phase.key() && player_rewards.player == ctx.accounts.player.key(),
        IncentiveError::WrongRewardPlayer
    );
    let available = phase
        .wager_budget
        .checked_sub(phase.wager_allocated)
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    let quote = reward_math::quote_wager_reward(stake, phase.rate_units_per_sol, available)
        .map_err(|_| IncentiveError::ArithmeticOverflow)?;
    // Rewarded admission advertises a fixed rate, so partial allocations are not
    // silently accepted. The separate unrewarded game instruction stays usable.
    require!(
        quote.shortfall_token_units == 0,
        IncentiveError::WagerBudgetExhausted
    );
    let reward = quote.payable_token_units;
    phase.wager_allocated = phase
        .wager_allocated
        .checked_add(reward)
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    player_rewards.pending = player_rewards
        .pending
        .checked_add(reward)
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    player_rewards.total_credited = player_rewards
        .total_credited
        .checked_add(reward)
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    participant.wagered_lamports = participant
        .wagered_lamports
        .checked_add(u128::from(stake))
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    epoch_state.total_wagered_lamports = epoch_state
        .total_wagered_lamports
        .checked_add(u128::from(stake))
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    let previously_qualified = participant.qualified;
    if !participant.qualified
        && participant.wagered_lamports >= u128::from(phase.minimum_wager_lamports)
    {
        participant.qualified = true;
        epoch_state.qualified_wallets = epoch_state
            .qualified_wallets
            .checked_add(1)
            .ok_or(IncentiveError::ArithmeticOverflow)?;
    }
    // Include pre-threshold wagers exactly once when this wallet qualifies.
    // Bound qualified weight to u64 so budget * weight always fits u128.
    if participant.qualified {
        let additional_weight = if previously_qualified {
            stake
        } else {
            u64::try_from(participant.wagered_lamports)
                .map_err(|_| IncentiveError::ArithmeticOverflow)?
        };
        epoch_state.qualified_wagered_lamports = epoch_state
            .qualified_wagered_lamports
            .checked_add(additional_weight)
            .ok_or(IncentiveError::ArithmeticOverflow)?;
    }
    emit!(WagerCredited {
        phase: phase.key(),
        player: ctx.accounts.player.key(),
        bet,
        epoch,
        stake,
        reward,
        qualified: participant.qualified,
        qualified_wallets: epoch_state.qualified_wallets,
        qualified_wagered_lamports: epoch_state.qualified_wagered_lamports
    });
    Ok(())
}

pub fn claim_wager(ctx: Context<ClaimWagerRewards>) -> Result<()> {
    ctx.accounts
        .transfer
        .phase
        .check_reserve(ctx.accounts.transfer.reward_vault.amount)?;
    let amount = ctx.accounts.player_rewards.pending;
    require!(amount > 0, IncentiveError::NothingToClaim);
    let phase = &mut ctx.accounts.transfer.phase;
    phase.wager_claimed = phase
        .wager_claimed
        .checked_add(amount)
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    require!(
        phase.wager_claimed <= phase.wager_allocated && phase.wager_allocated <= phase.wager_budget,
        IncentiveError::InsufficientReserve
    );
    ctx.accounts.player_rewards.pending = 0;
    ctx.accounts.player_rewards.total_claimed = ctx
        .accounts
        .player_rewards
        .total_claimed
        .checked_add(amount)
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    transfer_reward(&ctx.accounts.transfer, amount)?;
    emit!(WagerRewardClaimed {
        phase: ctx.accounts.transfer.phase.key(),
        player: ctx.accounts.transfer.player.key(),
        amount
    });
    Ok(())
}

pub fn claim_hour(ctx: Context<ClaimHourly>) -> Result<()> {
    seal(&mut ctx.accounts.epoch_state)?;
    require!(
        ctx.accounts.participant.qualified,
        IncentiveError::NotQualified
    );
    ctx.accounts
        .transfer
        .phase
        .check_reserve(ctx.accounts.transfer.reward_vault.amount)?;
    let count = ctx.accounts.epoch_state.qualified_wallets;
    require!(count > 0, IncentiveError::NotQualified);
    let phase = &mut ctx.accounts.transfer.phase;
    let weight = u64::try_from(ctx.accounts.participant.wagered_lamports)
        .map_err(|_| IncentiveError::ArithmeticOverflow)?;
    let qualified_total = ctx.accounts.epoch_state.qualified_wagered_lamports;
    let amount = reward_math::hourly_allocation(
        phase.hourly_budget,
        u128::from(weight),
        u128::from(qualified_total),
    )
    .map_err(|_| IncentiveError::ArithmeticOverflow)?;
    ctx.accounts.epoch_state.claimed_wallets = ctx
        .accounts
        .epoch_state
        .claimed_wallets
        .checked_add(1)
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    require!(
        ctx.accounts.epoch_state.claimed_wallets <= count,
        IncentiveError::InsufficientReserve
    );
    phase.hourly_claimed = phase
        .hourly_claimed
        .checked_add(amount)
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    let hourly_total = phase
        .total_budget
        .checked_sub(phase.wager_budget)
        .ok_or(IncentiveError::ArithmeticOverflow)?;
    require!(
        phase.hourly_claimed <= hourly_total,
        IncentiveError::InsufficientReserve
    );
    transfer_reward(&ctx.accounts.transfer, amount)?;
    // The permanent sealed epoch prevents admission from recreating this receipt.
    ctx.accounts
        .participant
        .close(ctx.accounts.transfer.player.to_account_info())?;
    emit!(HourlyRewardClaimed {
        phase: ctx.accounts.transfer.phase.key(),
        player: ctx.accounts.transfer.player.key(),
        epoch: ctx.accounts.epoch_state.epoch,
        amount,
        qualified_wallets: count,
        qualified_wagered_lamports: qualified_total,
        wagered_lamports: weight
    });
    Ok(())
}

pub fn close_participant(ctx: Context<CloseHourlyRecord>) -> Result<()> {
    seal(&mut ctx.accounts.epoch_state)?;
    require!(
        !ctx.accounts.participant.qualified,
        IncentiveError::UnclaimedReward
    );
    Ok(())
}

pub fn close_player(ctx: Context<CloseRewardPlayer>) -> Result<()> {
    require!(
        current_epoch()? >= ctx.accounts.phase.end_epoch,
        IncentiveError::OutsidePhase
    );
    require!(
        ctx.accounts.player_rewards.pending == 0,
        IncentiveError::UnclaimedReward
    );
    // This monotonic seal makes rent recovery safe even under clock regression.
    ctx.accounts.phase.credits_closed = true;
    Ok(())
}

fn current_epoch() -> Result<u64> {
    let now = Clock::get()?.unix_timestamp;
    u64::try_from(now)
        .map(|seconds| seconds / 3600)
        .map_err(|_| error!(IncentiveError::OutsidePhase))
}

fn seal(epoch: &mut HourlyEpoch) -> Result<()> {
    if epoch.sealed {
        return Ok(());
    }
    require!(
        current_epoch()? > epoch.epoch,
        IncentiveError::EpochNotFinished
    );
    epoch.sealed = true;
    Ok(())
}

fn transfer_reward<'info>(accounts: &RewardTransfer<'info>, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let phase = &accounts.phase;
    let id = phase.id.to_le_bytes();
    let bump = [phase.bump];
    let seeds: &[&[u8]] = &[
        b"phase",
        phase.house.as_ref(),
        phase.mint.as_ref(),
        &id,
        &bump,
    ];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            accounts.token_program.key(),
            TransferChecked {
                from: accounts.reward_vault.to_account_info(),
                mint: accounts.mint.to_account_info(),
                to: accounts.player_tokens.to_account_info(),
                authority: phase.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        accounts.mint.decimals,
    )
}

#[derive(Accounts)]
#[instruction(args: RewardPhaseArgs)]
pub struct InitializeRewardPhase<'info> {
    #[account(mut, address = house.authority @ IncentiveError::Unauthorized)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"house", house.authority.as_ref()], bump = house.bump, seeds::program = house::ID)]
    pub house: Account<'info, house::HouseConfig>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = authority, space = 8 + RewardPhase::INIT_SPACE, seeds = [b"phase", house.key().as_ref(), mint.key().as_ref(), &args.id.to_le_bytes()], bump)]
    pub phase: Account<'info, RewardPhase>,
    #[account(init, payer = authority, seeds = [b"phase_vault", phase.key().as_ref()], bump, token::mint = mint, token::authority = phase, token::token_program = token_program)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = authority, token::token_program = token_program)]
    pub funding: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(epoch: u64)]
pub struct CreditWager<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"phase", phase.house.as_ref(), phase.mint.as_ref(), &phase.id.to_le_bytes()], bump = phase.bump)]
    pub phase: Account<'info, RewardPhase>,
    /// CHECK: Immutable executable game selected by the house before phase funding.
    #[account(address = phase.game_program, executable)]
    pub game_program: UncheckedAccount<'info>,
    #[account(seeds = [b"incentives_authority", phase.house.as_ref()], bump, seeds::program = phase.game_program)]
    pub game_authority: Signer<'info>,
    #[account(init_if_needed, payer = player, space = 8 + RewardPlayer::INIT_SPACE, seeds = [b"reward_user", phase.key().as_ref(), player.key().as_ref()], bump)]
    pub player_rewards: Account<'info, RewardPlayer>,
    #[account(init_if_needed, payer = player, space = 8 + HourlyEpoch::INIT_SPACE, seeds = [b"hour", phase.key().as_ref(), &epoch.to_le_bytes()], bump)]
    pub epoch_state: Account<'info, HourlyEpoch>,
    #[account(init_if_needed, payer = player, space = 8 + HourlyParticipant::INIT_SPACE, seeds = [b"hour_user", phase.key().as_ref(), &epoch.to_le_bytes(), player.key().as_ref()], bump)]
    pub participant: Account<'info, HourlyParticipant>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RewardTransfer<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"phase", phase.house.as_ref(), phase.mint.as_ref(), &phase.id.to_le_bytes()], bump = phase.bump, has_one = mint, has_one = token_program)]
    pub phase: Account<'info, RewardPhase>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [b"phase_vault", phase.key().as_ref()], bump, token::mint = mint, token::authority = phase, token::token_program = token_program)]
    pub reward_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = player, token::token_program = token_program)]
    pub player_tokens: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ClaimWagerRewards<'info> {
    pub transfer: RewardTransfer<'info>,
    #[account(mut, seeds = [b"reward_user", transfer.phase.key().as_ref(), transfer.player.key().as_ref()], bump = player_rewards.bump,
        constraint = player_rewards.phase == transfer.phase.key() && player_rewards.player == transfer.player.key() @ IncentiveError::WrongRewardPlayer)]
    pub player_rewards: Account<'info, RewardPlayer>,
}

#[derive(Accounts)]
pub struct ClaimHourly<'info> {
    pub transfer: RewardTransfer<'info>,
    #[account(mut, seeds = [b"hour", transfer.phase.key().as_ref(), &epoch_state.epoch.to_le_bytes()], bump = epoch_state.bump,
        constraint = epoch_state.phase == transfer.phase.key() @ IncentiveError::WrongEpoch)]
    pub epoch_state: Account<'info, HourlyEpoch>,
    #[account(mut, seeds = [b"hour_user", transfer.phase.key().as_ref(), &epoch_state.epoch.to_le_bytes(), transfer.player.key().as_ref()], bump = participant.bump,
        constraint = participant.phase == transfer.phase.key() && participant.player == transfer.player.key() && participant.epoch == epoch_state.epoch @ IncentiveError::WrongEpoch)]
    pub participant: Account<'info, HourlyParticipant>,
}

#[derive(Accounts)]
pub struct CloseHourlyRecord<'info> {
    /// CHECK: Fixed rent recipient; no transfer or claim authorization needed.
    #[account(mut, address = participant.player)]
    pub player: UncheckedAccount<'info>,
    #[account(seeds = [b"phase", phase.house.as_ref(), phase.mint.as_ref(), &phase.id.to_le_bytes()], bump = phase.bump)]
    pub phase: Account<'info, RewardPhase>,
    #[account(mut, seeds = [b"hour", phase.key().as_ref(), &epoch_state.epoch.to_le_bytes()], bump = epoch_state.bump, has_one = phase)]
    pub epoch_state: Account<'info, HourlyEpoch>,
    #[account(mut, close = player, seeds = [b"hour_user", phase.key().as_ref(), &epoch_state.epoch.to_le_bytes(), player.key().as_ref()], bump = participant.bump,
        has_one = phase, has_one = player, constraint = participant.epoch == epoch_state.epoch @ IncentiveError::WrongEpoch)]
    pub participant: Account<'info, HourlyParticipant>,
}

#[derive(Accounts)]
pub struct CloseRewardPlayer<'info> {
    /// CHECK: Fixed rent recipient; only a zero-pending, expired position may close.
    #[account(mut, address = player_rewards.player)]
    pub player: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"phase", phase.house.as_ref(), phase.mint.as_ref(), &phase.id.to_le_bytes()], bump = phase.bump)]
    pub phase: Account<'info, RewardPhase>,
    #[account(mut, close = player, seeds = [b"reward_user", phase.key().as_ref(), player.key().as_ref()], bump = player_rewards.bump, has_one = phase, has_one = player)]
    pub player_rewards: Account<'info, RewardPlayer>,
}

#[account]
#[derive(InitSpace)]
pub struct RewardPhase {
    pub house: Pubkey,
    pub game_program: Pubkey,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub id: u64,
    pub start_epoch: u64,
    pub end_epoch: u64,
    pub wager_budget: u64,
    pub rate_units_per_sol: u64,
    pub hourly_budget: u64,
    pub minimum_wager_lamports: u64,
    pub total_budget: u64,
    pub wager_allocated: u64,
    pub wager_claimed: u64,
    pub hourly_claimed: u64,
    pub credits_closed: bool,
    pub bump: u8,
}
impl RewardPhase {
    fn check_reserve(&self, balance: u64) -> Result<()> {
        let outstanding = self
            .total_budget
            .checked_sub(self.wager_claimed)
            .and_then(|v| v.checked_sub(self.hourly_claimed))
            .ok_or(IncentiveError::ArithmeticOverflow)?;
        require!(balance >= outstanding, IncentiveError::InsufficientReserve);
        Ok(())
    }
}
#[account]
#[derive(InitSpace)]
pub struct RewardPlayer {
    pub phase: Pubkey,
    pub player: Pubkey,
    pub pending: u64,
    pub total_credited: u64,
    pub total_claimed: u64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct HourlyEpoch {
    pub phase: Pubkey,
    pub epoch: u64,
    pub total_wagered_lamports: u128,
    pub qualified_wallets: u64,
    pub qualified_wagered_lamports: u64,
    pub claimed_wallets: u64,
    pub sealed: bool,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct HourlyParticipant {
    pub phase: Pubkey,
    pub player: Pubkey,
    pub epoch: u64,
    pub wagered_lamports: u128,
    pub qualified: bool,
    pub bump: u8,
}

#[event]
pub struct RewardPhaseInitialized {
    pub phase: Pubkey,
    pub house: Pubkey,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub args: RewardPhaseArgs,
    pub total_budget: u64,
}
#[event]
pub struct WagerCredited {
    pub phase: Pubkey,
    pub player: Pubkey,
    pub bet: Pubkey,
    pub epoch: u64,
    pub stake: u64,
    pub reward: u64,
    pub qualified: bool,
    pub qualified_wallets: u64,
    pub qualified_wagered_lamports: u64,
}
#[event]
pub struct WagerRewardClaimed {
    pub phase: Pubkey,
    pub player: Pubkey,
    pub amount: u64,
}
#[event]
pub struct HourlyRewardClaimed {
    pub phase: Pubkey,
    pub player: Pubkey,
    pub epoch: u64,
    pub amount: u64,
    pub qualified_wallets: u64,
    pub qualified_wagered_lamports: u64,
    pub wagered_lamports: u64,
}
