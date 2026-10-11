use anchor_lang::{
    prelude::Pubkey, AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use house::{BetReceipt, HouseConfig, HouseShard, PlayerLedger};
use litesvm::{types::FailedTransactionMetadata, LiteSVM};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::path::PathBuf;

const SOL: u64 = 1_000_000_000;
const STAKE: u64 = 10_000_000;
const BUFFER: u64 = 10_000_000;
const MOCK: Pubkey = anchor_lang::pubkey!("4chDssK3K37KdrUDqRZpp8r6ndaH4PxDT1b6XzgaW3WC");
const SYSTEM: Pubkey = anchor_lang::pubkey!("11111111111111111111111111111111");
type TxResult = Result<(), Box<FailedTransactionMetadata>>;

fn addr(key: Pubkey) -> Address {
    Address::new_from_array(key.to_bytes())
}

fn key(pair: &Keypair) -> Pubkey {
    Pubkey::new_from_array(pair.pubkey().to_bytes())
}

fn instruction(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: addr(house::ID),
        accounts: accounts
            .to_account_metas(None)
            .into_iter()
            .map(|meta| AccountMeta {
                pubkey: Address::new_from_array(meta.pubkey.to_bytes()),
                is_signer: meta.is_signer,
                is_writable: meta.is_writable,
            })
            .collect(),
        data: data.data(),
    }
}

fn via_game(mut ix: Instruction, config: Pubkey, game: Pubkey) -> Instruction {
    let authority = Pubkey::find_program_address(&[b"house_authority", config.as_ref()], &game).0;
    for meta in &mut ix.accounts {
        if meta.pubkey == addr(authority) {
            meta.is_signer = false;
        }
    }
    ix.accounts
        .push(AccountMeta::new_readonly(ix.program_id, false));
    ix.program_id = addr(game);
    ix
}

fn send(
    svm: &mut LiteSVM,
    fee_payer: &Keypair,
    instructions: &[Instruction],
    signers: &[&Keypair],
) -> TxResult {
    // A new blockhash allows identical instructions to reach the program again,
    // so replay tests exercise receipt state rather than signature deduplication.
    svm.expire_blockhash();
    let mut all_signers = vec![fee_payer];
    all_signers.extend_from_slice(signers);
    let tx = Transaction::new(
        &all_signers,
        Message::new(instructions, Some(&fee_payer.pubkey())),
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx).map(|_| ()).map_err(Box::new)
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, address: Pubkey) -> T {
    let account = svm.get_account(&addr(address)).expect("account must exist");
    T::try_deserialize(&mut account.data.as_slice()).expect("valid Anchor account")
}

fn error_named(result: TxResult, name: &str) {
    let error = result.expect_err("instruction must be rejected");
    assert!(
        error.meta.logs.iter().any(|line| line.contains(name)),
        "expected {name}, got {error:?}"
    );
}

