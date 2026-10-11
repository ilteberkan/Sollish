use anchor_lang::{
    prelude::Pubkey, AccountDeserialize, Discriminator, InstructionData, ToAccountMetas,
};
use ephemeral_vrf_sdk::consts::{scoped_vrf_identity, DEFAULT_QUEUE, VRF_PROGRAM_ID};
use games::{CoinflipBet, CoinflipConfig, GamePlayerActivity};
use house::{HouseShard, PlayerLedger};
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
const EDGE: u16 = 200;
const PAYOUT: u64 = 19_600_000;
const SYSTEM: Pubkey = anchor_lang::pubkey!("11111111111111111111111111111111");
const SLOT_HASHES: Pubkey = anchor_lang::pubkey!("SysvarS1otHashes111111111111111111111111111");
type TxResult = Result<(), Box<FailedTransactionMetadata>>;

fn addr(key: Pubkey) -> Address {
    Address::new_from_array(key.to_bytes())
}
fn key(pair: &Keypair) -> Pubkey {
    Pubkey::new_from_array(pair.pubkey().to_bytes())
}
fn ix(program: Pubkey, accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: addr(program),
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
fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    instructions: &[Instruction],
    signers: &[&Keypair],
) -> TxResult {
    svm.expire_blockhash();
    let mut all = vec![payer];
    all.extend_from_slice(signers);
    let tx = Transaction::new(
        &all,
        Message::new(instructions, Some(&payer.pubkey())),
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx).map(|_| ()).map_err(Box::new)
}
fn error_named(result: TxResult, name: &str) {
    let error = result.expect_err("must reject invalid transaction");
    assert!(
        error.meta.logs.iter().any(|line| line.contains(name)),
        "expected {name}: {error:?}"
    );
}
fn read<T: AccountDeserialize>(svm: &LiteSVM, address: Pubkey) -> T {
    let account = svm.get_account(&addr(address)).expect("account must exist");
    T::try_deserialize(&mut account.data.as_slice()).unwrap()
}

