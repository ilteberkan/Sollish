//! Checked integer accounting for SOL wagers, payouts, and house collateral.
//!
//! All amounts are lamports. Multipliers use basis points: 10_000 means 1x.
//! This crate does not generate randomness, select outcomes, or transfer funds.

#![no_std]
#![forbid(unsafe_code)]

use core::fmt;

pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
pub const BPS_SCALE: u32 = 10_000;

/// Invalid inputs and failures to represent or collateralize an amount.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MathError {
    /// A wager must contain at least one lamport.
    ZeroStake,
    /// A gross payout multiplier must be at least 1x (10_000 bps).
    InvalidMultiplier,
    /// House edge must be in 0..10_000 bps; 100% is not accepted.
    InvalidHouseEdge,
    /// The calculated amount cannot be represented as a u64 lamport amount.
    ArithmeticOverflow,
    /// The bankroll cannot cover existing reserves, the buffer, and this request.
    InsufficientCollateral,
}

impl fmt::Display for MathError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::ZeroStake => "stake must be greater than zero",
            Self::InvalidMultiplier => "multiplier must be at least 10_000 bps (1x)",
            Self::InvalidHouseEdge => "house edge must be less than 10_000 bps (100%)",
            Self::ArithmeticOverflow => "lamport calculation overflowed",
            Self::InsufficientCollateral => "insufficient house collateral",
        })
    }
}

/// Returns a gross payout, including returned stake, rounded down to lamports.
///
/// The representational maximum is u32::MAX bps. The calling program must check
/// its configured product maximum before accepting a wager.
pub fn payout_lamports(stake: u64, multiplier_bps: u32) -> Result<u64, MathError> {
    if multiplier_bps < BPS_SCALE {
        return Err(MathError::InvalidMultiplier);
    }
    scaled_payout(stake, multiplier_bps)
}

/// Returns the winning gross payout for a fair (50/50) coinflip.
///
/// The multiplier is 2 * (1 - edge). A 200 bps edge gives a 1.96x payout.
/// Edges above 50% produce a payout below the stake; callers set product bounds.
/// Rounding down can produce a zero payout for very small stakes and large edges.
pub fn coinflip_payout_lamports(stake: u64, edge_bps: u16) -> Result<u64, MathError> {
    let edge_bps = u32::from(edge_bps);
    if edge_bps >= BPS_SCALE {
        return Err(MathError::InvalidHouseEdge);
    }
    // Bounds above guarantee subtraction and doubling fit into u32.
    scaled_payout(stake, 2 * (BPS_SCALE - edge_bps))
}

fn scaled_payout(stake: u64, multiplier_bps: u32) -> Result<u64, MathError> {
    if stake == 0 {
        return Err(MathError::ZeroStake);
    }
    let product = u128::from(stake)
        .checked_mul(u128::from(multiplier_bps))
        .ok_or(MathError::ArithmeticOverflow)?;
    u64::try_from(product / u128::from(BPS_SCALE)).map_err(|_| MathError::ArithmeticOverflow)
}

/// Returns additional house collateral needed for a gross payout.
///
/// `net_escrow` is the amount actually locked and available toward this payout,
/// after any fees removed from escrow. It must not include another wager's funds
/// or assets counted in the house bankroll. Zero escrow reserves the full payout.
pub fn reserved_liability_lamports(gross_payout: u64, net_escrow: u64) -> u64 {
    gross_payout.saturating_sub(net_escrow)
}

/// Returns unreserved house funds after protecting the safety buffer.
///
/// `bankroll` excludes wager escrow, token rewards, stakes, and account rent.
/// `reserved` is the total existing house liability in the same unit.
/// An undercollateralized state is an error, rather than zero available funds.
pub fn available_collateral_lamports(
    bankroll: u64,
    reserved: u64,
    safety_buffer: u64,
) -> Result<u64, MathError> {
    bankroll
        .checked_sub(reserved)
        .and_then(|remaining| remaining.checked_sub(safety_buffer))
        .ok_or(MathError::InsufficientCollateral)
}