struct Env {
    svm: LiteSVM,
    fee: Keypair,
    admin: Keypair,
    player: Keypair,
    stranger: Keypair,
    config: Pubkey,
    shard: Pubkey,
    game_authority: Pubkey,
    player_ledger: Pubkey,
}

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let output = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy");
        svm.add_program_from_file(addr(house::ID), output.join("house.so"))
            .expect("build house.so first: scripts/test-contracts.sh");
        svm.add_program_from_file(addr(MOCK), output.join("mock_game.so"))
            .expect("build test-only mock_game.so first: scripts/test-contracts.sh");
        let fee = Keypair::new();
        let admin = Keypair::new();
        let player = Keypair::new();
        let stranger = Keypair::new();
        for pair in [&fee, &admin, &player, &stranger] {
            svm.airdrop(&pair.pubkey(), 100 * SOL).unwrap();
        }
        let config = Pubkey::find_program_address(&[b"house", key(&admin).as_ref()], &house::ID).0;
        let shard = Self::shard_address(config, 0);
        let game_authority =
            Pubkey::find_program_address(&[b"house_authority", config.as_ref()], &MOCK).0;
        let ix = instruction(
            house::accounts::InitializeHouse {
                authority: key(&admin),
                config,
                game_program: MOCK,
                system_program: SYSTEM,
            },
            house::instruction::InitializeHouse { game_program: MOCK },
        );
        send(&mut svm, &fee, &[ix], &[&admin]).unwrap();
        let player_ledger = Self::ledger_address(config, key(&player));
        let ix = instruction(
            house::accounts::InitializePlayer {
                player: key(&player),
                config,
                player_ledger,
                system_program: SYSTEM,
            },
            house::instruction::InitializePlayer {},
        );
        send(&mut svm, &fee, &[ix], &[&player]).unwrap();
        let mut env = Self {
            svm,
            fee,
            admin,
            player,
            stranger,
            config,
            shard,
            game_authority,
            player_ledger,
        };
        env.create_shard(0, SOL, BUFFER);
        env
    }

    fn shard_address(config: Pubkey, id: u16) -> Pubkey {
        Pubkey::find_program_address(&[b"shard", config.as_ref(), &id.to_le_bytes()], &house::ID).0
    }

    fn ledger_address(config: Pubkey, player: Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[b"player", config.as_ref(), player.as_ref()], &house::ID).0
    }

    fn bet(&self, id: u64) -> Pubkey {
        Pubkey::find_program_address(
            &[
                b"bet",
                self.config.as_ref(),
                key(&self.player).as_ref(),
                &id.to_le_bytes(),
            ],
            &house::ID,
        )
        .0
    }

    fn create_shard(&mut self, id: u16, funding: u64, buffer: u64) -> Pubkey {
        let shard = Self::shard_address(self.config, id);
        let ix = instruction(
            house::accounts::CreateShard {
                authority: key(&self.admin),
                config: self.config,
                shard,
                system_program: SYSTEM,
            },
            house::instruction::CreateShard {
                id,
                funding,
                buffer,
                max_stake: SOL / 10,
                max_gross: SOL,
            },
        );
        send(&mut self.svm, &self.fee, &[ix], &[&self.admin]).unwrap();
        shard
    }

    fn reserve_ix(&self, id: u64, stake: u64, max_gross: u64) -> Instruction {
        instruction(
            house::accounts::ReserveBet {
                player: key(&self.player),
                config: self.config,
                shard: self.shard,
                bet: self.bet(id),
                game_program: MOCK,
                game_authority: self.game_authority,
                system_program: SYSTEM,
                player_ledger: self.player_ledger,
            },
            house::instruction::ReserveBet {
                id,
                stake,
                max_gross,
            },
        )
    }

    fn reserve(&mut self, id: u64, stake: u64, max_gross: u64) -> TxResult {
        let ix = via_game(self.reserve_ix(id, stake, max_gross), self.config, MOCK);
        send(&mut self.svm, &self.fee, &[ix], &[&self.player])
    }

    fn settle_ix(&self, id: u64, payout: u64) -> Instruction {
        instruction(
            house::accounts::SettleBet {
                player: key(&self.player),
                config: self.config,
                shard: self.shard,
                bet: self.bet(id),
                game_program: MOCK,
                game_authority: self.game_authority,
            },
            house::instruction::SettleBet { payout },
        )
    }

    fn settle(&mut self, id: u64, payout: u64) -> TxResult {
        let ix = via_game(self.settle_ix(id, payout), self.config, MOCK);
        send(&mut self.svm, &self.fee, &[ix], &[])
    }

    fn close_ix(&self, id: u64) -> Instruction {
        instruction(
            house::accounts::CloseBet {
                player: key(&self.player),
                config: self.config,
                bet: self.bet(id),
                game_program: MOCK,
                game_authority: self.game_authority,
                player_ledger: self.player_ledger,
            },
            house::instruction::CloseBet {},
        )
    }

    fn close(&mut self, id: u64) -> TxResult {
        let ix = via_game(self.close_ix(id), self.config, MOCK);
        send(&mut self.svm, &self.fee, &[ix], &[])
    }

    fn withdraw(&mut self, amount: u64) -> TxResult {
        let ix = instruction(
            house::accounts::WithdrawFree {
                authority: key(&self.admin),
                config: self.config,
                shard: self.shard,
            },
            house::instruction::WithdrawFree { amount },
        );
        send(&mut self.svm, &self.fee, &[ix], &[&self.admin])
    }

    fn pause(&mut self, paused: bool) {
        let ix = instruction(
            house::accounts::SetPaused {
                authority: key(&self.admin),
                config: self.config,
            },
            house::instruction::SetPaused { paused },
        );
        send(&mut self.svm, &self.fee, &[ix], &[&self.admin]).unwrap();
    }

    fn balance(&self, address: Pubkey) -> u64 {
        self.svm.get_balance(&addr(address)).unwrap_or(0)
    }

    fn snapshot(&self, id: u64) -> Vec<Option<Account>> {
        [
            self.config,
            self.shard,
            self.bet(id),
            key(&self.player),
            key(&self.admin),
            self.player_ledger,
        ]
        .into_iter()
        .map(|address| self.svm.get_account(&addr(address)))
        .collect()
    }

    fn donate(&mut self, recipient: Pubkey, amount: u64) {
        let ix = solana_system_interface::instruction::transfer(
            &self.stranger.pubkey(),
            &addr(recipient),
            amount,
        );
        send(&mut self.svm, &self.fee, &[ix], &[&self.stranger]).unwrap();
    }
}

