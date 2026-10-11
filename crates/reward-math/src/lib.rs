//! Integer quotes against acquired, funded reward tokens, not the token's total supply.
//!
//! Token amounts are base units (6 decimals: 1 token = 1_000_000 units); wagers
//! are SOL lamports. Pump's create_v2 documents this mint precision:
//! <https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md>.
//! The integrating program must verify its actual mint, decimals, and available
//! vault balance. This crate does not mint, transfer, authenticate, or promise rewards.
//!
//! Callers must use finalized eligibility/weight data, exclude cancelled/refunded
//! wagers, consume each completed wager/claim once, and atomically debit payable
//! amounts from the shared on-chain budget. Repeating a pure quote reserves nothing.

#![no_std]
#![forbid(unsafe_code)]

use core::fmt;

pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
pub const TOKEN_DECIMALS: u8 = 6;
pub const TOKEN_UNITS_PER_TOKEN: u64 = 1_000_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RewardError {
    UnsupportedTokenDecimals,
    NothingToAllocate,
    WeightExceedsTotal,
    ArithmeticOverflow,
    InvalidPhaseBounds,
    UnsortedOrOverlappingPhases,
    InsufficientFundedReserve,
    PhaseBudgetExceeded,
    OutsidePhase,
}

impl fmt::Display for RewardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::UnsupportedTokenDecimals => "reward mint must have 6 decimals",
            Self::NothingToAllocate => "total qualified weight is zero",
            Self::WeightExceedsTotal => "qualified weight exceeds epoch total",
            Self::ArithmeticOverflow => "reward calculation overflowed",
            Self::InvalidPhaseBounds => "phase start must be less than its exclusive end",
            Self::UnsortedOrOverlappingPhases => "phases must be sorted and non-overlapping",
            Self::InsufficientFundedReserve => "phase budgets exceed funded token reserve",
            Self::PhaseBudgetExceeded => "allocated tokens exceed the fixed phase budget",
            Self::OutsidePhase => "timestamp is outside the phase",
        })
    }
}

pub fn validate_token_decimals(actual_decimals: u8) -> Result<(), RewardError> {
    if actual_decimals != TOKEN_DECIMALS {
        return Err(RewardError::UnsupportedTokenDecimals);
    }
    Ok(())
}

/// Floor(budget * qualified_weight / total_qualified_weight).
///
/// Use the fixed, funded epoch budget and finalized qualified denominator for
/// every claimant, never the shrinking unclaimed balance. Zero weight returns
/// zero when total is positive; zero total returns NothingToAllocate. Sum of
/// disjoint qualified weights must equal total. Rounding dust remains reserved.
/// Products exceeding u128 are rejected even when their quotient could fit u64.
pub fn hourly_allocation(
    funded_budget_token_units: u64,
    qualified_weight: u128,
    total_qualified_weight: u128,
) -> Result<u64, RewardError> {
    if qualified_weight > total_qualified_weight {
        return Err(RewardError::WeightExceedsTotal);
    }
    if total_qualified_weight == 0 {
        return Err(RewardError::NothingToAllocate);
    }
    let numerator = u128::from(funded_budget_token_units)
        .checked_mul(qualified_weight)
        .ok_or(RewardError::ArithmeticOverflow)?;
    u64::try_from(numerator / total_qualified_weight).map_err(|_| RewardError::ArithmeticOverflow)
}

/// A quote is not a reservation or an accrued unpaid debt.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RewardQuote {
    /// Uncapped configured-rate result; u128 keeps representable excess explicit.
    pub requested_token_units: u128,
    /// Amount covered by the available funded budget snapshot, bounded by u64.
    pub payable_token_units: u64,
    /// Unfunded part of this quote, not a promise to mint or pay later.
    pub shortfall_token_units: u128,
}

/// Quotes floor(completed wager lamports * configured token units per SOL / 1e9).
///
/// No rate is selected here. Zero wager/rate is a zero quote. A limited budget
/// caps payable tokens and reports the full shortfall; it never silently changes
/// the configured rate. The caller enforces wager eligibility before this quote.
/// Available funding excludes tokens reserved for any other outstanding claim;
/// a raw vault balance containing those obligations is not an available budget.
pub fn quote_wager_reward(
    completed_wager_lamports: u64,
    rate_token_units_per_sol: u64,
    available_funded_token_units: u64,
) -> Result<RewardQuote, RewardError> {
    let requested = u128::from(completed_wager_lamports)
        .checked_mul(u128::from(rate_token_units_per_sol))
        .ok_or(RewardError::ArithmeticOverflow)?
        / u128::from(LAMPORTS_PER_SOL);
    let payable = requested.min(u128::from(available_funded_token_units));
    Ok(RewardQuote {
        requested_token_units: requested,
        payable_token_units: u64::try_from(payable).map_err(|_| RewardError::ArithmeticOverflow)?,
        shortfall_token_units: requested
            .checked_sub(payable)
            .ok_or(RewardError::ArithmeticOverflow)?,
    })
}

