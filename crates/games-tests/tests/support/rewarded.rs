//! Actual games -> incentives CPI. The existing scoped VRF fixture remains a
//! local randomness fixture; incentive claims and SPL transfers are real SBF.
use super::*;
use anchor_lang::solana_program::{program_option::COption, program_pack::Pack};
use anchor_spl::token::spl_token::{
    state::{Account as Token, AccountState, Mint},
    ID as TOKEN,
};
use incentives::{HourlyEpoch, RewardPhase, RewardPlayer};

const UNIT_REWARD: u64 = 1_000_000;
struct Rewards {
    game: Env,
    mint: Pubkey,
    phase: Pubkey,
    vault: Pubkey,
    funding: Pubkey,
    tokens: Pubkey,
    authority: Pubkey,
}
fn put_token(svm: &mut LiteSVM, account: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
    let mut data = vec![0; Token::LEN];
    Token::pack(
        Token {
            mint,
            owner,
            amount,
            delegate: COption::None,
            state: AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    svm.set_account(
        addr(account),
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(data.len()),
            data,
            owner: addr(TOKEN),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}
fn token_balance(svm: &LiteSVM, account: Pubkey) -> u64 {
    Token::unpack(&svm.get_account(&addr(account)).unwrap().data)
        .unwrap()
        .amount
}
impl Rewards {
    fn new(wager_budget: u64, hourly_budget: u64) -> Self {
        let mut game = Env::new();
        game.set_time(0);
        game.svm
            .add_program_from_file(
                addr(incentives::ID),
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/incentives.so"),
            )
            .unwrap();
        let mint = Pubkey::new_unique();
        let mut data = vec![0; Mint::LEN];
        Mint::pack(
            Mint {
                mint_authority: COption::None,
                supply: 1_000_000_000_000_000,
                decimals: 6,
                is_initialized: true,
                freeze_authority: COption::None,
            },
            &mut data,
        )
        .unwrap();
        game.svm
            .set_account(
                addr(mint),
                Account {
                    lamports: game.svm.minimum_balance_for_rent_exemption(data.len()),
                    data,
                    owner: addr(TOKEN),
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
        let funding = Pubkey::new_unique();
        put_token(
            &mut game.svm,
            funding,
            mint,
            key(&game.admin),
            1_000_000_000_000_000,
        );
        let tokens = Pubkey::new_unique();
        put_token(&mut game.svm, tokens, mint, key(&game.player), 0);
        let phase = Pubkey::find_program_address(
            &[
                b"phase",
                game.house.as_ref(),
                mint.as_ref(),
                &0_u64.to_le_bytes(),
            ],
            &incentives::ID,
        )
        .0;
        let vault =
            Pubkey::find_program_address(&[b"phase_vault", phase.as_ref()], &incentives::ID).0;
        let authority = Pubkey::find_program_address(
            &[b"incentives_authority", game.house.as_ref()],
            &games::ID,
        )
        .0;
        let mut env = Self {
            game,
            mint,
            phase,
            vault,
            funding,
            tokens,
            authority,
        };
        let i = env.phase_ix(incentives::RewardPhaseArgs {
            id: 0,
            start_epoch: 1,
            end_epoch: 3,
            wager_budget,
            rate_units_per_sol: 100_000_000,
            hourly_budget,
            minimum_wager_lamports: 2 * STAKE,
        });
        send(&mut env.game.svm, &env.game.fee, &[i], &[&env.game.admin]).unwrap();
        env.game.set_time(3600);
        env
    }
    fn phase_ix(&self, args: incentives::RewardPhaseArgs) -> Instruction {
        ix(
            incentives::ID,
            incentives::accounts::InitializeRewardPhase {
                authority: key(&self.game.admin),
                house: self.game.house,
                mint: self.mint,
                phase: self.phase,
                reward_vault: self.vault,
                funding: self.funding,
                token_program: TOKEN,
                system_program: SYSTEM,
            },
            incentives::instruction::InitializeRewardPhase { args },
        )
    }
    fn epoch(&self, epoch: u64) -> Pubkey {
        Pubkey::find_program_address(
            &[b"hour", self.phase.as_ref(), &epoch.to_le_bytes()],
            &incentives::ID,
        )
        .0
    }
    fn participant(&self, epoch: u64) -> Pubkey {
        Pubkey::find_program_address(
            &[
                b"hour_user",
                self.phase.as_ref(),
                &epoch.to_le_bytes(),
                key(&self.game.player).as_ref(),
            ],
            &incentives::ID,
        )
        .0
    }
    fn player_rewards(&self) -> Pubkey {
        Pubkey::find_program_address(
            &[
                b"reward_user",
                self.phase.as_ref(),
                key(&self.game.player).as_ref(),
            ],
            &incentives::ID,
        )
        .0
    }
    fn place_ix(&self, id: u64, stake: u64, epoch: u64) -> Instruction {
        let mut i = self.game.place_ix(id, 0, stake);
        i.data = games::instruction::PlaceCoinflipRewarded {
            id,
            side: 0,
            stake,
            epoch,
        }
        .data();
        i.accounts.extend([
            AccountMeta::new(addr(self.phase), false),
            AccountMeta::new_readonly(addr(self.authority), false),
            AccountMeta::new(addr(self.player_rewards()), false),
            AccountMeta::new(addr(self.epoch(epoch)), false),
            AccountMeta::new(addr(self.participant(epoch)), false),
            AccountMeta::new_readonly(addr(incentives::ID), false),
        ]);
        i
    }
    fn place(&mut self, id: u64, stake: u64, epoch: u64) -> TxResult {
        let i = self.place_ix(id, stake, epoch);
        send(
            &mut self.game.svm,
            &self.game.fee,
            &[i],
            &[&self.game.player],
        )
    }
    fn transfer(&self) -> incentives::accounts::RewardTransfer {
        incentives::accounts::RewardTransfer {
            player: key(&self.game.player),
            phase: self.phase,
            mint: self.mint,
            reward_vault: self.vault,
            player_tokens: self.tokens,
            token_program: TOKEN,
        }
    }
    fn claim_wager_ix(&self) -> Instruction {
        ix(
            incentives::ID,
            incentives::accounts::ClaimWagerRewards {
                transfer: self.transfer(),
                player_rewards: self.player_rewards(),
            },
            incentives::instruction::ClaimWagerRewards {},
        )
    }
    fn claim_wager(&mut self) -> TxResult {
        let i = self.claim_wager_ix();
        send(
            &mut self.game.svm,
            &self.game.fee,
            &[i],
            &[&self.game.player],
        )
    }
    fn claim_hour_ix(&self, epoch: u64) -> Instruction {
        ix(
            incentives::ID,
            incentives::accounts::ClaimHourly {
                transfer: self.transfer(),
                epoch_state: self.epoch(epoch),
                participant: self.participant(epoch),
            },
            incentives::instruction::ClaimHourly {},
        )
    }
    fn claim_hour(&mut self, epoch: u64) -> TxResult {
        let i = self.claim_hour_ix(epoch);
        send(
            &mut self.game.svm,
            &self.game.fee,
            &[i],
            &[&self.game.player],
        )
    }
    fn switch_player(&mut self) {
        std::mem::swap(&mut self.game.player, &mut self.game.stranger);
        self.game.ledger = Pubkey::find_program_address(
            &[
                b"player",
                self.game.house.as_ref(),
                key(&self.game.player).as_ref(),
            ],
            &house::ID,
        )
        .0;
        self.game.activity = Pubkey::find_program_address(
            &[
                b"activity",
                self.game.house.as_ref(),
                key(&self.game.player).as_ref(),
            ],
            &games::ID,
        )
        .0;
        if self.game.svm.get_account(&addr(self.game.ledger)).is_none() {
            let init = ix(
                house::ID,
                house::accounts::InitializePlayer {
                    player: key(&self.game.player),
                    config: self.game.house,
                    player_ledger: self.game.ledger,
                    system_program: SYSTEM,
                },
                house::instruction::InitializePlayer {},
            );
            let activity = ix(
                games::ID,
                games::accounts::InitializeActivity {
                    player: key(&self.game.player),
                    house: self.game.house,
                    activity: self.game.activity,
                    system_program: SYSTEM,
                },
                games::instruction::InitializeActivity {},
            );
            send(
                &mut self.game.svm,
                &self.game.fee,
                &[init, activity],
                &[&self.game.player],
            )
            .unwrap();
        }
        self.tokens = Pubkey::find_program_address(
            &[b"test-token", key(&self.game.player).as_ref()],
            &incentives::ID,
        )
        .0;
        if self.game.svm.get_account(&addr(self.tokens)).is_none() {
            put_token(
                &mut self.game.svm,
                self.tokens,
                self.mint,
                key(&self.game.player),
                0,
            );
        }
    }
}

#[test]
fn accepted_escrowed_wager_gets_credit_before_randomness_and_sol_settlement_stays_independent() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    e.place(1, STAKE, 1).unwrap();
    assert_eq!(
        read::<CoinflipBet>(&e.game.svm, e.game.bet(1)).status,
        games::COINFLIP_AWAITING
    );
    assert_eq!(
        read::<RewardPlayer>(&e.game.svm, e.player_rewards()).pending,
        UNIT_REWARD
    );
    assert_eq!(
        read::<HourlyEpoch>(&e.game.svm, e.epoch(1)).qualified_wallets,
        0
    );
    e.place(2, STAKE, 1).unwrap();
    assert_eq!(
        read::<HourlyEpoch>(&e.game.svm, e.epoch(1)).qualified_wallets,
        1
    );
    error_named(e.claim_hour(1), "EpochNotFinished");
    e.claim_wager().unwrap();
    assert_eq!(token_balance(&e.game.svm, e.tokens), 2 * UNIT_REWARD);
    error_named(e.claim_wager(), "NothingToClaim");
    e.game.set_time(7200);
    let before = e.game.balance(key(&e.game.player));
    let rent = e.game.balance(e.participant(1));
    e.claim_hour(1).unwrap();
    assert_eq!(e.game.balance(key(&e.game.player)), before + rent);
    assert!(e.game.svm.get_account(&addr(e.participant(1))).is_none());
    assert!(e.claim_hour(1).is_err());
    assert_eq!(token_balance(&e.game.svm, e.tokens), 2 * UNIT_REWARD + 1000);
    e.game.fulfill(0, [0; 32]).unwrap();
    let before = e.game.balance(key(&e.game.player));
    e.game.settle(1).unwrap();
    assert!(e.game.balance(key(&e.game.player)) >= before + PAYOUT);
    e.game.close(1).unwrap();
    assert_eq!(
        read::<RewardPlayer>(&e.game.svm, e.player_rewards()).total_credited,
        2 * UNIT_REWARD
    );
}
#[test]
fn reward_budget_exhaustion_rolls_back_real_escrow_nonce_oracle_fee_and_unrewarded_path_remains() {
    let mut e = Rewards::new(UNIT_REWARD - 1, 1000);
    let before = e.game.snapshot(1);
    error_named(e.place(1, STAKE, 1), "WagerBudgetExhausted");
    assert_eq!(e.game.snapshot(1), before);
    assert!(e.game.svm.get_account(&addr(e.player_rewards())).is_none());
    assert!(e.game.svm.get_account(&addr(e.epoch(1))).is_none());
    assert_eq!(read::<RewardPhase>(&e.game.svm, e.phase).wager_allocated, 0);
    e.game.place(1, 0, STAKE).unwrap();
}
#[test]
fn replay_after_settle_and_close_cannot_credit_the_same_wager_again() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    let i = e.place_ix(1, STAKE, 1);
    assert!(send(
        &mut e.game.svm,
        &e.game.fee,
        &[i.clone(), i],
        &[&e.game.player]
    )
    .is_err());
    assert!(e.game.svm.get_account(&addr(e.player_rewards())).is_none());
    e.place(1, STAKE, 1).unwrap();
    e.game.fulfill(0, [0; 32]).unwrap();
    e.game.settle(1).unwrap();
    e.game.close(1).unwrap();
    assert!(e.place(1, STAKE, 1).is_err());
    assert_eq!(
        read::<RewardPlayer>(&e.game.svm, e.player_rewards()).pending,
        UNIT_REWARD
    );
}
#[test]
fn credits_require_the_real_games_cpi_signer_not_a_server_or_wallet_signature() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    let mut i = ix(
        incentives::ID,
        incentives::accounts::CreditWager {
            player: key(&e.game.player),
            phase: e.phase,
            game_program: games::ID,
            game_authority: e.authority,
            player_rewards: e.player_rewards(),
            epoch_state: e.epoch(1),
            participant: e.participant(1),
            system_program: SYSTEM,
        },
        incentives::instruction::CreditWager {
            epoch: 1,
            stake: STAKE,
            bet: e.game.bet(1),
        },
    );
    i.accounts[3].is_signer = false;
    error_named(
        send(
            &mut e.game.svm,
            &e.game.fee,
            &[i.clone()],
            &[&e.game.player],
        ),
        "AccountNotSigner",
    );
    i.accounts[3].pubkey = addr(key(&e.game.player));
    i.accounts[3].is_signer = true;
    error_named(
        send(&mut e.game.svm, &e.game.fee, &[i], &[&e.game.player]),
        "ConstraintSeeds",
    );
    assert_eq!(read::<RewardPhase>(&e.game.svm, e.phase).wager_allocated, 0);
}
#[test]
fn only_current_clock_epoch_can_receive_credit_and_expired_phase_cannot_reopen() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    for epoch in [0, 2] {
        error_named(e.place(1, STAKE, epoch), "OutsidePhase");
    }
    e.place(1, STAKE, 1).unwrap();
    e.claim_wager().unwrap();
    e.game.set_time(10800);
    let close = ix(
        incentives::ID,
        incentives::accounts::CloseRewardPlayer {
            player: key(&e.game.player),
            phase: e.phase,
            player_rewards: e.player_rewards(),
        },
        incentives::instruction::CloseRewardPlayer {},
    );
    send(&mut e.game.svm, &e.game.fee, &[close], &[]).unwrap();
    assert!(e.game.svm.get_account(&addr(e.player_rewards())).is_none());
    e.game.set_time(3600);
    error_named(e.place(2, STAKE, 1), "PhaseClosed");
    assert!(e.game.svm.get_account(&addr(e.player_rewards())).is_none());
}
#[test]
fn hourly_budget_uses_frozen_qualified_weight_not_remaining_balance_and_keeps_dust() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1001);
    e.place(1, 2 * STAKE, 1).unwrap();
    e.place(2, STAKE, 1).unwrap();
    assert_eq!(
        read::<HourlyEpoch>(&e.game.svm, e.epoch(1)).qualified_wallets,
        1
    );
    e.switch_player();
    e.place(1, 2 * STAKE, 1).unwrap();
    assert_eq!(
        read::<HourlyEpoch>(&e.game.svm, e.epoch(1)).qualified_wallets,
        2
    );
    e.game.set_time(7200);
    e.claim_hour(1).unwrap();
    assert_eq!(token_balance(&e.game.svm, e.tokens), 400);
    e.switch_player();
    e.claim_hour(1).unwrap();
    assert_eq!(token_balance(&e.game.svm, e.tokens), 600);
    let p = read::<RewardPhase>(&e.game.svm, e.phase);
    assert_eq!(p.hourly_claimed, 1000);
    assert_eq!(token_balance(&e.game.svm, e.vault), p.total_budget - 1000);
    assert_eq!(
        read::<HourlyEpoch>(&e.game.svm, e.epoch(1)).claimed_wallets,
        2
    );
}
#[test]
fn closed_hourly_claim_cannot_reopen_after_clock_regression() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    e.place(1, 2 * STAKE, 1).unwrap();
    e.game.set_time(7200);
    e.claim_hour(1).unwrap();
    e.game.set_time(3600);
    let before = e.game.snapshot(2);
    error_named(e.place(2, STAKE, 1), "EpochSealed");
    assert_eq!(e.game.snapshot(2), before);
    assert!(e.game.svm.get_account(&addr(e.participant(1))).is_none());
    assert_eq!(
        read::<HourlyEpoch>(&e.game.svm, e.epoch(1)).qualified_wallets,
        1
    );
}
#[test]
fn cleanup_preserves_unclaimed_rights_and_returns_unqualified_record_rent_only_to_owner() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    e.place(1, STAKE, 1).unwrap();
    let close = ix(
        incentives::ID,
        incentives::accounts::CloseHourlyRecord {
            player: key(&e.game.player),
            phase: e.phase,
            epoch_state: e.epoch(1),
            participant: e.participant(1),
        },
        incentives::instruction::CloseHourlyRecord {},
    );
    error_named(
        send(
            &mut e.game.svm,
            &e.game.fee,
            std::slice::from_ref(&close),
            &[],
        ),
        "EpochNotFinished",
    );
    e.game.set_time(7200);
    error_named(e.claim_hour(1), "NotQualified");
    let mut wrong = close.clone();
    wrong.accounts[0].pubkey = addr(key(&e.game.stranger));
    assert!(send(&mut e.game.svm, &e.game.fee, &[wrong], &[]).is_err());
    let rent = e.game.balance(e.participant(1));
    let before = e.game.balance(key(&e.game.player));
    send(&mut e.game.svm, &e.game.fee, &[close], &[]).unwrap();
    assert_eq!(e.game.balance(key(&e.game.player)), before + rent);
    e.game.set_time(10800);
    let close = ix(
        incentives::ID,
        incentives::accounts::CloseRewardPlayer {
            player: key(&e.game.player),
            phase: e.phase,
            player_rewards: e.player_rewards(),
        },
        incentives::instruction::CloseRewardPlayer {},
    );
    error_named(
        send(&mut e.game.svm, &e.game.fee, &[close], &[]),
        "UnclaimedReward",
    );
    e.game.set_time(1_000_000_000);
    e.claim_wager().unwrap();
    assert_eq!(token_balance(&e.game.svm, e.tokens), UNIT_REWARD);
}
#[test]
fn wrong_recipient_reward_account_and_phase_vault_cannot_redirect_claims() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    e.place(1, 2 * STAKE, 1).unwrap();
    let mut i = e.claim_wager_ix();
    i.accounts[4].pubkey = addr(e.funding);
    assert!(send(&mut e.game.svm, &e.game.fee, &[i], &[&e.game.player]).is_err());
    let mut i = e.claim_wager_ix();
    i.accounts[3].pubkey = addr(e.funding);
    assert!(send(&mut e.game.svm, &e.game.fee, &[i], &[&e.game.player]).is_err());
    assert_eq!(
        read::<RewardPlayer>(&e.game.svm, e.player_rewards()).pending,
        2 * UNIT_REWARD
    );
}
#[test]
fn rewarded_transaction_stays_within_legacy_packet_and_executes_with_wallet_payer() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    let i = e.place_ix(1, STAKE, 1);
    let message = Message::new(std::slice::from_ref(&i), Some(&e.game.player.pubkey()));
    let tx = Transaction::new(&[&e.game.player], message, e.game.svm.latest_blockhash());
    let packet = 1 + 64 * tx.signatures.len() + tx.message_data().len();
    assert!(packet <= 1232, "rewarded packet {packet}");
    let meta = e.game.svm.send_transaction(tx).unwrap();
    println!(
        "rewarded admission wallet-payer: {packet} legacy bytes, {} fixture CU",
        meta.compute_units_consumed
    );
    assert_eq!(
        read::<RewardPlayer>(&e.game.svm, e.player_rewards()).pending,
        UNIT_REWARD
    );
}