#[test]
fn signed_cpi_settles_win_loss_partial_and_refund_without_player_signature() {
    for payout in [0, STAKE / 2, STAKE, STAKE * 2] {
        let mut env = Env::new();
        let shard_before = env.balance(env.shard);
        let player_before = env.balance(key(&env.player));
        env.reserve(1, STAKE, STAKE * 2).unwrap();
        let bet_balance = env.balance(env.bet(1));
        let rent = bet_balance - STAKE;
        assert_eq!(env.balance(key(&env.player)), player_before - STAKE - rent);
        let shard: HouseShard = read(&env.svm, env.shard);
        assert_eq!(
            (shard.reserved, shard.open_bets, shard.total_bets),
            (STAKE, 1, 1)
        );
        env.settle(1, payout).unwrap();
        assert_eq!(
            env.balance(key(&env.player)),
            player_before - STAKE - rent + payout
        );
        assert_eq!(env.balance(env.shard), shard_before + STAKE - payout);
        assert_eq!(env.balance(env.bet(1)), rent);
        let bet: BetReceipt = read(&env.svm, env.bet(1));
        assert_eq!((bet.status, bet.payout), (1, payout));
        let shard: HouseShard = read(&env.svm, env.shard);
        assert_eq!(
            (shard.reserved, shard.open_bets, shard.total_bets),
            (0, 0, 1)
        );
    }
}

#[test]
fn full_exposure_blocks_extra_bet_and_withdrawal_with_atomic_rollback() {
    let mut env = Env::new();
    env.reserve(1, STAKE, SOL).unwrap(); // 0.99 SOL reserved + 0.01 SOL buffer.
    let before = env.snapshot(2);
    error_named(env.reserve(2, STAKE, STAKE + 1), "InsufficientCollateral");
    assert_eq!(env.snapshot(2), before);
    error_named(env.withdraw(1), "InsufficientCollateral");
    assert_eq!(env.snapshot(2), before);
    env.settle(1, SOL).unwrap();
    let shard: HouseShard = read(&env.svm, env.shard);
    assert_eq!(shard.reserved, 0);
    assert_eq!(shard.open_bets, 0);
}

#[test]
fn only_unreserved_lamports_above_buffer_can_be_withdrawn() {
    let mut env = Env::new();
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    env.withdraw(SOL - BUFFER - STAKE).unwrap();
    let before = env.snapshot(1);
    error_named(env.withdraw(1), "InsufficientCollateral");
    assert_eq!(env.snapshot(1), before);
    env.settle(1, STAKE * 2).unwrap();
    error_named(env.withdraw(1), "InsufficientCollateral");
}

#[test]
fn direct_wallet_cannot_impersonate_game_even_when_admin_signs() {
    let mut env = Env::new();
    let mut ix = env.reserve_ix(1, STAKE, STAKE * 2);
    for meta in &mut ix.accounts {
        if meta.pubkey == addr(env.game_authority) {
            meta.is_signer = false;
        }
    }
    let before = env.snapshot(1);
    error_named(
        send(&mut env.svm, &env.fee, &[ix], &[&env.player]),
        "AccountNotSigner",
    );
    assert_eq!(env.snapshot(1), before);
    let mut ix = env.reserve_ix(1, STAKE, STAKE * 2);
    ix.accounts[5].pubkey = env.admin.pubkey();
    error_named(
        send(&mut env.svm, &env.fee, &[ix], &[&env.player, &env.admin]),
        "ConstraintSeeds",
    );
    assert_eq!(env.snapshot(1), before);
}

#[test]
fn duplicate_settlement_cannot_pay_twice() {
    let mut env = Env::new();
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    env.settle(1, STAKE * 2).unwrap();
    let before = env.snapshot(1);
    error_named(env.settle(1, STAKE * 2), "BetAlreadySettled");
    assert_eq!(env.snapshot(1), before);
}

#[test]
fn receipt_cannot_be_recreated_in_same_or_different_shard() {
    let mut env = Env::new();
    let second = env.create_shard(1, SOL, BUFFER);
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    env.settle(1, 0).unwrap();
    let before = env.snapshot(1);
    let err = env.reserve(1, STAKE, STAKE * 2).unwrap_err();
    assert!(
        err.meta
            .logs
            .iter()
            .any(|line| line.contains("already in use")),
        "{err:?}"
    );
    assert_eq!(env.snapshot(1), before);
    env.shard = second;
    let second_before = env.snapshot(1);
    let err = env.reserve(1, STAKE, STAKE * 2).unwrap_err();
    assert!(
        err.meta
            .logs
            .iter()
            .any(|line| line.contains("already in use")),
        "{err:?}"
    );
    assert_eq!(env.snapshot(1), second_before);
}