struct Env {
    svm: LiteSVM,
    fee: Keypair,
    admin: Keypair,
    player: Keypair,
    stranger: Keypair,
    house: Pubkey,
    config: Pubkey,
    shard: Pubkey,
    ledger: Pubkey,
    house_authority: Pubkey,
    program_identity: Pubkey,
    activity: Pubkey,
}

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let output = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy");
        for (program, file) in [
            (house::ID, "house.so"),
            (games::ID, "games.so"),
            (VRF_PROGRAM_ID, "mock_vrf.so"),
        ] {
            svm.add_program_from_file(addr(program), output.join(file))
                .expect("run scripts/build-contracts.sh first");
        }
        let queue_lamports = svm.minimum_balance_for_rent_exemption(mock_vrf::QUEUE_SPACE);
        svm.set_account(
            addr(DEFAULT_QUEUE),
            Account {
                lamports: queue_lamports,
                data: vec![0; mock_vrf::QUEUE_SPACE],
                owner: addr(VRF_PROGRAM_ID),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
        let fee = Keypair::new();
        let admin = Keypair::new();
        let player = Keypair::new();
        let stranger = Keypair::new();
        for pair in [&fee, &admin, &player, &stranger] {
            svm.airdrop(&pair.pubkey(), SOL * 100).unwrap();
        }
        let house = Pubkey::find_program_address(&[b"house", key(&admin).as_ref()], &house::ID).0;
        let config =
            Pubkey::find_program_address(&[b"coinflip_config", house.as_ref()], &games::ID).0;
        let shard = Pubkey::find_program_address(
            &[b"shard", house.as_ref(), &0_u16.to_le_bytes()],
            &house::ID,
        )
        .0;
        let ledger = Pubkey::find_program_address(
            &[b"player", house.as_ref(), key(&player).as_ref()],
            &house::ID,
        )
        .0;
        let house_authority =
            Pubkey::find_program_address(&[b"house_authority", house.as_ref()], &games::ID).0;
        let program_identity = Pubkey::find_program_address(&[b"identity"], &games::ID).0;
        let activity = Pubkey::find_program_address(
            &[b"activity", house.as_ref(), key(&player).as_ref()],
            &games::ID,
        )
        .0;
        let init_house = ix(
            house::ID,
            house::accounts::InitializeHouse {
                authority: key(&admin),
                config: house,
                game_program: games::ID,
                system_program: SYSTEM,
            },
            house::instruction::InitializeHouse {
                game_program: games::ID,
            },
        );
        let init_shard = ix(
            house::ID,
            house::accounts::CreateShard {
                authority: key(&admin),
                config: house,
                shard,
                system_program: SYSTEM,
            },
            house::instruction::CreateShard {
                id: 0,
                funding: SOL,
                buffer: STAKE,
                max_stake: SOL / 10,
                max_gross: SOL,
            },
        );
        let init_player = ix(
            house::ID,
            house::accounts::InitializePlayer {
                player: key(&player),
                config: house,
                player_ledger: ledger,
                system_program: SYSTEM,
            },
            house::instruction::InitializePlayer {},
        );
        send(&mut svm, &fee, &[init_house, init_shard], &[&admin]).unwrap();
        send(&mut svm, &fee, &[init_player], &[&player]).unwrap();
        let init_game = ix(
            games::ID,
            games::accounts::InitializeCoinflip {
                authority: key(&admin),
                house,
                config,
                oracle_queue: DEFAULT_QUEUE,
                vrf_program: VRF_PROGRAM_ID,
                system_program: SYSTEM,
            },
            games::instruction::InitializeCoinflip { edge_bps: EDGE },
        );
        send(&mut svm, &fee, &[init_game], &[&admin]).unwrap();
        let init_activity = ix(
            games::ID,
            games::accounts::InitializeActivity {
                player: key(&player),
                house,
                activity,
                system_program: SYSTEM,
            },
            games::instruction::InitializeActivity {},
        );
        send(&mut svm, &fee, &[init_activity], &[&player]).unwrap();
        Self {
            svm,
            fee,
            admin,
            player,
            stranger,
            house,
            config,
            shard,
            ledger,
            house_authority,
            program_identity,
            activity,
        }
    }

    fn bet(&self, id: u64) -> Pubkey {
        Pubkey::find_program_address(
            &[
                b"coinflip",
                self.house.as_ref(),
                key(&self.player).as_ref(),
                &id.to_le_bytes(),
            ],
            &games::ID,
        )
        .0
    }
    fn house_bet(&self, id: u64) -> Pubkey {
        Pubkey::find_program_address(
            &[
                b"bet",
                self.house.as_ref(),
                key(&self.player).as_ref(),
                &id.to_le_bytes(),
            ],
            &house::ID,
        )
        .0
    }
    fn balance(&self, address: Pubkey) -> u64 {
        self.svm.get_balance(&addr(address)).unwrap_or(0)
    }
    fn snapshot(&self, id: u64) -> Vec<Option<Account>> {
        [
            self.house,
            self.config,
            self.shard,
            self.ledger,
            self.bet(id),
            self.house_bet(id),
            key(&self.player),
            DEFAULT_QUEUE,
            self.activity,
        ]
        .into_iter()
        .map(|key| self.svm.get_account(&addr(key)))
        .collect()
    }
    fn place_ix(&self, id: u64, side: u8, stake: u64) -> Instruction {
        ix(
            games::ID,
            games::accounts::PlaceCoinflip {
                player: key(&self.player),
                house: self.house,
                config: self.config,
                shard: self.shard,
                house_bet: self.house_bet(id),
                player_ledger: self.ledger,
                bet: self.bet(id),
                game_program: games::ID,
                house_authority: self.house_authority,
                program_identity: self.program_identity,
                oracle_queue: DEFAULT_QUEUE,
                vrf_program: VRF_PROGRAM_ID,
                slot_hashes: SLOT_HASHES,
                house_program: house::ID,
                system_program: SYSTEM,
                activity: self.activity,
            },
            games::instruction::PlaceCoinflip { id, side, stake },
        )
    }
    fn place(&mut self, id: u64, side: u8, stake: u64) -> TxResult {
        let ix = self.place_ix(id, side, stake);
        send(&mut self.svm, &self.fee, &[ix], &[&self.player])
    }
    fn settle_ix(&self, id: u64) -> Instruction {
        ix(
            games::ID,
            games::accounts::SettleCoinflip {
                player: key(&self.player),
                house: self.house,
                config: self.config,
                shard: self.shard,
                house_bet: self.house_bet(id),
                player_ledger: self.ledger,
                bet: self.bet(id),
                game_program: games::ID,
                house_authority: self.house_authority,
                house_program: house::ID,
                activity: self.activity,
            },
            games::instruction::SettleCoinflip {},
        )
    }
    fn settle(&mut self, id: u64) -> TxResult {
        let ix = self.settle_ix(id);
        send(&mut self.svm, &self.fee, &[ix], &[])
    }
    fn fulfill(&mut self, slot: u8, randomness: [u8; 32]) -> TxResult {
        let queue = self.svm.get_account(&addr(DEFAULT_QUEUE)).unwrap();
        let queue = mock_vrf::read_queue(&queue.data).unwrap();
        let request = queue.requests[usize::from(slot)]
            .as_ref()
            .expect("queued request");
        let mut accounts = vec![
            AccountMeta::new(addr(DEFAULT_QUEUE), false),
            AccountMeta::new_readonly(addr(scoped_vrf_identity(&games::ID)), false),
            AccountMeta::new_readonly(addr(games::ID), false),
        ];
        accounts.extend(
            request
                .callback_accounts_metas
                .iter()
                .map(|meta| AccountMeta {
                    pubkey: addr(meta.pubkey),
                    is_signer: meta.is_signer,
                    is_writable: meta.is_writable,
                }),
        );
        let mut data = vec![mock_vrf::FULFILL_DISCRIMINATOR, slot];
        data.extend_from_slice(&randomness);
        let fulfill = Instruction {
            program_id: addr(VRF_PROGRAM_ID),
            accounts,
            data,
        };
        send(&mut self.svm, &self.fee, &[fulfill], &[])
    }
    fn callback_ix(&self, id: u64, randomness: [u8; 32]) -> Instruction {
        ix(
            games::ID,
            games::accounts::ConsumeRandomness {
                vrf_program_identity: scoped_vrf_identity(&games::ID),
                config: self.config,
                bet: self.bet(id),
            },
            games::instruction::ConsumeRandomness {
                randomness,
                id,
                request_tag: self.bet(id).to_bytes(),
            },
        )
    }
    fn close_ix(&self, id: u64) -> Instruction {
        ix(
            games::ID,
            games::accounts::CloseCoinflip {
                player: key(&self.player),
                house: self.house,
                bet: self.bet(id),
                player_ledger: self.ledger,
                activity: self.activity,
            },
            games::instruction::CloseCoinflip {},
        )
    }
    fn close(&mut self, id: u64) -> TxResult {
        let close = self.close_ix(id);
        send(&mut self.svm, &self.fee, &[close], &[])
    }
    fn set_time(&mut self, timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<solana_clock::Clock>();
        clock.unix_timestamp = timestamp;
        self.svm.set_sysvar(&clock);
    }
    fn mutate_request(&mut self, slot: usize, mutate: impl FnOnce(&mut mock_vrf::Request)) {
        // Deliberate provider-fault injection, not an ability available to a user.
        let mut account = self.svm.get_account(&addr(DEFAULT_QUEUE)).unwrap();
        let mut queue = mock_vrf::read_queue(&account.data).unwrap();
        mutate(queue.requests[slot].as_mut().unwrap());
        mock_vrf::write_queue(&mut account.data, &queue).unwrap();
        self.svm.set_account(addr(DEFAULT_QUEUE), account).unwrap();
    }
}