#[test]
fn duplicate_hourly_claim_in_one_transaction_rolls_back_transfer_close_and_seal() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    e.place(1, 2 * STAKE, 1).unwrap();
    e.game.set_time(7200);
    let watched = [
        e.phase,
        e.epoch(1),
        e.participant(1),
        e.tokens,
        e.vault,
        key(&e.game.player),
    ];
    let before: Vec<_> = watched
        .iter()
        .map(|k| e.game.svm.get_account(&addr(*k)))
        .collect();
    let i = e.claim_hour_ix(1);
    assert!(send(
        &mut e.game.svm,
        &e.game.fee,
        &[i.clone(), i],
        &[&e.game.player]
    )
    .is_err());
    let after: Vec<_> = watched
        .iter()
        .map(|k| e.game.svm.get_account(&addr(*k)))
        .collect();
    assert_eq!(before, after);
    e.claim_hour(1).unwrap();
}

#[test]
fn sealed_epoch_claims_remain_payable_during_clock_regression_but_credits_do_not() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    e.place(1, 2 * STAKE, 1).unwrap();
    e.switch_player();
    e.place(1, 2 * STAKE, 1).unwrap();
    e.game.set_time(7200);
    e.claim_hour(1).unwrap();
    e.switch_player();
    e.game.set_time(3600);
    e.claim_hour(1).unwrap();
    assert_eq!(token_balance(&e.game.svm, e.tokens), 500);
    error_named(e.place(2, STAKE, 1), "EpochSealed");
}