#[test]
fn wrong_recipient_wrong_shard_and_excess_payout_are_rejected() {
    let mut env = Env::new();
    let second = env.create_shard(1, SOL, BUFFER);
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    let before = env.snapshot(1);
    error_named(env.settle(1, STAKE * 2 + 1), "PayoutExceedsMaximum");
    assert_eq!(env.snapshot(1), before);
    let mut ix = env.settle_ix(1, STAKE);
    ix.accounts[0].pubkey = env.stranger.pubkey();
    let ix = via_game(ix, env.config, MOCK);
    error_named(send(&mut env.svm, &env.fee, &[ix], &[]), "WrongPlayer");
    assert_eq!(env.snapshot(1), before);
    let mut ix = env.settle_ix(1, STAKE);
    ix.accounts[2].pubkey = addr(second);
    let ix = via_game(ix, env.config, MOCK);
    error_named(send(&mut env.svm, &env.fee, &[ix], &[]), "WrongShard");
    assert_eq!(env.snapshot(1), before);
}

#[test]
fn pause_stops_admission_but_preserves_existing_settlement() {
    let mut env = Env::new();
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    env.pause(true);
    assert!(read::<HouseConfig>(&env.svm, env.config).paused);
    let before = env.snapshot(2);
    error_named(env.reserve(2, STAKE, STAKE * 2), "HousePaused");
    assert_eq!(env.snapshot(2), before);
    env.settle(1, STAKE).unwrap();
    env.pause(false);
    env.reserve(2, STAKE, STAKE * 2).unwrap();
}

#[test]
fn donated_escrow_lamports_neither_block_nor_inflate_payout() {
    let mut env = Env::new();
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    let rent = env.balance(env.bet(1)) - STAKE;
    env.donate(env.bet(1), 7);
    env.donate(env.shard, 11);
    let player_before = env.balance(key(&env.player));
    let shard_before = env.balance(env.shard);
    env.settle(1, STAKE * 2).unwrap();
    assert_eq!(env.balance(key(&env.player)), player_before + STAKE * 2);
    assert_eq!(env.balance(env.shard), shard_before - STAKE);
    assert_eq!(env.balance(env.bet(1)), rent + 7);
}

#[test]
fn multiple_bets_keep_each_others_reserves_in_either_settlement_order() {
    for order in [[1, 2], [2, 1]] {
        let mut env = Env::new();
        env.reserve(1, STAKE, STAKE * 3).unwrap();
        env.reserve(2, STAKE, STAKE * 5).unwrap();
        env.withdraw(SOL - BUFFER - STAKE * 6).unwrap();
        let payouts = [0, STAKE * 3, STAKE * 5];
        env.settle(order[0], payouts[order[0] as usize]).unwrap();
        let remaining = read::<BetReceipt>(&env.svm, env.bet(order[1]));
        let shard: HouseShard = read(&env.svm, env.shard);
        assert_eq!(shard.reserved, remaining.reserved);
        assert_eq!(shard.open_bets, 1);
        error_named(env.withdraw(1), "InsufficientCollateral");
        env.settle(order[1], payouts[order[1] as usize]).unwrap();
        assert_eq!(read::<HouseShard>(&env.svm, env.shard).reserved, 0);
    }
}

#[test]
fn rejection_of_later_instruction_rolls_back_earlier_reservation_in_transaction() {
    let mut env = Env::new();
    let before = env.snapshot(1);
    let reserve = via_game(env.reserve_ix(1, STAKE, STAKE * 2), env.config, MOCK);
    let bad_settle = via_game(env.settle_ix(1, STAKE * 2 + 1), env.config, MOCK);
    error_named(
        send(
            &mut env.svm,
            &env.fee,
            &[reserve, bad_settle],
            &[&env.player],
        ),
        "PayoutExceedsMaximum",
    );
    assert_eq!(env.snapshot(1), before);
}

#[test]
fn product_limits_reject_invalid_reservations_without_debiting_player() {
    let mut env = Env::new();
    for (stake, max_gross, expected) in [
        (0, 1, "AmountMustBePositive"),
        (SOL / 10 + 1, SOL, "StakeExceedsLimit"),
        (STAKE, STAKE - 1, "InvalidMaxGross"),
        (STAKE, SOL + 1, "InvalidMaxGross"),
        (u64::MAX, u64::MAX, "StakeExceedsLimit"),
    ] {
        let before = env.snapshot(1);
        error_named(env.reserve(1, stake, max_gross), expected);
        assert_eq!(env.snapshot(1), before);
    }
}