#[test]
fn place_reserves_exact_gross_payout_and_binds_immutable_choice_to_request() {
    let mut env = Env::new();
    let queue_before = env.balance(DEFAULT_QUEUE);
    env.place(1, 1, STAKE).unwrap();
    let bet: CoinflipBet = read(&env.svm, env.bet(1));
    assert_eq!(
        (bet.side, bet.stake, bet.max_gross, bet.status),
        (1, STAKE, PAYOUT, 0)
    );
    assert_eq!(bet.request_tag, env.bet(1).to_bytes());
    assert_eq!(
        read::<HouseShard>(&env.svm, env.shard).reserved,
        PAYOUT - STAKE
    );
    assert_eq!(read::<PlayerLedger>(&env.svm, env.ledger).last_bet_id, 1);
    assert_eq!(
        env.balance(DEFAULT_QUEUE),
        queue_before + mock_vrf::REQUEST_FEE
    );
    assert_eq!(read::<CoinflipConfig>(&env.svm, env.config).edge_bps, EDGE);
    let queue = env.svm.get_account(&addr(DEFAULT_QUEUE)).unwrap();
    let queue = mock_vrf::read_queue(&queue.data).unwrap();
    let request = queue.requests[0].as_ref().unwrap();
    assert_eq!(request.callback_program_id, games::ID);
    assert_eq!(request.caller_seed, env.bet(1).to_bytes());
    assert_eq!(
        request.callback_discriminator,
        games::instruction::ConsumeRandomness::DISCRIMINATOR
    );
    let mut args = 1_u64.to_le_bytes().to_vec();
    args.extend_from_slice(&env.bet(1).to_bytes());
    assert_eq!(request.callback_args, args);
    assert_eq!(request.callback_accounts_metas.len(), 2);
    assert_eq!(request.callback_accounts_metas[0].pubkey, env.config);
    assert!(!request.callback_accounts_metas[0].is_writable);
    assert!(!request.callback_accounts_metas[0].is_signer);
    assert_eq!(request.callback_accounts_metas[1].pubkey, env.bet(1));
    assert!(request.callback_accounts_metas[1].is_writable);
    assert!(!request.callback_accounts_metas[1].is_signer);
}

#[test]
fn all_choice_result_combinations_pay_correctly_and_return_house_receipt_rent() {
    for side in [0, 1] {
        for outcome in [0, 1] {
            let mut env = Env::new();
            let player_before = env.balance(key(&env.player));
            let shard_before = env.balance(env.shard);
            env.place(1, side, STAKE).unwrap();
            let game_rent = env.balance(env.bet(1));
            let mut randomness = [92; 32];
            randomness[0] = outcome;
            let pending_balance = env.balance(key(&env.player));
            let custody_keys = [env.house_bet(1), env.shard, env.ledger];
            let custody_before = custody_keys.map(|address| env.svm.get_account(&addr(address)));
            env.fulfill(0, randomness).unwrap();
            assert_eq!(
                custody_keys.map(|address| env.svm.get_account(&addr(address))),
                custody_before
            );
            assert_eq!(env.balance(key(&env.player)), pending_balance);
            assert_eq!(
                read::<CoinflipBet>(&env.svm, env.bet(1)).status,
                games::COINFLIP_READY
            );
            assert_eq!(
                read::<HouseShard>(&env.svm, env.shard).reserved,
                PAYOUT - STAKE
            );
            env.settle(1).unwrap(); // Fee payer can settle without player/admin signatures.
            let expected = if side == outcome { PAYOUT } else { 0 };
            let bet: CoinflipBet = read(&env.svm, env.bet(1));
            assert_eq!(
                (bet.status, bet.payout, bet.randomness),
                (games::COINFLIP_SETTLED, expected, randomness)
            );
            assert_eq!(
                env.balance(key(&env.player)),
                player_before - STAKE - game_rent - mock_vrf::REQUEST_FEE + expected
            );
            assert_eq!(env.balance(env.shard), shard_before + STAKE - expected);
            assert_eq!(env.balance(env.house_bet(1)), 0);
            if let Some(closed) = env.svm.get_account(&addr(env.house_bet(1))) {
                assert_eq!(closed.owner, addr(SYSTEM));
                assert!(closed.data.is_empty());
            }
            assert_eq!(read::<HouseShard>(&env.svm, env.shard).reserved, 0);
            assert_eq!(read::<HouseShard>(&env.svm, env.shard).open_bets, 0);
        }
    }
}

#[test]
fn no_settlement_before_randomness_and_no_admin_or_wallet_callback() {
    let mut env = Env::new();
    env.place(1, 0, STAKE).unwrap();
    let before = env.snapshot(1);
    error_named(env.settle(1), "BetNotReady");
    let mut unsigned = env.callback_ix(1, [0; 32]);
    unsigned.accounts[0].is_signer = false;
    error_named(
        send(&mut env.svm, &env.fee, &[unsigned], &[]),
        "AccountNotSigner",
    );
    let mut forged = env.callback_ix(1, [0; 32]);
    forged.accounts[0].pubkey = env.admin.pubkey();
    error_named(
        send(&mut env.svm, &env.fee, &[forged], &[&env.admin]),
        "UnauthorizedOracle",
    );
    assert_eq!(env.snapshot(1), before);
}