/// Checks whether a new liability can be reserved without using protected funds.
///
/// This performs no reservation itself. The program must check and update its
/// reservation state atomically when it accepts a bet or permits a withdrawal.
pub fn require_collateral_lamports(
    bankroll: u64,
    reserved: u64,
    safety_buffer: u64,
    additional_reserve: u64,
) -> Result<(), MathError> {
    let available = available_collateral_lamports(bankroll, reserved, safety_buffer)?;
    if additional_reserve > available {
        return Err(MathError::InsufficientCollateral);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_hundred_x_wager_reserves_house_exposure() {
        let stake = LAMPORTS_PER_SOL / 100;
        let payout = payout_lamports(stake, 1_000_000).unwrap();
        let reserve = reserved_liability_lamports(payout, stake);
        assert_eq!(payout, LAMPORTS_PER_SOL);
        assert_eq!(reserve, 990_000_000);
        assert_eq!(
            available_collateral_lamports(LAMPORTS_PER_SOL, reserve, 0),
            Ok(stake)
        );
    }

    #[test]
    fn ten_x_wager_reserves_nine_times_the_stake() {
        let stake = LAMPORTS_PER_SOL / 100;
        let payout = payout_lamports(stake, 100_000).unwrap();
        assert_eq!(payout, 100_000_000);
        assert_eq!(reserved_liability_lamports(payout, stake), 90_000_000);
    }

    #[test]
    fn coinflip_two_percent_edge_pays_one_point_nine_six_x() {
        let payout = coinflip_payout_lamports(LAMPORTS_PER_SOL, 200).unwrap();
        assert_eq!(payout, 1_960_000_000);
        assert_eq!(
            reserved_liability_lamports(payout, LAMPORTS_PER_SOL),
            960_000_000
        );
    }

    #[test]
    fn payouts_round_down_only_at_the_final_division() {
        assert_eq!(payout_lamports(3, 15_000), Ok(4));
        assert_eq!(coinflip_payout_lamports(3, 200), Ok(5));
    }

    #[test]
    fn zero_stakes_are_rejected() {
        assert_eq!(payout_lamports(0, BPS_SCALE), Err(MathError::ZeroStake));
        assert_eq!(coinflip_payout_lamports(0, 200), Err(MathError::ZeroStake));
    }

    #[test]
    fn generic_multiplier_bounds_do_not_impose_a_product_cap() {
        assert_eq!(
            payout_lamports(1, BPS_SCALE - 1),
            Err(MathError::InvalidMultiplier)
        );
        assert_eq!(payout_lamports(u64::MAX, BPS_SCALE), Ok(u64::MAX));
        assert_eq!(payout_lamports(10_000, u32::MAX), Ok(u64::from(u32::MAX)));
    }

    #[test]
    fn house_edge_bounds_and_sub_stake_payouts() {
        assert_eq!(coinflip_payout_lamports(10_000, 0), Ok(20_000));
        assert_eq!(coinflip_payout_lamports(10_000, 5_000), Ok(10_000));
        assert_eq!(coinflip_payout_lamports(10_000, 9_999), Ok(2));
        assert_eq!(coinflip_payout_lamports(1, 9_999), Ok(0));
        assert_eq!(
            coinflip_payout_lamports(1, 10_000),
            Err(MathError::InvalidHouseEdge)
        );
        assert_eq!(
            coinflip_payout_lamports(1, u16::MAX),
            Err(MathError::InvalidHouseEdge)
        );
    }

    #[test]
    fn unrepresentable_payouts_are_errors() {
        assert_eq!(
            payout_lamports(u64::MAX, BPS_SCALE + 1),
            Err(MathError::ArithmeticOverflow)
        );
        assert_eq!(
            payout_lamports(u64::MAX, u32::MAX),
            Err(MathError::ArithmeticOverflow)
        );
        assert_eq!(
            coinflip_payout_lamports(u64::MAX, 0),
            Err(MathError::ArithmeticOverflow)
        );
    }

    #[test]
    fn net_escrow_not_nominal_stake_offsets_liability() {
        assert_eq!(reserved_liability_lamports(100, 9), 91);
        assert_eq!(reserved_liability_lamports(100, 0), 100);
        assert_eq!(reserved_liability_lamports(9, 100), 0);
        assert_eq!(reserved_liability_lamports(100, 100), 0);
    }

    #[test]
    fn existing_reserves_and_buffer_cannot_underflow() {
        assert_eq!(
            available_collateral_lamports(100, 101, 0),
            Err(MathError::InsufficientCollateral)
        );
        assert_eq!(
            available_collateral_lamports(100, 90, 11),
            Err(MathError::InsufficientCollateral)
        );
        assert_eq!(
            available_collateral_lamports(u64::MAX, u64::MAX, 1),
            Err(MathError::InsufficientCollateral)
        );
        assert_eq!(available_collateral_lamports(100, 90, 10), Ok(0));
    }

    #[test]
    fn reserve_admission_enforces_the_last_lamport_boundary() {
        assert_eq!(require_collateral_lamports(100, 80, 10, 10), Ok(()));
        assert_eq!(
            require_collateral_lamports(100, 80, 10, 11),
            Err(MathError::InsufficientCollateral)
        );
        assert_eq!(require_collateral_lamports(0, 0, 0, 0), Ok(()));
        assert_eq!(
            require_collateral_lamports(0, 0, 0, 1),
            Err(MathError::InsufficientCollateral)
        );
        assert_eq!(
            require_collateral_lamports(0, 1, 0, 0),
            Err(MathError::InsufficientCollateral)
        );
    }
}