#[test]
fn qualified_hourly_right_cannot_be_discarded_by_permissionless_cleanup() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    e.place(1, 2 * STAKE, 1).unwrap();
    e.game.set_time(7200);
    let close = ix(
        incentives::ID,
        incentives::accounts::CloseHourlyRecord {
            player: key(&e.game.player),
            phase: e.phase,
            epoch_state: e.epoch(1),
            participant: e.participant(1),
        },
        incentives::instruction::CloseHourlyRecord {},
    );
    error_named(
        send(&mut e.game.svm, &e.game.fee, &[close], &[]),
        "UnclaimedReward",
    );
    assert!(e.game.svm.get_account(&addr(e.participant(1))).is_some());
    e.game.set_time(1_000_000_000);
    e.claim_hour(1).unwrap();
    assert_eq!(token_balance(&e.game.svm, e.tokens), 1000);
}

#[test]
fn phase_budget_and_duration_limits_reject_before_accepting_underfunded_schedules() {
    for case in 0..5 {
        let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
        e.phase = Pubkey::find_program_address(
            &[
                b"phase",
                e.game.house.as_ref(),
                e.mint.as_ref(),
                &1_u64.to_le_bytes(),
            ],
            &incentives::ID,
        )
        .0;
        e.vault =
            Pubkey::find_program_address(&[b"phase_vault", e.phase.as_ref()], &incentives::ID).0;
        let mut args = incentives::RewardPhaseArgs {
            id: 1,
            start_epoch: 2,
            end_epoch: 3,
            wager_budget: UNIT_REWARD,
            rate_units_per_sol: 100,
            hourly_budget: 1000,
            minimum_wager_lamports: STAKE,
        };
        match case {
            0 => args.start_epoch = 1,
            1 => args.end_epoch = args.start_epoch,
            2 => args.end_epoch = args.start_epoch + incentives::MAX_PHASE_HOURS + 1,
            3 => args.hourly_budget = u64::MAX,
            _ => args.wager_budget = token_balance(&e.game.svm, e.funding) + 1,
        }
        let before = token_balance(&e.game.svm, e.funding);
        let i = e.phase_ix(args);
        let result = send(&mut e.game.svm, &e.game.fee, &[i], &[&e.game.admin]);
        if case < 3 {
            error_named(result, "InvalidSchedule");
        } else if case == 3 {
            error_named(result, "ArithmeticOverflow");
        } else {
            assert!(result.is_err());
        }
        assert!(e.game.svm.get_account(&addr(e.phase)).is_none());
        assert!(e.game.svm.get_account(&addr(e.vault)).is_none());
        assert_eq!(token_balance(&e.game.svm, e.funding), before);
    }
}