/// A fixed budget from already acquired tokens; no supply/emission percentage.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FundedPhase {
    pub start_ts: u64,
    /// End-exclusive boundary. Adjacent phases may start exactly here.
    pub end_ts: u64,
    pub budget_token_units: u64,
    pub rate_token_units_per_sol: u64,
}

/// Validates ordering, non-empty intervals, and the sum of fixed funded budgets.
/// Gaps, zero budgets/rates, and an empty (disabled) schedule are allowed.
/// Returns the total earmarked budget; any extra reserve remains unallocated.
pub fn validate_schedule(
    phases: &[FundedPhase],
    funded_reserve_token_units: u64,
) -> Result<u64, RewardError> {
    let mut previous_end = None;
    let mut total = 0u64;
    for phase in phases {
        if phase.start_ts >= phase.end_ts {
            return Err(RewardError::InvalidPhaseBounds);
        }
        if previous_end.is_some_and(|end| phase.start_ts < end) {
            return Err(RewardError::UnsortedOrOverlappingPhases);
        }
        total = total
            .checked_add(phase.budget_token_units)
            .ok_or(RewardError::ArithmeticOverflow)?;
        previous_end = Some(phase.end_ts);
    }
    if total > funded_reserve_token_units {
        return Err(RewardError::InsufficientFundedReserve);
    }
    Ok(total)
}

/// Selects the unique start-inclusive/end-exclusive phase after validation.
/// Returns None before/after the schedule or in a gap; does not extend phases.
/// The reserve argument is the schedule's originally earmarked funded reserve,
/// not its shrinking unclaimed token balance after earlier settlements.
pub fn phase_index_at(
    phases: &[FundedPhase],
    funded_reserve_token_units: u64,
    at_ts: u64,
) -> Result<Option<usize>, RewardError> {
    validate_schedule(phases, funded_reserve_token_units)?;
    Ok(phases
        .iter()
        .position(|phase| phase.start_ts <= at_ts && at_ts < phase.end_ts))
}