#[test]
fn shards_share_no_writable_config_and_cannot_spend_other_shards_bankroll() {
    let mut env = Env::new();
    let empty = env.create_shard(1, 0, 0);
    let ix = env.reserve_ix(1, STAKE, STAKE * 2);
    assert!(!ix.accounts[1].is_writable);
    env.shard = empty;
    let before = env.snapshot(1);
    error_named(env.reserve(1, STAKE, STAKE * 2), "InsufficientCollateral");
    assert_eq!(env.snapshot(1), before);
}

#[test]
fn rogue_program_cannot_reserve_or_settle_with_its_own_cpi_signer() {
    for settlement in [false, true] {
        let mut env = Env::new();
        let rogue = Pubkey::new_unique();
        let fixture =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/mock_game.so");
        env.svm.add_program_from_file(addr(rogue), fixture).unwrap();
        let rogue_authority =
            Pubkey::find_program_address(&[b"house_authority", env.config.as_ref()], &rogue).0;
        if settlement {
            env.reserve(1, STAKE, STAKE * 2).unwrap();
        }
        for (advertised_game, expected) in [
            (rogue, "UnauthorizedGameProgram"),
            (MOCK, "ConstraintSeeds"),
        ] {
            let mut ix = if settlement {
                env.settle_ix(1, STAKE * 2)
            } else {
                env.reserve_ix(1, STAKE, STAKE * 2)
            };
            ix.accounts[4].pubkey = addr(advertised_game);
            ix.accounts[5].pubkey = addr(rogue_authority);
            let ix = via_game(ix, env.config, rogue);
            let before = env.snapshot(1);
            let signers = if settlement {
                vec![]
            } else {
                vec![&env.player]
            };
            error_named(send(&mut env.svm, &env.fee, &[ix], &signers), expected);
            assert_eq!(env.snapshot(1), before);
        }
    }
}

#[test]
fn authorized_game_cannot_reserve_without_the_players_signature() {
    let mut env = Env::new();
    let mut ix = env.reserve_ix(1, STAKE, STAKE * 2);
    // Submit a valid transaction without this privilege, so the house's Signer
    // constraint is exercised rather than Transaction::new failing to sign.
    ix.accounts[0].is_signer = false;
    let ix = via_game(ix, env.config, MOCK);
    let before = env.snapshot(1);
    error_named(send(&mut env.svm, &env.fee, &[ix], &[]), "AccountNotSigner");
    assert_eq!(env.snapshot(1), before);
}

#[test]
fn non_admin_cannot_pause_withdraw_or_create_a_shard() {
    let mut env = Env::new();
    let extra_shard = Env::shard_address(env.config, 7);
    let instructions = [
        instruction(
            house::accounts::SetPaused {
                authority: key(&env.stranger),
                config: env.config,
            },
            house::instruction::SetPaused { paused: true },
        ),
        instruction(
            house::accounts::WithdrawFree {
                authority: key(&env.stranger),
                config: env.config,
                shard: env.shard,
            },
            house::instruction::WithdrawFree { amount: 1 },
        ),
        instruction(
            house::accounts::CreateShard {
                authority: key(&env.stranger),
                config: env.config,
                shard: extra_shard,
                system_program: SYSTEM,
            },
            house::instruction::CreateShard {
                id: 7,
                funding: SOL,
                buffer: BUFFER,
                max_stake: SOL / 10,
                max_gross: SOL,
            },
        ),
    ];
    let before = env.snapshot(1);
    let stranger_before = env.balance(key(&env.stranger));
    for ix in instructions {
        error_named(
            send(&mut env.svm, &env.fee, &[ix], &[&env.stranger]),
            "UnauthorizedAuthority",
        );
        assert_eq!(env.snapshot(1), before);
        assert_eq!(env.balance(key(&env.stranger)), stranger_before);
        assert!(env.svm.get_account(&addr(extra_shard)).is_none());
    }
}

