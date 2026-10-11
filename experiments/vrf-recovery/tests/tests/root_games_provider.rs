//! Opt-in, NON-PRODUCTION integration of unchanged root Games/House with the
//! pinned official provider SBF. No network, mock oracle, or disabled signature
//! verification. The callback tests explicitly transplant a real request between
//! VM queues: we do not possess the private key for Games' pinned live queue.
use anchor_lang::{AccountDeserialize, Discriminator, InstructionData, ToAccountMetas};
use curve25519_dalek::{constants::RISTRETTO_BASEPOINT_POINT, scalar::Scalar};
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_curve25519::{ristretto::PodRistrettoPoint, scalar::PodScalar};
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_program::{
    hash::{hash, hashv},
    pubkey,
    pubkey::Pubkey,
    sysvar,
};
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_vrf::vrf::compute_vrf;
use solana_vrf_api::{
    sdk,
    state::{oracle_queue_pda, QueueAccount, QueueItem},
};
use std::{fs, path::PathBuf};

const SOL: u64 = 1_000_000_000;
const STAKE: u64 = 10_000_000;
const MAX_PAYOUT: u64 = 19_600_000;
const ORACLE_FEE: u64 = 500_000;
const CLIENT_CU: u32 = 300_000;
const DEFAULT_QUEUE: Pubkey = pubkey!("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
const SYSTEM: Pubkey = pubkey!("11111111111111111111111111111111");
type TxResult = Result<TransactionMetadata, Box<FailedTransactionMetadata>>;
fn addr(key: Pubkey) -> Address {
    Address::new_from_array(key.to_bytes())
}
fn key(pair: &Keypair) -> Pubkey {
    Pubkey::new_from_array(pair.pubkey().to_bytes())
}
fn convert(ix: solana_program::instruction::Instruction) -> Instruction {
    Instruction {
        program_id: addr(ix.program_id),
        data: ix.data,
        accounts: ix
            .accounts
            .into_iter()
            .map(|a| AccountMeta {
                pubkey: addr(a.pubkey),
                is_signer: a.is_signer,
                is_writable: a.is_writable,
            })
            .collect(),
    }
}
fn ix(program: Pubkey, accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    convert(solana_program::instruction::Instruction {
        program_id: program,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    })
}
fn read<T: AccountDeserialize>(svm: &LiteSVM, address: Pubkey) -> T {
    T::try_deserialize(&mut svm.get_account(&addr(address)).unwrap().data.as_slice()).unwrap()
}
fn sha256(bytes: &[u8]) -> String {
    hash(bytes)
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn load_artifacts(svm: &mut LiteSVM) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("../../provider-build.json")).unwrap();
    assert_eq!(
        manifest["buildSpec"]["upstreamCommit"],
        "52b103c5d55d72e07456a445044b3c006cb87c1a"
    );
    assert_eq!(manifest["trackedSourceUnchanged"], true);
    assert_eq!(
        manifest["buildSpec"]["enabledFeatures"],
        serde_json::json!([])
    );
    assert_eq!(manifest["programId"], solana_vrf_api::ID.to_string());
    let provider =
        fs::read(root.join(".tooling/vrf-provider-build/artifacts/solana_vrf_program.so"))
            .expect("explicit provider artifact required; run run-games-provider.sh");
    assert_eq!(
        sha256(&provider),
        manifest["artifactSha256"].as_str().unwrap()
    );
    assert_eq!(
        provider.len() as u64,
        manifest["artifactBytes"].as_u64().unwrap()
    );
    svm.add_program(addr(solana_vrf_api::ID), &provider)
        .unwrap();
    let own_hashes = fs::read_to_string(root.join("target/deploy/artifacts.sha256")).unwrap();
    for (id, name) in [(house::ID, "house"), (games::ID, "games")] {
        let binary = fs::read(root.join(format!("target/deploy/{name}.so"))).unwrap();
        assert!(
            own_hashes
                .lines()
                .any(|line| line == format!("{}  target/deploy/{name}.so", sha256(&binary))),
            "root artifact manifest mismatch"
        );
        svm.add_program(addr(id), &binary).unwrap();
    }
}
struct Env {
    svm: LiteSVM,
    fee: Keypair,
    admin: Keypair,
    player: Keypair,
    oracle: Keypair,
    house: Pubkey,
    config: Pubkey,
    shard: Pubkey,
    ledger: Pubkey,
    activity: Pubkey,
}
impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        load_artifacts(&mut svm);
        let fee = Keypair::new_from_array([40; 32]);
        let admin = Keypair::new_from_array([41; 32]);
        let player = Keypair::new_from_array([43; 32]);
        let oracle = Keypair::new_from_array([42; 32]); // Public, local fixture; never a live oracle key.
        for pair in [&fee, &admin, &player, &oracle] {
            svm.airdrop(&pair.pubkey(), SOL * 10).unwrap();
        }
        // VM genesis authority fixture, preserving the provider executable bytes.
        let program = svm.get_account(&addr(solana_vrf_api::ID)).unwrap();
        assert_eq!(u32::from_le_bytes(program.data[..4].try_into().unwrap()), 2);
        let program_data = Address::new_from_array(program.data[4..36].try_into().unwrap());
        let mut deployment = svm.get_account(&program_data).unwrap();
        deployment.data[12] = 1;
        deployment.data[13..45].copy_from_slice(admin.pubkey().as_ref());
        svm.set_account(program_data, deployment).unwrap();
        svm.set_sysvar(&Clock {
            slot: 100,
            unix_timestamp: 1_000_000,
            ..Clock::default()
        });
        let mut slots = vec![];
        slots.extend(1u64.to_le_bytes());
        slots.extend(99u64.to_le_bytes());
        slots.extend([77; 32]);
        svm.set_account(
            addr(sysvar::slot_hashes::ID),
            Account {
                lamports: svm.minimum_balance_for_rent_exemption(slots.len()),
                data: slots,
                owner: addr(sysvar::ID),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
        let house = Pubkey::find_program_address(&[b"house", key(&admin).as_ref()], &house::ID).0;
        let config =
            Pubkey::find_program_address(&[b"coinflip_config", house.as_ref()], &games::ID).0;
        let shard = Pubkey::find_program_address(
            &[b"shard", house.as_ref(), &0u16.to_le_bytes()],
            &house::ID,
        )
        .0;
        let ledger = Pubkey::find_program_address(
            &[b"player", house.as_ref(), key(&player).as_ref()],
            &house::ID,
        )
        .0;
        let activity = Pubkey::find_program_address(
            &[b"activity", house.as_ref(), key(&player).as_ref()],
            &games::ID,
        )
        .0;
        let mut e = Self {
            svm,
            fee,
            admin,
            player,
            oracle,
            house,
            config,
            shard,
            ledger,
            activity,
        };
        e.send(
            &[convert(sdk::initialize(key(&e.admin)))],
            false,
            true,
            false,
        )
        .unwrap();
        let vrf_key = (Scalar::from_bytes_mod_order([9; 32]) * RISTRETTO_BASEPOINT_POINT)
            .compress()
            .to_bytes();
        e.send(
            &[convert(sdk::add_oracle(
                key(&e.admin),
                key(&e.oracle),
                vrf_key,
            ))],
            false,
            true,
            false,
        )
        .unwrap();
        for instruction in
            sdk::initialize_oracle_queue(key(&e.admin), key(&e.oracle), 0, Some(9500))
        {
            e.send(&[convert(instruction)], false, true, true).unwrap();
        }
        // Explicit VM genesis fixture: copy the officially initialized EMPTY queue
        // layout to Games' immutable DEFAULT_QUEUE. No callback at this address
        // can be signed by our test oracle; that limitation is tested below.
        let empty = e.svm.get_account(&addr(e.test_queue())).unwrap();
        e.svm.set_account(addr(DEFAULT_QUEUE), empty).unwrap();
        let initialize_house = ix(
            house::ID,
            house::accounts::InitializeHouse {
                authority: key(&e.admin),
                config: e.house,
                game_program: games::ID,
                system_program: SYSTEM,
            },
            house::instruction::InitializeHouse {
                game_program: games::ID,
            },
        );
        let initialize_shard = ix(
            house::ID,
            house::accounts::CreateShard {
                authority: key(&e.admin),
                config: e.house,
                shard: e.shard,
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
        let initialize_game = ix(
            games::ID,
            games::accounts::InitializeCoinflip {
                authority: key(&e.admin),
                house: e.house,
                config: e.config,
                oracle_queue: DEFAULT_QUEUE,
                vrf_program: solana_vrf_api::ID,
                system_program: SYSTEM,
            },
            games::instruction::InitializeCoinflip { edge_bps: 200 },
        );
        e.send(
            &[initialize_house, initialize_shard, initialize_game],
            false,
            true,
            false,
        )
        .unwrap();
        e
    }
    fn test_queue(&self) -> Pubkey {
        oracle_queue_pda(&key(&self.oracle), 0).0
    }
    fn bet(&self) -> Pubkey {
        Pubkey::find_program_address(
            &[
                b"coinflip",
                self.house.as_ref(),
                key(&self.player).as_ref(),
                &1u64.to_le_bytes(),
            ],
            &games::ID,
        )
        .0
    }
    fn house_bet(&self) -> Pubkey {
        Pubkey::find_program_address(
            &[
                b"bet",
                self.house.as_ref(),
                key(&self.player).as_ref(),
                &1u64.to_le_bytes(),
            ],
            &house::ID,
        )
        .0
    }
    fn house_authority(&self) -> Pubkey {
        Pubkey::find_program_address(&[b"house_authority", self.house.as_ref()], &games::ID).0
    }
    fn balance(&self, key: Pubkey) -> u64 {
        self.svm.get_balance(&addr(key)).unwrap_or(0)
    }
    fn send(
        &mut self,
        instructions: &[Instruction],
        player_pays: bool,
        admin: bool,
        oracle: bool,
    ) -> TxResult {
        self.svm.expire_blockhash();
        let payer = if player_pays { &self.player } else { &self.fee };
        let mut signers = vec![payer];
        if admin {
            signers.push(&self.admin);
        }
        if oracle {
            signers.push(&self.oracle);
        }
        let tx = Transaction::new(
            &signers,
            Message::new(instructions, Some(&payer.pubkey())),
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx).map_err(Box::new)
    }
    fn onboarding(&self) -> Vec<Instruction> {
        vec![
            ix(
                house::ID,
                house::accounts::InitializePlayer {
                    player: key(&self.player),
                    config: self.house,
                    player_ledger: self.ledger,
                    system_program: SYSTEM,
                },
                house::instruction::InitializePlayer {},
            ),
            ix(
                games::ID,
                games::accounts::InitializeActivity {
                    player: key(&self.player),
                    house: self.house,
                    activity: self.activity,
                    system_program: SYSTEM,
                },
                games::instruction::InitializeActivity {},
            ),
        ]
    }
    fn place_ix(&self) -> Instruction {
        self.place_ix_for_side(0)
    }
    fn place_ix_for_side(&self, side: u8) -> Instruction {
        ix(
            games::ID,
            games::accounts::PlaceCoinflip {
                player: key(&self.player),
                house: self.house,
                config: self.config,
                shard: self.shard,
                house_bet: self.house_bet(),
                player_ledger: self.ledger,
                bet: self.bet(),
                game_program: games::ID,
                house_authority: self.house_authority(),
                program_identity: Pubkey::find_program_address(&[b"identity"], &games::ID).0,
                oracle_queue: DEFAULT_QUEUE,
                vrf_program: solana_vrf_api::ID,
                slot_hashes: sysvar::slot_hashes::ID,
                house_program: house::ID,
                system_program: SYSTEM,
                activity: self.activity,
            },
            games::instruction::PlaceCoinflip {
                id: 1,
                side,
                stake: STAKE,
            },
        )
    }
    fn first_place_ixs(&self) -> Vec<Instruction> {
        let mut instructions = vec![ComputeBudgetInstruction::set_compute_unit_limit(CLIENT_CU)];
        instructions.extend(self.onboarding());
        instructions.push(self.place_ix());
        instructions
    }
    fn place(&mut self) -> TxResult {
        self.send(&self.first_place_ixs(), true, false, false)
    }
    fn snapshot(&self) -> Vec<Option<Account>> {
        [
            self.house,
            self.config,
            self.shard,
            self.ledger,
            self.activity,
            self.house_bet(),
            self.bet(),
            DEFAULT_QUEUE,
        ]
        .into_iter()
        .map(|k| self.svm.get_account(&addr(k)))
        .collect()
    }
    fn input(&self, queue: Pubkey) -> [u8; 32] {
        let mut data = self.svm.get_account(&addr(queue)).unwrap().data;
        let view = QueueAccount::load(&mut data).unwrap();
        let items: Vec<_> = view
            .iter_items()
            .filter(|i| i.used == 1 && i.callback_program_id == games::ID.to_bytes())
            .collect();
        assert_eq!(items.len(), 1);
        items[0].id
    }
    fn proof(&self, input: [u8; 32], secret: u8) -> ([u8; 32], [u8; 32], [u8; 32], [u8; 32]) {
        let (out, (base, hash, scalar)) =
            compute_vrf(Scalar::from_bytes_mod_order([secret; 32]), &input);
        (
            out.to_bytes(),
            base.to_bytes(),
            hash.to_bytes(),
            scalar.to_bytes(),
        )
    }
    fn fulfill_ix(&self, queue: Pubkey, secret: u8) -> Instruction {
        let input = self.input(queue);
        let (out, base, hash, scalar) = self.proof(input, secret);
        let mut instruction = sdk::provide_randomness(
            key(&self.oracle),
            queue,
            games::ID,
            input,
            PodRistrettoPoint(out),
            PodRistrettoPoint(base),
            PodRistrettoPoint(hash),
            PodScalar(scalar),
        );
        instruction.accounts.extend([
            solana_program::instruction::AccountMeta::new_readonly(self.config, false),
            solana_program::instruction::AccountMeta::new(self.bet(), false),
        ]);
        convert(instruction)
    }
    fn advance(&mut self, seconds: i64) {
        let mut c: Clock = self.svm.get_sysvar();
        c.slot += 1;
        c.unix_timestamp += seconds;
        self.svm.set_sysvar(&c);
    }
    fn transplant_request_to_test_oracle_queue(&mut self) {
        // VM-ONLY BRIDGE. Copy the exact request queue bytes and paid request fee;
        // no request args, Games state, House state, or signer rules are rewritten.
        // This is NOT evidence that the live queue's oracle accepts/fulfills it.
        let request = self.svm.get_account(&addr(DEFAULT_QUEUE)).unwrap();
        let empty = self.svm.get_account(&addr(self.test_queue())).unwrap();
        self.svm
            .set_account(addr(self.test_queue()), request)
            .unwrap();
        self.svm.set_account(addr(DEFAULT_QUEUE), empty).unwrap();
    }
    fn settle_ix(&self) -> Instruction {
        ix(
            games::ID,
            games::accounts::SettleCoinflip {
                player: key(&self.player),
                house: self.house,
                config: self.config,
                shard: self.shard,
                house_bet: self.house_bet(),
                player_ledger: self.ledger,
                bet: self.bet(),
                game_program: games::ID,
                house_authority: self.house_authority(),
                house_program: house::ID,
                activity: self.activity,
            },
            games::instruction::SettleCoinflip {},
        )
    }
    fn close_ix(&self) -> Instruction {
        ix(
            games::ID,
            games::accounts::CloseCoinflip {
                player: key(&self.player),
                house: self.house,
                bet: self.bet(),
                player_ledger: self.ledger,
                activity: self.activity,
            },
            games::instruction::CloseCoinflip {},
        )
    }
    fn populate_queue(&mut self, bytes: usize, records: usize) {
        // Synthetic occupancy only, not users/concurrency. Short unrelated requests.
        let mut queue = self.svm.get_account(&addr(DEFAULT_QUEUE)).unwrap();
        queue.data.resize(bytes, 0);
        queue.lamports = self.svm.minimum_balance_for_rent_exemption(bytes);
        let mut view = QueueAccount::load(&mut queue.data).unwrap();
        for i in 0..records {
            let mut id = [0u8; 32];
            id[..8].copy_from_slice(&(i as u64).to_le_bytes());
            let item = QueueItem {
                slot: 90,
                id,
                callback_program_id: [71; 32],
                used: 1,
                identity_mode: 1,
                created_at: QueueItem::created_at_from(1_000_000),
                ..QueueItem::default()
            };
            view.add_item(&item, &[8; 8], &[], &[]).unwrap();
        }
        self.svm.set_account(addr(DEFAULT_QUEUE), queue).unwrap();
    }
}

#[test]
fn unchanged_games_real_provider_request_first_wallet_fits_300k_and_charges_exact_fee() {
    let mut e = Env::new();
    let player_before = e.balance(key(&e.player));
    let queue_before = e.balance(DEFAULT_QUEUE);
    let instructions = e.first_place_ixs();
    let tx = Transaction::new(
        &[&e.player],
        Message::new(&instructions, Some(&e.player.pubkey())),
        e.svm.latest_blockhash(),
    );
    let bytes = 1 + 64 * tx.signatures.len() + tx.message_data().len();
    assert!(bytes <= 1232);
    assert_eq!(tx.signatures.len(), 1);
    let meta = e.svm.send_transaction(tx).unwrap();
    assert!(meta.compute_units_consumed < u64::from(CLIENT_CU));
    assert_eq!(e.balance(DEFAULT_QUEUE) - queue_before, ORACLE_FEE);
    let bet: games::CoinflipBet = read(&e.svm, e.bet());
    assert_eq!(bet.status, games::COINFLIP_AWAITING);
    assert_eq!(bet.stake, STAKE);
    assert_eq!(bet.max_gross, MAX_PAYOUT);
    assert_eq!(bet.randomness, [0; 32]);
    assert_eq!(bet.request_tag, e.bet().to_bytes());
    let rents: u64 = [e.ledger, e.activity, e.bet(), e.house_bet()]
        .into_iter()
        .map(|k| {
            let a = e.svm.get_account(&addr(k)).unwrap();
            e.svm.minimum_balance_for_rent_exemption(a.data.len())
        })
        .sum();
    assert_eq!(
        player_before - e.balance(key(&e.player)),
        STAKE + rents + ORACLE_FEE + 5000
    );
    let shard: house::HouseShard = read(&e.svm, e.shard);
    assert_eq!(shard.reserved, MAX_PAYOUT - STAKE);
    assert_eq!(shard.open_bets, 1);
    assert_eq!(read::<house::PlayerLedger>(&e.svm, e.ledger).last_bet_id, 1);
    let mut data = e.svm.get_account(&addr(DEFAULT_QUEUE)).unwrap().data;
    let view = QueueAccount::load(&mut data).unwrap();
    assert_eq!(view.header.item_count, 1);
    let item = view.iter_items().next().unwrap();
    assert_eq!(item.identity_mode, 1);
    assert_eq!(item.callback_program_id, games::ID.to_bytes());
    assert_eq!(
        item.callback_discriminator(view.acc),
        games::instruction::ConsumeRandomness::DISCRIMINATOR
    );
    let args = [1u64.to_le_bytes().as_slice(), e.bet().as_ref()].concat();
    assert_eq!(item.callback_args(view.acc), args);
    let metas = item.account_metas(view.acc);
    assert_eq!(metas.len(), 2);
    assert_eq!(metas[0].pubkey, e.config.to_bytes());
    assert_eq!(metas[0].is_writable, 0);
    assert_eq!(metas[1].pubkey, e.bet().to_bytes());
    assert_eq!(metas[1].is_writable, 1);
    assert_eq!(
        item.id,
        hashv(&[
            e.bet().as_ref(),
            &100u64.to_le_bytes(),
            &[77; 32],
            games::instruction::ConsumeRandomness::DISCRIMINATOR,
            games::ID.as_ref(),
            &1_000_000i64.to_le_bytes(),
            &16u32.to_le_bytes()
        ])
        .to_bytes()
    );
    println!("root_games_real_provider_first_wallet_cu={} legacy_bytes={bytes} provider_fee={ORACLE_FEE} vm_rent_total={rents}", meta.compute_units_consumed);
}

#[test]
fn real_provider_paused_queue_rolls_back_games_house_rent_fee_and_nonce() {
    let mut e = Env::new();
    let mut q = e.svm.get_account(&addr(DEFAULT_QUEUE)).unwrap();
    QueueAccount::load(&mut q.data).unwrap().header.paused = 1;
    e.svm.set_account(addr(DEFAULT_QUEUE), q).unwrap();
    let before = e.snapshot();
    let funds = e.balance(key(&e.player));
    let error = e.place().expect_err("provider must reject paused queue");
    assert!(
        error.meta.logs.iter().any(
            |s| s.contains("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz") && s.contains("failed")
        ),
        "{error:?}"
    );
    assert_eq!(e.snapshot(), before);
    assert_eq!(funds - e.balance(key(&e.player)), 5000);
}

#[test]
fn real_provider_request_300k_budget_under_explicit_vm_occupancy() {
    for (bytes, records) in [(30000, 120), (512000, 4800)] {
        let mut e = Env::new();
        e.populate_queue(bytes, records);
        let meta = e
            .place()
            .expect("these measured fixture loads must fit the frontend budget");
        assert!(meta.compute_units_consumed <= u64::from(CLIENT_CU));
        println!("root_games_provider_occupancy_bytes={bytes} short_records={records} cu={} accepted=true", meta.compute_units_consumed);
    }
}

#[test]
fn vm_only_queue_transplant_real_proof_scoped_callback_settlement_and_replay() {
    let mut payouts = Vec::new();
    for side in [0, 1] {
        let mut e = Env::new();
        let mut instructions = e.first_place_ixs();
        *instructions.last_mut().unwrap() = e.place_ix_for_side(side);
        e.send(&instructions, true, false, false).unwrap();
        e.advance(1);
        let pending = e.snapshot();
        // The fixture oracle CANNOT fulfill Games' real queue; actual seeds enforced.
        assert!(e
            .send(&[e.fulfill_ix(DEFAULT_QUEUE, 9)], false, false, true)
            .is_err());
        assert_eq!(e.snapshot(), pending);
        e.transplant_request_to_test_oracle_queue();
        let input = e.input(e.test_queue());
        let expected = hash(&e.proof(input, 9).0).to_bytes();
        let before = e.snapshot();
        let queue = e.svm.get_account(&addr(e.test_queue())).unwrap();
        let bad_proof = e
            .send(&[e.fulfill_ix(e.test_queue(), 10)], false, false, true)
            .expect_err("wrong VRF secret must fail official verifier");
        assert!(
            format!("{:?}", bad_proof.err).contains("Custom(2)"),
            "{bad_proof:?}"
        );
        assert_eq!(e.snapshot(), before);
        assert_eq!(e.svm.get_account(&addr(e.test_queue())).unwrap(), queue);
        let mut wrong_identity = e.fulfill_ix(e.test_queue(), 9);
        wrong_identity.accounts[1].pubkey = e.fee.pubkey();
        assert!(e.send(&[wrong_identity], false, false, true).is_err());
        assert_eq!(e.snapshot(), before);
        assert_eq!(e.svm.get_account(&addr(e.test_queue())).unwrap(), queue);
        let callback = e.fulfill_ix(e.test_queue(), 9);
        let replay = callback.clone();
        let player_before = e.balance(key(&e.player));
        let oracle_before = e.balance(key(&e.oracle));
        let callback_meta = e.send(&[callback], false, false, true).unwrap();
        let ready: games::CoinflipBet = read(&e.svm, e.bet());
        assert_eq!(ready.status, games::COINFLIP_READY);
        assert_eq!(ready.randomness, expected);
        assert_eq!(
            e.balance(key(&e.player)),
            player_before,
            "callback never pays SOL"
        );
        assert_eq!(e.balance(key(&e.oracle)) - oracle_before, ORACLE_FEE);
        assert!(e.send(&[replay], false, false, true).is_err());
        assert_eq!(
            read::<games::CoinflipBet>(&e.svm, e.bet()).randomness,
            expected
        );
        let rents = [e.bet(), e.house_bet()]
            .into_iter()
            .map(|k| {
                let a = e.svm.get_account(&addr(k)).unwrap();
                e.svm.minimum_balance_for_rent_exemption(a.data.len())
            })
            .sum::<u64>();
        let keeper_before = e.balance(key(&e.fee));
        let payout = if expected[0] & 1 == side {
            MAX_PAYOUT
        } else {
            0
        };
        let settled = e
            .send(&[e.settle_ix(), e.close_ix()], false, false, false)
            .unwrap();
        assert_eq!(e.balance(key(&e.player)) - player_before, payout + rents);
        assert_eq!(keeper_before - e.balance(key(&e.fee)), 5000);
        assert!(e
            .svm
            .get_account(&addr(e.bet()))
            .is_none_or(|a| a.lamports == 0));
        assert!(e
            .svm
            .get_account(&addr(e.house_bet()))
            .is_none_or(|a| a.lamports == 0));
        let shard: house::HouseShard = read(&e.svm, e.shard);
        assert_eq!(shard.open_bets, 0);
        assert_eq!(shard.reserved, 0);
        let activity: games::GamePlayerActivity = read(&e.svm, e.activity);
        assert_eq!(activity.settled_bets, 1);
        assert_eq!(activity.total_wagered_lamports, u128::from(STAKE));
        assert_eq!(activity.total_payout_lamports, u128::from(payout));
        assert!(e.send(&[e.settle_ix()], false, false, false).is_err());
        assert!(e.send(&[e.place_ix()], true, false, false).is_err());
        assert_eq!(read::<house::PlayerLedger>(&e.svm, e.ledger).last_bet_id, 1);
        println!("root_games_vm_transplant_provider_callback_cu={} permissionless_settle_close_cu={} payout={payout}", callback_meta.compute_units_consumed, settled.compute_units_consumed);
        payouts.push(payout);
    }
    payouts.sort_unstable();
    assert_eq!(payouts, vec![0, MAX_PAYOUT]);
}

#[test]
fn vm_only_queue_transplant_purge_exposes_pending_bet_liveness_gap() {
    let mut e = Env::new();
    e.place().unwrap();
    e.transplant_request_to_test_oracle_queue();
    e.advance(124);
    let callback = e.fulfill_ix(e.test_queue(), 9);
    let player = e.balance(key(&e.player));
    e.send(
        &[convert(sdk::purge_expired_requests(key(&e.oracle), 0))],
        false,
        false,
        false,
    )
    .unwrap();
    assert!(e.send(&[callback], false, false, true).is_err());
    assert!(e.send(&[e.settle_ix()], false, false, false).is_err());
    assert_eq!(
        read::<games::CoinflipBet>(&e.svm, e.bet()).status,
        games::COINFLIP_AWAITING
    );
    assert_eq!(e.balance(key(&e.player)), player);
    assert_eq!(
        read::<house::HouseShard>(&e.svm, e.shard).reserved,
        MAX_PAYOUT - STAKE
    );
}

#[test]
fn real_provider_scan_exhaustion_rolls_back_prior_house_reservation() {
    let mut e = Env::new();
    e.populate_queue(512000, 4800);
    let before = e.snapshot();
    let funds = e.balance(key(&e.player));
    let mut instructions = e.first_place_ixs();
    instructions[0] = ComputeBudgetInstruction::set_compute_unit_limit(160_000);
    let error = e
        .send(&instructions, true, false, false)
        .expect_err("deliberately insufficient compute");
    // A nested SBF CPI surfaces exhaustion as ProgramFailedToComplete. Require
    // the provider's exact exhaustion log and consumed budget as well.
    assert!(
        format!("{:?}", error.err).contains("ProgramFailedToComplete"),
        "{error:?}"
    );
    assert_eq!(error.meta.compute_units_consumed, 160_000);
    assert!(error
        .meta
        .logs
        .iter()
        .any(|s| s
            .contains("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz failed: exceeded CUs meter")));
    assert!(
        error
            .meta
            .logs
            .iter()
            .any(|s| s.contains("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz invoke")),
        "failure must be inside provider after reservation"
    );
    assert_eq!(e.snapshot(), before);
    assert_eq!(funds - e.balance(key(&e.player)), 5000);
    println!(
        "root_games_provider_insufficient_budget_cu={}",
        error.meta.compute_units_consumed
    );
}