#[test]
fn first_rewarded_bet_batches_wallet_onboarding_within_legacy_packet_limit() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    std::mem::swap(&mut e.game.player, &mut e.game.stranger);
    e.game.ledger = Pubkey::find_program_address(
        &[
            b"player",
            e.game.house.as_ref(),
            key(&e.game.player).as_ref(),
        ],
        &house::ID,
    )
    .0;
    e.game.activity = Pubkey::find_program_address(
        &[
            b"activity",
            e.game.house.as_ref(),
            key(&e.game.player).as_ref(),
        ],
        &games::ID,
    )
    .0;
    let initialize_player = ix(
        house::ID,
        house::accounts::InitializePlayer {
            player: key(&e.game.player),
            config: e.game.house,
            player_ledger: e.game.ledger,
            system_program: SYSTEM,
        },
        house::instruction::InitializePlayer {},
    );
    let initialize_activity = ix(
        games::ID,
        games::accounts::InitializeActivity {
            player: key(&e.game.player),
            house: e.game.house,
            activity: e.game.activity,
            system_program: SYSTEM,
        },
        games::instruction::InitializeActivity {},
    );
    let instructions = [
        initialize_player,
        initialize_activity,
        e.place_ix(1, STAKE, 1),
    ];
    let tx = Transaction::new(
        &[&e.game.player],
        Message::new(&instructions, Some(&e.game.player.pubkey())),
        e.game.svm.latest_blockhash(),
    );
    let packet = 1 + 64 * tx.signatures.len() + tx.message_data().len();
    assert!(packet <= 1232, "rewarded onboarding packet {packet}");
    let meta = e.game.svm.send_transaction(tx).unwrap();
    println!(
        "rewarded onboarding wallet-payer: {packet} legacy bytes, {} fixture CU",
        meta.compute_units_consumed
    );
    assert_eq!(
        read::<RewardPlayer>(&e.game.svm, e.player_rewards()).pending,
        UNIT_REWARD
    );
    assert_eq!(
        read::<PlayerLedger>(&e.game.svm, e.game.ledger).last_bet_id,
        1
    );
}