#[test]
fn wrong_callback_id_or_tag_cannot_consume_randomness_or_lose_queued_request() {
    for wrong_id in [false, true] {
        let mut env = Env::new();
        env.place(1, 0, STAKE).unwrap();
        let valid_queue = env.svm.get_account(&addr(DEFAULT_QUEUE)).unwrap();
        env.mutate_request(0, |request| {
            if wrong_id {
                request.callback_args[..8].copy_from_slice(&2_u64.to_le_bytes());
            } else {
                request.callback_args[8] ^= 1;
            }
        });
        let before = env.snapshot(1);
        error_named(env.fulfill(0, [0; 32]), "WrongRequest");
        assert_eq!(env.snapshot(1), before);
        env.svm
            .set_account(addr(DEFAULT_QUEUE), valid_queue)
            .unwrap();
        env.fulfill(0, [0; 32]).unwrap();
        env.settle(1).unwrap();
    }
}

#[test]
fn a_callback_for_one_bet_cannot_update_another_bet() {
    let mut env = Env::new();
    env.place(1, 0, STAKE).unwrap();
    env.place(2, 1, STAKE).unwrap();
    let second = env.bet(2);
    env.mutate_request(0, |request| {
        request.callback_accounts_metas[1].pubkey = second
    });
    let first_before = env.snapshot(1);
    let second_before = env.svm.get_account(&addr(second));
    error_named(env.fulfill(0, [0; 32]), "WrongRequest");
    assert_eq!(env.snapshot(1), first_before);
    assert_eq!(env.svm.get_account(&addr(second)), second_before);
}

#[test]
fn duplicate_callback_and_duplicate_settlement_cannot_change_or_pay_outcome_twice() {
    let mut env = Env::new();
    env.place(1, 0, STAKE).unwrap();
    let queued = env.svm.get_account(&addr(DEFAULT_QUEUE)).unwrap();
    env.fulfill(0, [0; 32]).unwrap();
    // Replay a registered callback as a synthetic provider fault.
    env.svm.set_account(addr(DEFAULT_QUEUE), queued).unwrap();
    let before = env.snapshot(1);
    error_named(env.fulfill(0, [1; 32]), "RandomnessAlreadyConsumed");
    assert_eq!(env.snapshot(1), before);
    env.settle(1).unwrap();
    let before = env.snapshot(1);
    assert!(env.settle(1).is_err()); // Closed foreign house receipt cannot be reused.
    assert_eq!(env.snapshot(1), before);
    error_named(env.fulfill(0, [1; 32]), "RandomnessAlreadyConsumed");
    assert_eq!(env.snapshot(1), before);
}

#[test]
fn invalid_side_zero_and_oversized_stakes_never_create_a_request() {
    let mut env = Env::new();
    for (side, stake, error) in [
        (2, STAKE, "InvalidSide"),
        (0, 0, "InvalidStake"),
        (1, SOL / 10 + 1, "StakeExceedsLimit"),
        (0, u64::MAX, "PayoutOverflow"),
    ] {
        let before = env.snapshot(1);
        error_named(env.place(1, side, stake), error);
        assert_eq!(env.snapshot(1), before);
    }
}

#[test]
fn insufficient_oracle_fee_rolls_back_stake_escrows_nonce_and_queue() {
    let mut env = Env::new();
    let game_rent = env
        .svm
        .minimum_balance_for_rent_exemption(8 + <CoinflipBet as anchor_lang::Space>::INIT_SPACE);
    let receipt_rent = env.svm.minimum_balance_for_rent_exemption(
        8 + <house::BetReceipt as anchor_lang::Space>::INIT_SPACE,
    );
    let mut player = env.svm.get_account(&env.player.pubkey()).unwrap();
    player.lamports = STAKE + game_rent + receipt_rent;
    env.svm.set_account(env.player.pubkey(), player).unwrap();
    let before = env.snapshot(1);
    let err = env.place(1, 0, STAKE).unwrap_err();
    assert!(
        err.meta
            .logs
            .iter()
            .any(|line| line.contains("insufficient lamports")),
        "{err:?}"
    );
    assert_eq!(env.snapshot(1), before);
    env.svm
        .airdrop(&env.player.pubkey(), mock_vrf::REQUEST_FEE + STAKE)
        .unwrap();
    env.place(1, 0, STAKE).unwrap();
}

#[test]
fn full_oracle_queue_rejects_new_bet_without_charging_or_consuming_nonce() {
    let mut env = Env::new();
    for id in 1..=mock_vrf::MAX_REQUESTS as u64 {
        env.place(id, 0, STAKE).unwrap();
    }
    let next = mock_vrf::MAX_REQUESTS as u64 + 1;
    let before = env.snapshot(next);
    let err = env.place(next, 0, STAKE).unwrap_err();
    assert!(
        format!("{:?}", err.err).contains("AccountDataTooSmall"),
        "{err:?}"
    );
    assert_eq!(env.snapshot(next), before);
    env.fulfill(0, [0; 32]).unwrap();
    env.place(next, 0, STAKE).unwrap();
}

#[test]
fn wrong_player_and_wrong_program_accounts_cannot_redirect_settlement() {
    let mut env = Env::new();
    env.place(1, 0, STAKE).unwrap();
    env.fulfill(0, [0; 32]).unwrap();
    let before = env.snapshot(1);
    let mut wrong_player = env.settle_ix(1);
    wrong_player.accounts[0].pubkey = env.stranger.pubkey();
    error_named(
        send(&mut env.svm, &env.fee, &[wrong_player], &[]),
        "WrongPlayer",
    );
    let mut wrong_program = env.settle_ix(1);
    wrong_program.accounts[7].pubkey = addr(house::ID);
    error_named(
        send(&mut env.svm, &env.fee, &[wrong_program], &[]),
        "ConstraintAddress",
    );
    assert_eq!(env.snapshot(1), before);
    env.settle(1).unwrap();
}