#[test]
fn a_valid_other_house_cannot_substitute_its_config_or_shard() {
    let mut env = Env::new();
    let other_config =
        Pubkey::find_program_address(&[b"house", key(&env.stranger).as_ref()], &house::ID).0;
    let other_shard = Env::shard_address(other_config, 0);
    let other_ledger = Env::ledger_address(other_config, key(&env.player));
    let other_authority =
        Pubkey::find_program_address(&[b"house_authority", other_config.as_ref()], &MOCK).0;
    let other_bet = Pubkey::find_program_address(
        &[
            b"bet",
            other_config.as_ref(),
            key(&env.player).as_ref(),
            &1_u64.to_le_bytes(),
        ],
        &house::ID,
    )
    .0;
    let initialize = instruction(
        house::accounts::InitializeHouse {
            authority: key(&env.stranger),
            config: other_config,
            game_program: MOCK,
            system_program: SYSTEM,
        },
        house::instruction::InitializeHouse { game_program: MOCK },
    );
    let create_shard = instruction(
        house::accounts::CreateShard {
            authority: key(&env.stranger),
            config: other_config,
            shard: other_shard,
            system_program: SYSTEM,
        },
        house::instruction::CreateShard {
            id: 0,
            funding: SOL,
            buffer: BUFFER,
            max_stake: SOL / 10,
            max_gross: SOL,
        },
    );
    send(
        &mut env.svm,
        &env.fee,
        &[initialize, create_shard],
        &[&env.stranger],
    )
    .unwrap();
    let init_player = instruction(
        house::accounts::InitializePlayer {
            player: key(&env.player),
            config: other_config,
            player_ledger: other_ledger,
            system_program: SYSTEM,
        },
        house::instruction::InitializePlayer {},
    );
    send(&mut env.svm, &env.fee, &[init_player], &[&env.player]).unwrap();
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    let before = env.snapshot(1);
    let other_config_before = env.svm.get_account(&addr(other_config));
    let other_shard_before = env.svm.get_account(&addr(other_shard));

    // All accounts except the original shard belong to the second house.
    let reserve = instruction(
        house::accounts::ReserveBet {
            player: key(&env.player),
            config: other_config,
            shard: env.shard,
            bet: other_bet,
            game_program: MOCK,
            game_authority: other_authority,
            system_program: SYSTEM,
            player_ledger: other_ledger,
        },
        house::instruction::ReserveBet {
            id: 1,
            stake: STAKE,
            max_gross: STAKE * 2,
        },
    );
    let reserve = via_game(reserve, other_config, MOCK);
    let error = send(&mut env.svm, &env.fee, &[reserve], &[&env.player]).unwrap_err();
    assert!(
        error
            .meta
            .logs
            .iter()
            .any(|line| { line.contains("ConstraintSeeds") || line.contains("WrongHouse") }),
        "unexpected rejection: {error:?}"
    );
    assert!(env.svm.get_account(&addr(other_bet)).is_none());
    assert_eq!(env.snapshot(1), before);

    // A real second-house shard cannot fund settlement of the original receipt.
    let settle = instruction(
        house::accounts::SettleBet {
            player: key(&env.player),
            config: other_config,
            shard: other_shard,
            bet: env.bet(1),
            game_program: MOCK,
            game_authority: other_authority,
        },
        house::instruction::SettleBet { payout: STAKE * 2 },
    );
    let settle = via_game(settle, other_config, MOCK);
    let error = send(&mut env.svm, &env.fee, &[settle], &[]).unwrap_err();
    assert!(
        error
            .meta
            .logs
            .iter()
            .any(|line| { line.contains("ConstraintSeeds") || line.contains("WrongHouse") }),
        "unexpected rejection: {error:?}"
    );
    assert_eq!(env.snapshot(1), before);
    assert_eq!(
        env.svm.get_account(&addr(other_config)),
        other_config_before
    );
    assert_eq!(env.svm.get_account(&addr(other_shard)), other_shard_before);
}

#[test]
fn one_lamport_prefunding_does_not_block_receipt_initialization() {
    let mut env = Env::new();
    let player_before = env.balance(key(&env.player));
    let stranger_before = env.balance(key(&env.stranger));
    let prefund = solana_system_interface::instruction::transfer(
        &env.stranger.pubkey(),
        &addr(env.bet(1)),
        1,
    );
    let reserve = via_game(env.reserve_ix(1, STAKE, STAKE * 2), env.config, MOCK);
    // Same transaction makes the final account rent-exempt while Anchor init
    // still encounters a system-owned PDA already holding one donated lamport.
    send(
        &mut env.svm,
        &env.fee,
        &[prefund, reserve],
        &[&env.stranger, &env.player],
    )
    .unwrap();
    let receipt = env.svm.get_account(&addr(env.bet(1))).unwrap();
    let rent = env
        .svm
        .minimum_balance_for_rent_exemption(receipt.data.len());
    assert_eq!(receipt.owner, addr(house::ID));
    assert_eq!(receipt.lamports, rent + STAKE);
    assert_eq!(
        env.balance(key(&env.player)),
        player_before - (rent - 1) - STAKE
    );
    assert_eq!(env.balance(key(&env.stranger)), stranger_before - 1);
    env.settle(1, STAKE * 2).unwrap();
    assert_eq!(env.balance(env.bet(1)), rent);
}