#[test]
fn qualified_weight_includes_threshold_history_once_and_excludes_unqualified_wagers() {
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    e.place(1, STAKE, 1).unwrap();
    assert_eq!(
        read::<HourlyEpoch>(&e.game.svm, e.epoch(1)).qualified_wagered_lamports,
        0
    );
    e.place(2, STAKE, 1).unwrap();
    assert_eq!(
        read::<HourlyEpoch>(&e.game.svm, e.epoch(1)).qualified_wagered_lamports,
        2 * STAKE
    );
    e.place(3, STAKE, 1).unwrap();
    e.switch_player();
    e.place(1, STAKE, 1).unwrap();
    let epoch = read::<HourlyEpoch>(&e.game.svm, e.epoch(1));
    assert_eq!(epoch.qualified_wagered_lamports, 3 * STAKE);
    assert_eq!(epoch.total_wagered_lamports, u128::from(4 * STAKE));
    assert_eq!(epoch.qualified_wallets, 1);
    e.game.set_time(7200);
    error_named(e.claim_hour(1), "NotQualified");
    e.switch_player();
    e.claim_hour(1).unwrap();
    assert_eq!(token_balance(&e.game.svm, e.tokens), 1000);
}

#[test]
fn qualified_weight_overflow_rolls_back_admission_and_preserves_existing_claim() {
    use anchor_lang::AccountSerialize;
    let mut e = Rewards::new(10 * UNIT_REWARD, 1000);
    e.place(1, 2 * STAKE, 1).unwrap();
    // VM fault injection models the aggregate bound without billions of bets.
    let epoch_key = e.epoch(1);
    let mut account = e.game.svm.get_account(&addr(epoch_key)).unwrap();
    let mut epoch = read::<HourlyEpoch>(&e.game.svm, epoch_key);
    epoch.qualified_wagered_lamports = u64::MAX;
    epoch
        .try_serialize(&mut account.data.as_mut_slice())
        .unwrap();
    e.game
        .svm
        .set_account(addr(epoch_key), account.clone())
        .unwrap();
    let before = e.game.snapshot(2);
    let credits = read::<RewardPlayer>(&e.game.svm, e.player_rewards()).pending;
    error_named(e.place(2, STAKE, 1), "ArithmeticOverflow");
    assert_eq!(e.game.snapshot(2), before);
    assert_eq!(e.game.svm.get_account(&addr(epoch_key)).unwrap(), account);
    assert_eq!(
        read::<RewardPlayer>(&e.game.svm, e.player_rewards()).pending,
        credits
    );
    e.claim_wager().unwrap();
    assert_eq!(token_balance(&e.game.svm, e.tokens), credits);
}