#[test]
fn pause_blocks_new_game_but_does_not_block_callback_or_settlement() {
    let mut env = Env::new();
    env.place(1, 0, STAKE).unwrap();
    let pause = ix(
        house::ID,
        house::accounts::SetPaused {
            authority: key(&env.admin),
            config: env.house,
        },
        house::instruction::SetPaused { paused: true },
    );
    send(&mut env.svm, &env.fee, &[pause], &[&env.admin]).unwrap();
    let before = env.snapshot(2);
    error_named(env.place(2, 0, STAKE), "HousePaused");
    assert_eq!(env.snapshot(2), before);
    env.fulfill(0, [0; 32]).unwrap();
    env.settle(1).unwrap();
}

#[test]
fn players_signature_is_required_for_the_game_and_its_fee() {
    let mut env = Env::new();
    let mut place = env.place_ix(1, 0, STAKE);
    place.accounts[0].is_signer = false;
    let before = env.snapshot(1);
    error_named(
        send(&mut env.svm, &env.fee, &[place], &[]),
        "AccountNotSigner",
    );
    assert_eq!(env.snapshot(1), before);
}

#[test]
fn queue_key_owner_and_oracle_program_are_all_bound_before_funds_move() {
    let mut env = Env::new();
    let before = env.snapshot(1);
    let mut wrong_queue = env.place_ix(1, 0, STAKE);
    wrong_queue.accounts[10].pubkey = env.stranger.pubkey();
    error_named(
        send(&mut env.svm, &env.fee, &[wrong_queue], &[&env.player]),
        "WrongQueue",
    );
    assert_eq!(env.snapshot(1), before);
    let mut wrong_program = env.place_ix(1, 0, STAKE);
    wrong_program.accounts[11].pubkey = addr(house::ID);
    error_named(
        send(&mut env.svm, &env.fee, &[wrong_program], &[&env.player]),
        "InvalidProgramId",
    );
    assert_eq!(env.snapshot(1), before);
    // Synthetic counterfeit queue owner; an external user cannot assign this PDA.
    let mut queue = env.svm.get_account(&addr(DEFAULT_QUEUE)).unwrap();
    queue.owner = addr(SYSTEM);
    env.svm.set_account(addr(DEFAULT_QUEUE), queue).unwrap();
    let before = env.snapshot(1);
    error_named(env.place(1, 0, STAKE), "WrongQueueOwner");
    assert_eq!(env.snapshot(1), before);
}

#[test]
fn settled_game_receipt_can_close_without_losing_activity_or_replay_protection() {
    let mut env = Env::new();
    env.set_time(3_601);
    env.place(1, 0, STAKE).unwrap();
    error_named(env.close(1), "BetNotSettled");
    env.fulfill(0, [0; 32]).unwrap();
    error_named(env.close(1), "BetNotSettled");
    env.settle(1).unwrap();
    let stats: GamePlayerActivity = read(&env.svm, env.activity);
    assert_eq!(stats.total_wagered_lamports, u128::from(STAKE));
    assert_eq!(stats.total_payout_lamports, u128::from(PAYOUT));
    assert_eq!(stats.settled_bets, 1);
    assert_eq!(stats.last_settled_at, 3_601);
    assert_eq!(
        (
            stats.current.epoch,
            stats.current.wagered_lamports,
            stats.current.bet_count
        ),
        (1, u128::from(STAKE), 1)
    );
    let donation = solana_system_interface::instruction::transfer(
        &env.stranger.pubkey(),
        &addr(env.bet(1)),
        73,
    );
    send(&mut env.svm, &env.fee, &[donation], &[&env.stranger]).unwrap();
    let returned = env.balance(env.bet(1));
    let player_before = env.balance(key(&env.player));
    let activity_before = env.svm.get_account(&addr(env.activity));
    let ledger_before = env.svm.get_account(&addr(env.ledger));
    env.close(1).unwrap();
    assert_eq!(env.balance(key(&env.player)), player_before + returned);
    assert_eq!(env.balance(env.bet(1)), 0);
    assert_eq!(env.svm.get_account(&addr(env.activity)), activity_before);
    assert_eq!(env.svm.get_account(&addr(env.ledger)), ledger_before);
    let before = env.snapshot(1);
    error_named(env.place(1, 1, STAKE), "InvalidBetNonce");
    assert_eq!(env.snapshot(1), before);
    error_named(env.close(1), "AccountNotInitialized");
    env.place(2, 1, STAKE).unwrap();
}

#[test]
fn activity_rolls_hours_forward_and_preserves_lifetime_totals_across_gaps() {
    let mut env = Env::new();
    for (id, timestamp) in [(1, 3_599), (2, 3_600), (3, 3_601)] {
        env.set_time(timestamp);
        env.place(id, 0, STAKE).unwrap();
        env.fulfill(0, [0; 32]).unwrap();
        env.settle(id).unwrap();
        env.close(id).unwrap();
    }
    let stats: GamePlayerActivity = read(&env.svm, env.activity);
    assert_eq!(
        (
            stats.current.epoch,
            stats.current.bet_count,
            stats.current.wagered_lamports
        ),
        (1, 2, u128::from(STAKE) * 2)
    );
    assert_eq!(
        (
            stats.previous.epoch,
            stats.previous.bet_count,
            stats.previous.wagered_lamports
        ),
        (0, 1, u128::from(STAKE))
    );
    env.set_time(4 * 3_600);
    env.place(4, 0, STAKE).unwrap();
    env.fulfill(0, [1; 32]).unwrap();
    env.settle(4).unwrap();
    let stats: GamePlayerActivity = read(&env.svm, env.activity);
    assert_eq!((stats.current.epoch, stats.current.bet_count), (4, 1));
    assert_eq!(
        (
            stats.previous.epoch,
            stats.previous.bet_count,
            stats.previous.wagered_lamports
        ),
        (3, 0, 0)
    );
    assert_eq!(stats.total_wagered_lamports, u128::from(STAKE) * 4);
    assert_eq!(stats.total_payout_lamports, u128::from(PAYOUT) * 3);
    assert_eq!(stats.settled_bets, 4);
}