/// Caps a completed-wager quote by both unallocated phase budget and actual
/// available reserve. `allocated_token_units` must include all outstanding
/// reserved claims, not just transfers. Caller supplies the canonical on-chain
/// phase timestamp and atomically increments allocation by payable_token_units.
pub fn quote_phase_wager_reward(
    phase: &FundedPhase,
    at_ts: u64,
    allocated_token_units: u64,
    completed_wager_lamports: u64,
    available_funded_token_units: u64,
) -> Result<RewardQuote, RewardError> {
    if phase.start_ts >= phase.end_ts {
        return Err(RewardError::InvalidPhaseBounds);
    }
    if at_ts < phase.start_ts || at_ts >= phase.end_ts {
        return Err(RewardError::OutsidePhase);
    }
    let remaining = phase
        .budget_token_units
        .checked_sub(allocated_token_units)
        .ok_or(RewardError::PhaseBudgetExceeded)?;
    quote_wager_reward(
        completed_wager_lamports,
        phase.rate_token_units_per_sol,
        remaining.min(available_funded_token_units),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn phase(start: u64, end: u64, budget: u64) -> FundedPhase {
        FundedPhase {
            start_ts: start,
            end_ts: end,
            budget_token_units: budget,
            rate_token_units_per_sol: TOKEN_UNITS_PER_TOKEN,
        }
    }

    #[test]
    fn token_units_are_explicit_and_other_mint_precisions_are_rejected() {
        assert_eq!(TOKEN_UNITS_PER_TOKEN, 10u64.pow(u32::from(TOKEN_DECIMALS)));
        assert_eq!(validate_token_decimals(6), Ok(()));
        for decimals in [0, 5, 9, u8::MAX] {
            assert_eq!(
                validate_token_decimals(decimals),
                Err(RewardError::UnsupportedTokenDecimals)
            );
        }
    }

    #[test]
    fn hourly_allocation_handles_empty_and_invalid_denominators_explicitly() {
        assert_eq!(hourly_allocation(100, 0, 10), Ok(0));
        assert_eq!(hourly_allocation(0, 5, 10), Ok(0));
        assert_eq!(
            hourly_allocation(100, 0, 0),
            Err(RewardError::NothingToAllocate)
        );
        assert_eq!(
            hourly_allocation(0, 0, 0),
            Err(RewardError::NothingToAllocate)
        );
        assert_eq!(
            hourly_allocation(100, 1, 0),
            Err(RewardError::WeightExceedsTotal)
        );
        assert_eq!(
            hourly_allocation(100, 11, 10),
            Err(RewardError::WeightExceedsTotal)
        );
    }

    #[test]
    fn hourly_dust_stays_in_the_fixed_epoch_reserve() {
        let allocations = [hourly_allocation(100, 1, 3).unwrap(); 3];
        assert_eq!(allocations, [33, 33, 33]);
        assert_eq!(100 - allocations.iter().sum::<u64>(), 1);
        assert_eq!(hourly_allocation(100, 3, 3), Ok(100));
        assert_eq!(hourly_allocation(100, 1, 3), Ok(33));
    }

    #[test]
    fn hourly_intermediate_overflow_is_rejected_instead_of_approximated() {
        assert_eq!(
            hourly_allocation(u64::MAX, u128::from(u64::MAX), u128::from(u64::MAX)),
            Ok(u64::MAX)
        );
        assert_eq!(hourly_allocation(1, u128::MAX, u128::MAX), Ok(1));
        assert_eq!(
            hourly_allocation(2, u128::MAX, u128::MAX),
            Err(RewardError::ArithmeticOverflow)
        );
        assert_eq!(hourly_allocation(0, u128::MAX, u128::MAX), Ok(0));
    }

    #[test]
    fn exhaustive_small_hourly_partitions_conserve_budget_and_bound_dust() {
        for budget in 0..=32u64 {
            for a in 0..=12u128 {
                for b in 0..=12u128 {
                    for c in 0..=12u128 {
                        let total = a + b + c;
                        if total == 0 {
                            continue;
                        }
                        let paid = [a, b, c]
                            .iter()
                            .map(|w| hourly_allocation(budget, *w, total).unwrap())
                            .sum::<u64>();
                        assert!(paid <= budget);
                        assert!(budget - paid < 3);
                    }
                }
            }
        }
    }

    #[test]
    fn splitting_weight_never_increases_its_combined_hourly_share() {
        for budget in 0..=64u64 {
            for total in 1..=24u128 {
                let mut previous = 0;
                for weight in 0..=total {
                    let combined = hourly_allocation(budget, weight, total).unwrap();
                    assert!(combined >= previous);
                    previous = combined;
                    for part in 0..=weight {
                        let split = hourly_allocation(budget, part, total).unwrap()
                            + hourly_allocation(budget, weight - part, total).unwrap();
                        assert!(split <= combined);
                        assert!(combined - split <= 1);
                    }
                }
            }
        }
    }

    #[test]
    fn wager_quote_uses_lamports_and_token_base_units_with_floor_rounding() {
        assert_eq!(
            quote_wager_reward(LAMPORTS_PER_SOL, TOKEN_UNITS_PER_TOKEN, u64::MAX)
                .unwrap()
                .requested_token_units,
            1_000_000
        );
        assert_eq!(
            quote_wager_reward(999, TOKEN_UNITS_PER_TOKEN, u64::MAX)
                .unwrap()
                .requested_token_units,
            0
        );
        assert_eq!(
            quote_wager_reward(1_000, TOKEN_UNITS_PER_TOKEN, u64::MAX)
                .unwrap()
                .requested_token_units,
            1
        );
        assert_eq!(
            quote_wager_reward(1_999, TOKEN_UNITS_PER_TOKEN, u64::MAX)
                .unwrap()
                .requested_token_units,
            1
        );
        assert_eq!(
            quote_wager_reward(0, u64::MAX, u64::MAX)
                .unwrap()
                .payable_token_units,
            0
        );
        assert_eq!(
            quote_wager_reward(u64::MAX, 0, u64::MAX)
                .unwrap()
                .payable_token_units,
            0
        );
    }

    #[test]
    fn quote_shortfall_is_explicit_and_does_not_overflow_u64() {
        assert_eq!(
            quote_wager_reward(LAMPORTS_PER_SOL, 100, 30),
            Ok(RewardQuote {
                requested_token_units: 100,
                payable_token_units: 30,
                shortfall_token_units: 70,
            })
        );
        assert_eq!(
            quote_wager_reward(LAMPORTS_PER_SOL, 100, 0)
                .unwrap()
                .shortfall_token_units,
            100
        );
        let quote = quote_wager_reward(u64::MAX, u64::MAX, u64::MAX).unwrap();
        assert!(quote.requested_token_units > u128::from(u64::MAX));
        assert_eq!(quote.payable_token_units, u64::MAX);
        assert_eq!(
            quote.requested_token_units,
            u128::from(quote.payable_token_units) + quote.shortfall_token_units
        );
    }

    #[test]
    fn wager_quotes_preserve_accounting_and_never_exceed_available_funding() {
        for wager in [0, 1, 999, 1_000, 999_999_999, LAMPORTS_PER_SOL, u64::MAX] {
            for rate in [0, 1, 999, TOKEN_UNITS_PER_TOKEN, u64::MAX] {
                let mut previous_payable = 0;
                for available in [0, 1, 31, TOKEN_UNITS_PER_TOKEN, u64::MAX] {
                    let quote = quote_wager_reward(wager, rate, available).unwrap();
                    assert!(quote.payable_token_units <= available);
                    assert!(quote.payable_token_units >= previous_payable);
                    assert_eq!(
                        quote.requested_token_units,
                        u128::from(quote.payable_token_units) + quote.shortfall_token_units
                    );
                    previous_payable = quote.payable_token_units;
                }
            }
        }
    }

    #[test]
    fn phase_boundaries_are_start_inclusive_end_exclusive_and_gaps_stay_empty() {
        let phases = [phase(10, 20, 40), phase(20, 30, 50), phase(40, 50, 10)];
        assert_eq!(validate_schedule(&phases, 100), Ok(100));
        for (time, expected) in [
            (0, None),
            (9, None),
            (10, Some(0)),
            (19, Some(0)),
            (20, Some(1)),
            (29, Some(1)),
            (30, None),
            (39, None),
            (40, Some(2)),
            (49, Some(2)),
            (50, None),
            (u64::MAX, None),
        ] {
            assert_eq!(phase_index_at(&phases, 100, time), Ok(expected));
        }
        assert_eq!(validate_schedule(&[], 0), Ok(0));
        assert_eq!(phase_index_at(&[], 0, 100), Ok(None));
    }

    #[test]
    fn invalid_schedules_and_unfunded_or_overflowing_budget_sums_are_rejected() {
        assert_eq!(
            validate_schedule(&[phase(10, 10, 0)], 0),
            Err(RewardError::InvalidPhaseBounds)
        );
        assert_eq!(
            validate_schedule(&[phase(20, 10, 0)], 0),
            Err(RewardError::InvalidPhaseBounds)
        );
        assert_eq!(
            validate_schedule(&[phase(10, 20, 0), phase(19, 30, 0)], 0),
            Err(RewardError::UnsortedOrOverlappingPhases)
        );
        assert_eq!(
            validate_schedule(&[phase(20, 30, 0), phase(1, 10, 0)], 0),
            Err(RewardError::UnsortedOrOverlappingPhases)
        );
        assert_eq!(
            validate_schedule(&[phase(10, 20, 100)], 99),
            Err(RewardError::InsufficientFundedReserve)
        );
        assert_eq!(
            validate_schedule(&[phase(0, 1, u64::MAX), phase(1, 2, 1)], u64::MAX),
            Err(RewardError::ArithmeticOverflow)
        );
        assert_eq!(
            validate_schedule(&[phase(u64::MAX - 1, u64::MAX, u64::MAX)], u64::MAX),
            Ok(u64::MAX)
        );
        assert_eq!(
            phase_index_at(&[phase(0, 1, 1)], 0, 10),
            Err(RewardError::InsufficientFundedReserve)
        );
    }

    #[test]
    fn phase_quotes_enforce_both_budget_and_actual_available_reserve() {
        let p = phase(10, 20, 100);
        let budget_limited = quote_phase_wager_reward(&p, 10, 90, LAMPORTS_PER_SOL, 1_000).unwrap();
        assert_eq!(budget_limited.payable_token_units, 10);
        assert_eq!(budget_limited.shortfall_token_units, 999_990);
        assert_eq!(
            quote_phase_wager_reward(&p, 19, 0, LAMPORTS_PER_SOL, 5)
                .unwrap()
                .payable_token_units,
            5
        );
        assert_eq!(
            quote_phase_wager_reward(&p, 19, 100, LAMPORTS_PER_SOL, 1_000)
                .unwrap()
                .payable_token_units,
            0
        );
        assert_eq!(
            quote_phase_wager_reward(&p, 10, 101, 0, 0),
            Err(RewardError::PhaseBudgetExceeded)
        );
        for at in [9, 20] {
            assert_eq!(
                quote_phase_wager_reward(&p, at, 0, 0, 0),
                Err(RewardError::OutsidePhase)
            );
        }
        assert_eq!(
            quote_phase_wager_reward(&phase(10, 10, 1), 10, 0, 0, 0),
            Err(RewardError::InvalidPhaseBounds)
        );
    }

    #[test]
    fn sequential_phase_debits_cannot_distribute_more_than_the_original_funding() {
        for budget in 0..=100u64 {
            let p = FundedPhase {
                rate_token_units_per_sol: 7,
                ..phase(0, 100, budget)
            };
            let mut allocated = 0;
            let mut available = budget;
            for _ in 0..30 {
                let quote =
                    quote_phase_wager_reward(&p, 50, allocated, LAMPORTS_PER_SOL, available)
                        .unwrap();
                allocated += quote.payable_token_units;
                available -= quote.payable_token_units;
                assert_eq!(allocated + available, budget);
                assert!(allocated <= budget);
            }
            assert_eq!(allocated, budget);
            assert_eq!(available, 0);
        }
    }
}