#[test]
fn fixed_recipient_still_receives_payout_after_artificial_owner_change() {
    let mut env = Env::new();
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    let recipient = addr(key(&env.player));
    let mut account = env.svm.get_account(&recipient).unwrap();
    // Deliberate fixture state mutation, not a claim that a wallet can assign
    // itself arbitrarily in production. Receiving SOL must not require System ownership.
    account.owner = addr(MOCK);
    env.svm.set_account(recipient, account.clone()).unwrap();
    env.settle(1, STAKE * 2).unwrap();
    let after = env.svm.get_account(&recipient).unwrap();
    assert_eq!(after.owner, account.owner);
    assert_eq!(after.data, account.data);
    assert_eq!(after.lamports, account.lamports + STAKE * 2);
    assert_eq!(
        read::<BetReceipt>(&env.svm, env.bet(1)).status,
        house::BET_SETTLED
    );
}

#[test]
fn only_the_next_player_nonce_is_admitted_and_failed_admission_does_not_consume_it() {
    let mut env = Env::new();
    for id in [0, 2, u64::MAX] {
        let before = env.snapshot(id);
        error_named(env.reserve(id, STAKE, STAKE * 2), "InvalidBetNonce");
        assert_eq!(env.snapshot(id), before);
    }
    env.reserve(1, STAKE, SOL).unwrap();
    assert_eq!(
        read::<PlayerLedger>(&env.svm, env.player_ledger).last_bet_id,
        1
    );
    error_named(env.reserve(2, STAKE, STAKE * 2), "InsufficientCollateral");
    assert_eq!(
        read::<PlayerLedger>(&env.svm, env.player_ledger).last_bet_id,
        1
    );
    env.settle(1, 0).unwrap();
    env.reserve(2, STAKE, STAKE * 2).unwrap();
    assert_eq!(
        read::<PlayerLedger>(&env.svm, env.player_ledger).last_bet_id,
        2
    );
}

#[test]
fn close_requires_settlement_and_returns_rent_and_donations_to_recorded_player() {
    let mut env = Env::new();
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    let before = env.snapshot(1);
    error_named(env.close(1), "BetNotSettled");
    assert_eq!(env.snapshot(1), before);
    env.settle(1, STAKE * 2).unwrap();
    env.donate(env.bet(1), 73);
    env.pause(true); // Cleanup must remain available even when admission is paused.
    let receipt_lamports = env.balance(env.bet(1));
    let player_before = env.balance(key(&env.player));
    let ledger_before = env.svm.get_account(&addr(env.player_ledger));
    let shard_before = env.svm.get_account(&addr(env.shard));
    env.close(1).unwrap();
    assert_eq!(env.balance(env.bet(1)), 0);
    assert_eq!(
        env.balance(key(&env.player)),
        player_before + receipt_lamports
    );
    assert_eq!(env.svm.get_account(&addr(env.player_ledger)), ledger_before);
    assert_eq!(env.svm.get_account(&addr(env.shard)), shard_before);
    error_named(env.close(1), "AccountNotInitialized");
    error_named(env.settle(1, STAKE * 2), "AccountNotInitialized");
}

#[test]
fn closed_bet_id_cannot_be_reopened_in_any_shard_but_next_id_can() {
    let mut env = Env::new();
    let second_shard = env.create_shard(1, SOL, BUFFER);
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    env.settle(1, 0).unwrap();
    env.close(1).unwrap();
    for shard in [env.shard, second_shard] {
        env.shard = shard;
        let before = env.snapshot(1);
        error_named(env.reserve(1, STAKE, STAKE * 2), "InvalidBetNonce");
        assert_eq!(env.snapshot(1), before);
    }
    env.reserve(2, STAKE, STAKE * 2).unwrap();
    assert_eq!(
        read::<PlayerLedger>(&env.svm, env.player_ledger).last_bet_id,
        2
    );
}

#[test]
fn close_and_reopen_in_same_transaction_rolls_back_cleanup() {
    let mut env = Env::new();
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    env.settle(1, STAKE).unwrap();
    let before = env.snapshot(1);
    let close = via_game(env.close_ix(1), env.config, MOCK);
    let reopen = via_game(env.reserve_ix(1, STAKE, STAKE * 2), env.config, MOCK);
    error_named(
        send(&mut env.svm, &env.fee, &[close, reopen], &[&env.player]),
        "InvalidBetNonce",
    );
    assert_eq!(env.snapshot(1), before);
    env.close(1).unwrap();
}