#[test]
fn clock_regression_does_not_block_payout_or_relabel_hourly_buckets() {
    let mut env = Env::new();
    for (id, timestamp, recorded) in [
        (1, 7_201, true),
        (2, 7_199, true),
        (3, 3_599, false),
        (4, -1, false),
    ] {
        env.set_time(timestamp); // Synthetic consensus-clock regression fixture.
        env.place(id, 0, STAKE).unwrap();
        env.fulfill(0, [0; 32]).unwrap();
        env.settle(id).unwrap();
        let bet: CoinflipBet = read(&env.svm, env.bet(id));
        assert_eq!(bet.settled_at, timestamp);
        assert_eq!(bet.hour_recorded, recorded);
        env.close(id).unwrap();
    }
    let stats: GamePlayerActivity = read(&env.svm, env.activity);
    assert_eq!((stats.current.epoch, stats.current.bet_count), (2, 1));
    assert_eq!((stats.previous.epoch, stats.previous.bet_count), (1, 1));
    assert_eq!(stats.last_settled_at, 7_201);
    assert_eq!(stats.settled_bets, 4);
    assert_eq!(stats.total_wagered_lamports, u128::from(STAKE) * 4);
    assert_eq!(stats.total_payout_lamports, u128::from(PAYOUT) * 4);
}

#[test]
fn duplicate_settlement_and_close_reopen_transaction_cannot_double_credit_activity() {
    let mut env = Env::new();
    env.place(1, 0, STAKE).unwrap();
    env.fulfill(0, [0; 32]).unwrap();
    env.settle(1).unwrap();
    let before = env.snapshot(1);
    assert!(env.settle(1).is_err());
    assert_eq!(env.snapshot(1), before);
    let close = env.close_ix(1);
    let reopen = env.place_ix(1, 1, STAKE);
    error_named(
        send(&mut env.svm, &env.fee, &[close, reopen], &[&env.player]),
        "InvalidBetNonce",
    );
    assert_eq!(env.snapshot(1), before);
    env.close(1).unwrap();
    assert_eq!(
        read::<GamePlayerActivity>(&env.svm, env.activity).settled_bets,
        1
    );
}

#[test]
fn cleanup_recipient_cannot_be_changed_and_activity_cannot_be_reset() {
    let mut env = Env::new();
    env.place(1, 0, STAKE).unwrap();
    env.fulfill(0, [0; 32]).unwrap();
    env.settle(1).unwrap();
    let before = env.snapshot(1);
    let mut close = env.close_ix(1);
    close.accounts[0].pubkey = env.stranger.pubkey();
    error_named(send(&mut env.svm, &env.fee, &[close], &[]), "WrongPlayer");
    assert_eq!(env.snapshot(1), before);
    let reset = ix(
        games::ID,
        games::accounts::InitializeActivity {
            player: key(&env.player),
            house: env.house,
            activity: env.activity,
            system_program: SYSTEM,
        },
        games::instruction::InitializeActivity {},
    );
    let error = send(&mut env.svm, &env.fee, &[reset], &[&env.player]).unwrap_err();
    assert!(
        error
            .meta
            .logs
            .iter()
            .any(|line| line.contains("already in use")),
        "{error:?}"
    );
    assert_eq!(env.snapshot(1), before);
}

#[test]
fn missing_activity_prevents_admission_before_it_can_hinder_permissionless_payout() {
    let mut env = Env::new();
    env.player = Keypair::new();
    env.svm.airdrop(&env.player.pubkey(), 10 * SOL).unwrap();
    env.ledger = Pubkey::find_program_address(
        &[b"player", env.house.as_ref(), key(&env.player).as_ref()],
        &house::ID,
    )
    .0;
    env.activity = Pubkey::find_program_address(
        &[b"activity", env.house.as_ref(), key(&env.player).as_ref()],
        &games::ID,
    )
    .0;
    let init_ledger = ix(
        house::ID,
        house::accounts::InitializePlayer {
            player: key(&env.player),
            config: env.house,
            player_ledger: env.ledger,
            system_program: SYSTEM,
        },
        house::instruction::InitializePlayer {},
    );
    send(&mut env.svm, &env.fee, &[init_ledger], &[&env.player]).unwrap();
    let before = env.snapshot(1);
    error_named(env.place(1, 0, STAKE), "AccountNotInitialized");
    assert_eq!(env.snapshot(1), before);
    let init_activity = ix(
        games::ID,
        games::accounts::InitializeActivity {
            player: key(&env.player),
            house: env.house,
            activity: env.activity,
            system_program: SYSTEM,
        },
        games::instruction::InitializeActivity {},
    );
    send(&mut env.svm, &env.fee, &[init_activity], &[&env.player]).unwrap();
    env.place(1, 0, STAKE).unwrap();
    env.fulfill(0, [0; 32]).unwrap();
    env.settle(1).unwrap();
}

#[test]
fn ready_settle_close_reopen_rolls_back_but_settle_close_commits_once() {
    let mut env = Env::new();
    env.place(1, 0, STAKE).unwrap();
    env.fulfill(0, [0; 32]).unwrap();
    let before = env.snapshot(1);
    let settle = env.settle_ix(1);
    let close = env.close_ix(1);
    let reopen = env.place_ix(1, 1, STAKE);
    error_named(
        send(
            &mut env.svm,
            &env.fee,
            &[settle, close, reopen],
            &[&env.player],
        ),
        "InvalidBetNonce",
    );
    // Fees are paid by a separate account; every game/custody account rolls back.
    assert_eq!(env.snapshot(1), before);
    assert_eq!(
        read::<CoinflipBet>(&env.svm, env.bet(1)).status,
        games::COINFLIP_READY
    );
    assert_eq!(
        read::<GamePlayerActivity>(&env.svm, env.activity).settled_bets,
        0
    );

    let player_before = env.balance(key(&env.player));
    let shard_before = env.balance(env.shard);
    let game_rent = env.balance(env.bet(1));
    let house_rent = env.balance(env.house_bet(1)) - STAKE;
    let ledger_before = env.svm.get_account(&addr(env.ledger));
    let settle = env.settle_ix(1);
    let close = env.close_ix(1);
    // A keeper can pay both instruction fees without a player/admin signature.
    send(&mut env.svm, &env.fee, &[settle, close], &[]).unwrap();
    assert_eq!(
        env.balance(key(&env.player)),
        player_before + PAYOUT + game_rent + house_rent
    );
    assert_eq!(env.balance(env.shard), shard_before + STAKE - PAYOUT);
    let stats: GamePlayerActivity = read(&env.svm, env.activity);
    assert_eq!(
        (
            stats.total_wagered_lamports,
            stats.total_payout_lamports,
            stats.settled_bets,
            stats.current.bet_count,
        ),
        (u128::from(STAKE), u128::from(PAYOUT), 1, 1)
    );
    assert_eq!(env.svm.get_account(&addr(env.ledger)), ledger_before);
    assert_eq!(read::<HouseShard>(&env.svm, env.shard).reserved, 0);
    assert_eq!(read::<HouseShard>(&env.svm, env.shard).open_bets, 0);
    for address in [env.bet(1), env.house_bet(1)] {
        assert_eq!(env.balance(address), 0);
        if let Some(closed) = env.svm.get_account(&addr(address)) {
            assert_eq!(closed.owner, addr(SYSTEM));
            assert!(closed.data.is_empty());
        }
    }
}

#[test]
fn another_players_real_ledger_and_activity_cannot_replace_bound_accounts() {
    let mut env = Env::new();
    let other_player = key(&env.stranger);
    let other_ledger = Pubkey::find_program_address(
        &[b"player", env.house.as_ref(), other_player.as_ref()],
        &house::ID,
    )
    .0;
    let other_activity = Pubkey::find_program_address(
        &[b"activity", env.house.as_ref(), other_player.as_ref()],
        &games::ID,
    )
    .0;
    let init_ledger = ix(
        house::ID,
        house::accounts::InitializePlayer {
            player: other_player,
            config: env.house,
            player_ledger: other_ledger,
            system_program: SYSTEM,
        },
        house::instruction::InitializePlayer {},
    );
    let init_activity = ix(
        games::ID,
        games::accounts::InitializeActivity {
            player: other_player,
            house: env.house,
            activity: other_activity,
            system_program: SYSTEM,
        },
        games::instruction::InitializeActivity {},
    );
    // These are valid program-owned accounts created by a different real signer.
    send(
        &mut env.svm,
        &env.fee,
        &[init_ledger, init_activity],
        &[&env.stranger],
    )
    .unwrap();
    assert_eq!(
        read::<PlayerLedger>(&env.svm, other_ledger).player,
        other_player
    );
    assert_eq!(
        read::<GamePlayerActivity>(&env.svm, other_activity).player,
        other_player
    );
    let other_keys = [other_ledger, other_activity, other_player];
    let other_before = other_keys.map(|address| env.svm.get_account(&addr(address)));

    let before = env.snapshot(1);
    for (index, replacement) in [(5, other_ledger), (15, other_activity)] {
        let mut place = env.place_ix(1, 0, STAKE);
        place.accounts[index].pubkey = addr(replacement);
        error_named(
            send(&mut env.svm, &env.fee, &[place], &[&env.player]),
            "ConstraintSeeds",
        );
        assert_eq!(env.snapshot(1), before);
        assert_eq!(
            other_keys.map(|address| env.svm.get_account(&addr(address))),
            other_before
        );
    }
    env.place(1, 0, STAKE).unwrap();
    env.fulfill(0, [0; 32]).unwrap();
    let before = env.snapshot(1);
    for (index, replacement) in [(5, other_ledger), (10, other_activity)] {
        let mut settle = env.settle_ix(1);
        settle.accounts[index].pubkey = addr(replacement);
        error_named(
            send(&mut env.svm, &env.fee, &[settle], &[]),
            "ConstraintSeeds",
        );
        assert_eq!(env.snapshot(1), before);
        assert_eq!(
            other_keys.map(|address| env.svm.get_account(&addr(address))),
            other_before
        );
    }
    env.settle(1).unwrap();
    let before = env.snapshot(1);
    for (index, replacement) in [(3, other_ledger), (4, other_activity)] {
        let mut close = env.close_ix(1);
        close.accounts[index].pubkey = addr(replacement);
        error_named(
            send(&mut env.svm, &env.fee, &[close], &[]),
            "ConstraintSeeds",
        );
        assert_eq!(env.snapshot(1), before);
        assert_eq!(
            other_keys.map(|address| env.svm.get_account(&addr(address))),
            other_before
        );
    }
    env.close(1).unwrap();
    assert_eq!(
        other_keys.map(|address| env.svm.get_account(&addr(address))),
        other_before
    );
    assert_eq!(
        read::<GamePlayerActivity>(&env.svm, env.activity).settled_bets,
        1
    );
    assert_eq!(read::<PlayerLedger>(&env.svm, env.ledger).last_bet_id, 1);
}