#[test]
fn later_bets_can_close_before_earlier_bets_without_resetting_replay_state() {
    let mut env = Env::new();
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    env.reserve(2, STAKE, STAKE * 3).unwrap();
    env.settle(2, STAKE * 3).unwrap();
    env.close(2).unwrap();
    assert_eq!(
        read::<BetReceipt>(&env.svm, env.bet(1)).status,
        house::BET_OPEN
    );
    assert_eq!(read::<HouseShard>(&env.svm, env.shard).reserved, STAKE);
    env.reserve(3, STAKE, STAKE * 2).unwrap();
    env.settle(1, 0).unwrap();
    env.close(1).unwrap();
    env.settle(3, STAKE).unwrap();
    env.close(3).unwrap();
    assert_eq!(
        read::<PlayerLedger>(&env.svm, env.player_ledger).last_bet_id,
        3
    );
    assert_eq!(read::<HouseShard>(&env.svm, env.shard).open_bets, 0);
}

#[test]
fn player_ledger_cannot_be_reinitialized_or_substituted() {
    let mut env = Env::new();
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    env.settle(1, 0).unwrap();
    env.close(1).unwrap();
    let initialize_again = instruction(
        house::accounts::InitializePlayer {
            player: key(&env.player),
            config: env.config,
            player_ledger: env.player_ledger,
            system_program: SYSTEM,
        },
        house::instruction::InitializePlayer {},
    );
    let before = env.snapshot(1);
    let error = send(&mut env.svm, &env.fee, &[initialize_again], &[&env.player]).unwrap_err();
    assert!(
        error
            .meta
            .logs
            .iter()
            .any(|line| line.contains("already in use")),
        "{error:?}"
    );
    assert_eq!(env.snapshot(1), before);

    let other = Env::ledger_address(env.config, key(&env.stranger));
    let initialize_other = instruction(
        house::accounts::InitializePlayer {
            player: key(&env.stranger),
            config: env.config,
            player_ledger: other,
            system_program: SYSTEM,
        },
        house::instruction::InitializePlayer {},
    );
    send(
        &mut env.svm,
        &env.fee,
        &[initialize_other],
        &[&env.stranger],
    )
    .unwrap();
    let mut forged = env.reserve_ix(2, STAKE, STAKE * 2);
    forged.accounts[7].pubkey = addr(other);
    let forged = via_game(forged, env.config, MOCK);
    let before = env.snapshot(2);
    error_named(
        send(&mut env.svm, &env.fee, &[forged], &[&env.player]),
        "ConstraintSeeds",
    );
    assert_eq!(env.snapshot(2), before);
}

#[test]
fn cleanup_cannot_be_called_by_wallet_or_redirected_to_another_recipient() {
    let mut env = Env::new();
    env.reserve(1, STAKE, STAKE * 2).unwrap();
    env.settle(1, 0).unwrap();
    let before = env.snapshot(1);
    let mut direct = env.close_ix(1);
    direct.accounts[4].is_signer = false;
    error_named(
        send(&mut env.svm, &env.fee, &[direct], &[]),
        "AccountNotSigner",
    );
    let mut redirect = env.close_ix(1);
    redirect.accounts[0].pubkey = env.stranger.pubkey();
    let redirect = via_game(redirect, env.config, MOCK);
    error_named(
        send(&mut env.svm, &env.fee, &[redirect], &[]),
        "WrongPlayer",
    );
    assert_eq!(env.snapshot(1), before);
}

#[test]
fn nonce_exhaustion_never_wraps_back_to_reusable_ids() {
    let mut env = Env::new();
    // Artificial boundary fixture: reaching this state with real bets would
    // require u64::MAX - 1 successful admissions. It exercises checked overflow.
    let mut ledger: PlayerLedger = read(&env.svm, env.player_ledger);
    ledger.last_bet_id = u64::MAX - 1;
    let mut account = env.svm.get_account(&addr(env.player_ledger)).unwrap();
    let mut data = Vec::new();
    ledger.try_serialize(&mut data).unwrap();
    account.data = data;
    env.svm
        .set_account(addr(env.player_ledger), account)
        .unwrap();
    env.reserve(u64::MAX, STAKE, STAKE * 2).unwrap();
    env.settle(u64::MAX, 0).unwrap();
    env.close(u64::MAX).unwrap();
    for id in [0, 1, u64::MAX] {
        let before = env.snapshot(id);
        error_named(env.reserve(id, STAKE, STAKE * 2), "PlayerNonceExhausted");
        assert_eq!(env.snapshot(id), before);
    }
}