#[test]
fn wallet_onboarding_and_keeper_cleanup_fit_legacy_transaction_packets() {
    let mut env = Env::new();
    env.player = Keypair::new();
    env.svm.airdrop(&env.player.pubkey(), 10 * SOL).unwrap();
    env.ledger = Pubkey::find_program_address(
        &[b"player", env.house.as_ref(), key(&env.player).as_ref()],
        &house::ID,
    )
    .0;
    env.activity = Pubkey::find_program_address(
        &[b"activity", env.house.as_ref(), key(&env.player).as_ref()],
        &games::ID,
    )
    .0;
    let init_ledger = ix(
        house::ID,
        house::accounts::InitializePlayer {
            player: key(&env.player),
            config: env.house,
            player_ledger: env.ledger,
            system_program: SYSTEM,
        },
        house::instruction::InitializePlayer {},
    );
    let init_activity = ix(
        games::ID,
        games::accounts::InitializeActivity {
            player: key(&env.player),
            house: env.house,
            activity: env.activity,
            system_program: SYSTEM,
        },
        games::instruction::InitializeActivity {},
    );
    let fixture_house = env.house.to_string();
    let execute = |svm: &mut LiteSVM,
                   payer: &Keypair,
                   instructions: &[Instruction],
                   label: &str| {
        svm.expire_blockhash();
        let transaction = Transaction::new(
            &[payer],
            Message::new(instructions, Some(&payer.pubkey())),
            svm.latest_blockhash(),
        );
        assert_eq!(transaction.signatures.len(), 1);
        // One signature has a one-byte compact length followed by 64 bytes.
        // message_data() supplies the actual serialized legacy message bytes.
        let packet_bytes = 1 + 64 + transaction.message_data().len();
        assert!(packet_bytes <= 1_232, "{label}: {packet_bytes} bytes");
        let signature = transaction.signatures[0].to_string();
        let account_keys: Vec<String> = transaction
            .message
            .account_keys
            .iter()
            .map(ToString::to_string)
            .collect();
        let compiled: Vec<_> = transaction
            .message
            .instructions
            .iter()
            .map(|instruction| {
                serde_json::json!({
                    "programIdIndex": instruction.program_id_index,
                    "accounts": instruction.accounts,
                    "dataBytes": instruction.data,
                })
            })
            .collect();
        let metadata = svm.send_transaction(transaction).unwrap();
        if let Ok(directory) = std::env::var("SOLLISH_EXPORT_INDEXER_FIXTURE") {
            let name = if label.starts_with("wallet initialize") {
                "first-wallet"
            } else if label.starts_with("keeper") {
                "settlement"
            } else {
                "repeat-wallet"
            };
            let fixture = serde_json::json!({
                "scope": "Actual LiteSVM runtime logs from house/games SBF and LOCAL MOCK VRF; not devnet or real proof. RPC message projection: instruction dataBytes is raw bytes, not RPC base58 data.",
                "house": fixture_house,
                "signature": signature,
                "packetBytes": packet_bytes,
                "computeUnits": metadata.compute_units_consumed,
                "transaction": {
                    "slot": svm.get_sysvar::<solana_clock::Clock>().slot,
                    "meta": { "err": null, "logMessages": metadata.logs },
                    "transaction": { "signatures": [signature], "message": { "accountKeys": account_keys, "instructions": compiled } }
                }
            });
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(
                PathBuf::from(directory).join(format!("litesvm-{name}.json")),
                serde_json::to_vec_pretty(&fixture).unwrap(),
            )
            .unwrap();
        }
        eprintln!(
            "{label}: legacy packet {packet_bytes} bytes; mock VRF fixture {} CU",
            metadata.compute_units_consumed
        );
    };
    let first_place = env.place_ix(1, 0, STAKE);
    let compute_limit = Instruction {
        program_id: addr(anchor_lang::pubkey!(
            "ComputeBudget111111111111111111111111111111"
        )),
        accounts: vec![],
        data: [vec![2], 300_000u32.to_le_bytes().to_vec()].concat(),
    };
    execute(
        &mut env.svm,
        &env.player,
        &[compute_limit, init_ledger, init_activity, first_place],
        "wallet initialize_player + initialize_activity + place",
    );
    assert_eq!(read::<PlayerLedger>(&env.svm, env.ledger).last_bet_id, 1);
    assert_eq!(
        read::<CoinflipBet>(&env.svm, env.bet(1)).status,
        games::COINFLIP_AWAITING
    );
    env.fulfill(0, [0; 32]).unwrap();
    let settle = env.settle_ix(1);
    let close = env.close_ix(1);
    execute(
        &mut env.svm,
        &env.fee,
        &[settle, close],
        "keeper settle + close",
    );
    assert_eq!(env.balance(env.bet(1)), 0);
    assert_eq!(env.balance(env.house_bet(1)), 0);
    assert_eq!(
        read::<GamePlayerActivity>(&env.svm, env.activity).settled_bets,
        1
    );
    let next_place = env.place_ix(2, 1, STAKE);
    execute(
        &mut env.svm,
        &env.player,
        &[next_place],
        "existing wallet place",
    );
    assert_eq!(read::<PlayerLedger>(&env.svm, env.ledger).last_bet_id, 2);
    assert_eq!(
        read::<GamePlayerActivity>(&env.svm, env.activity).settled_bets,
        1
    );
}

#[path = "support/rewarded.rs"]
mod rewarded;
