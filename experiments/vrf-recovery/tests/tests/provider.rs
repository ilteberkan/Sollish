//! Real, source-built provider SBF in LiteSVM. No network or live oracle involved.
use curve25519_dalek::{constants::RISTRETTO_BASEPOINT_POINT, scalar::Scalar};
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_curve25519::{ristretto::PodRistrettoPoint, scalar::PodScalar};
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_program::{pubkey::Pubkey, sysvar};
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_vrf::vrf::compute_vrf;
use solana_vrf_api::{
    sdk,
    state::{oracle_data_pda, oracle_queue_pda, QueueAccount, QueueItem},
};
use std::path::PathBuf;
use vrf_recovery_experiment as experiment;

fn addr(key: Pubkey) -> Address {
    Address::new_from_array(key.to_bytes())
}
fn pubkey(key: Address) -> Pubkey {
    Pubkey::new_from_array(key.to_bytes())
}
fn snapshot() -> Address {
    addr(experiment::snapshot_address())
}
fn oracle_key(secret: u8) -> [u8; 32] {
    (Scalar::from_bytes_mod_order([secret; 32]) * RISTRETTO_BASEPOINT_POINT)
        .compress()
        .to_bytes()
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
type Result = std::result::Result<TransactionMetadata, Box<FailedTransactionMetadata>>;
struct Env {
    svm: LiteSVM,
    authority: Keypair,
    oracle: Keypair,
    payer: Keypair,
}
impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        svm.add_program_from_file(
            addr(experiment::ID),
            base.join("../target/deploy/vrf_recovery_experiment.so"),
        )
        .unwrap();
        svm.add_program_from_file(
            addr(solana_vrf_api::ID),
            base.join("../../../.tooling/vrf-provider-build/artifacts/solana_vrf_program.so"),
        )
        .expect("run experiments/vrf-recovery/build-provider.sh first");
        let authority = Keypair::new_from_array([41; 32]);
        let oracle = Keypair::new_from_array([42; 32]);
        let payer = Keypair::new();
        assert_eq!(oracle.pubkey(), addr(experiment::TEST_ORACLE_IDENTITY));
        for key in [&authority, &oracle, &payer] {
            svm.airdrop(&key.pubkey(), 2_000_000_000).unwrap();
        }
        // Genesis fixture only: install the admin authority on the provider's
        // canonical ProgramData metadata, preserving the source-built ELF.
        let executable = svm.get_account(&addr(solana_vrf_api::ID)).unwrap();
        assert_eq!(
            u32::from_le_bytes(executable.data[..4].try_into().unwrap()),
            2
        );
        let program_data = Address::new_from_array(executable.data[4..36].try_into().unwrap());
        let mut deployment = svm.get_account(&program_data).unwrap();
        deployment.data[12] = 1;
        deployment.data[13..45].copy_from_slice(authority.pubkey().as_ref());
        svm.set_account(program_data, deployment).unwrap();
        svm.set_account(
            snapshot(),
            Account {
                lamports: svm.minimum_balance_for_rent_exemption(experiment::SNAPSHOT_LEN),
                data: vec![0; experiment::SNAPSHOT_LEN],
                owner: addr(experiment::ID),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
        svm.set_sysvar(&Clock {
            slot: 100,
            unix_timestamp: 1_000_000,
            ..Clock::default()
        });
        // Actual SlotHashes account address/owner; deterministic VM history fixture.
        let mut slots = vec![];
        slots.extend_from_slice(&1u64.to_le_bytes());
        slots.extend_from_slice(&99u64.to_le_bytes());
        slots.extend_from_slice(&[77; 32]);
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
        let mut e = Self {
            svm,
            authority,
            oracle,
            payer,
        };
        e.send(
            convert(sdk::initialize(pubkey(e.authority.pubkey()))),
            true,
            false,
        )
        .unwrap();
        e.send(
            convert(sdk::add_oracle(
                pubkey(e.authority.pubkey()),
                pubkey(e.oracle.pubkey()),
                oracle_key(9),
            )),
            true,
            false,
        )
        .unwrap();
        for ix in sdk::initialize_oracle_queue(
            pubkey(e.authority.pubkey()),
            pubkey(e.oracle.pubkey()),
            0,
            Some(9500),
        ) {
            e.send(convert(ix), true, true).unwrap();
        }
        e
    }
    fn queue(&self) -> Address {
        addr(oracle_queue_pda(&experiment::TEST_ORACLE_IDENTITY, 0).0)
    }
    fn oracle_data(&self) -> Address {
        addr(oracle_data_pda(&experiment::TEST_ORACLE_IDENTITY).0)
    }
    fn state(&self) -> Vec<u8> {
        self.svm.get_account(&snapshot()).unwrap().data
    }
    fn input(&self) -> [u8; 32] {
        self.state()[40..72].try_into().unwrap()
    }
    fn send(&mut self, ix: Instruction, authority: bool, oracle: bool) -> Result {
        self.svm.expire_blockhash();
        let mut signers = vec![&self.payer];
        if authority {
            signers.push(&self.authority);
        }
        if oracle {
            signers.push(&self.oracle);
        }
        let tx = Transaction::new(
            &signers,
            Message::new(&[ix], Some(&self.payer.pubkey())),
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx).map_err(Box::new)
    }
    fn admit_with_limit(&mut self) -> Result {
        self.svm.expire_blockhash();
        let ix = solana_compute_budget_interface::ComputeBudgetInstruction::set_compute_unit_limit(
            1_400_000,
        );
        let tx = Transaction::new(
            &[&self.payer, &self.authority],
            Message::new(&[ix, self.admit_ix()], Some(&self.payer.pubkey())),
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx).map_err(Box::new)
    }
    fn populate_queue(&mut self, allocated_bytes: usize, records: usize) {
        // Occupancy fixture: use official layout constructor, not real requests.
        let mut account = self.svm.get_account(&self.queue()).unwrap();
        account.data.resize(allocated_bytes, 0);
        account.lamports = self.svm.minimum_balance_for_rent_exemption(allocated_bytes);
        let mut view = QueueAccount::load(&mut account.data).unwrap();
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
        self.svm.set_account(self.queue(), account).unwrap();
    }
    fn admit_ix(&self) -> Instruction {
        Instruction {
            program_id: addr(experiment::ID),
            data: vec![2],
            accounts: vec![
                AccountMeta::new(snapshot(), false),
                AccountMeta::new(self.authority.pubkey(), true),
                AccountMeta::new_readonly(
                    addr(Pubkey::find_program_address(&[b"identity"], &experiment::ID).0),
                    false,
                ),
                AccountMeta::new(self.queue(), false),
                AccountMeta::new_readonly(self.oracle_data(), false),
                AccountMeta::new_readonly(addr(sysvar::slot_hashes::ID), false),
                AccountMeta::new_readonly(Address::default(), false),
                AccountMeta::new_readonly(addr(solana_vrf_api::ID), false),
            ],
        }
    }
    fn admit(&mut self) -> Result {
        self.send(self.admit_ix(), true, false)
    }
    fn advance(&mut self, seconds: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.slot += 1;
        clock.unix_timestamp += seconds;
        self.svm.set_sysvar(&clock);
    }
    fn proof(&self, input: [u8; 32], secret: u8) -> ([u8; 32], [u8; 32], [u8; 32], [u8; 32]) {
        let (output, (base, hash, scalar)) =
            compute_vrf(Scalar::from_bytes_mod_order([secret; 32]), &input);
        (
            output.to_bytes(),
            base.to_bytes(),
            hash.to_bytes(),
            scalar.to_bytes(),
        )
    }
    fn fulfill(&mut self, input: [u8; 32], secret: u8) -> Result {
        let (output, base, hash, scalar) = self.proof(input, secret);
        let mut ix = sdk::provide_randomness(
            pubkey(self.oracle.pubkey()),
            pubkey(self.queue()),
            experiment::ID,
            input,
            PodRistrettoPoint(output),
            PodRistrettoPoint(base),
            PodRistrettoPoint(hash),
            PodScalar(scalar),
        );
        ix.accounts.extend(
            experiment::callback_accounts()
                .iter()
                .map(|m| m.to_account_meta()),
        );
        self.send(convert(ix), false, true)
    }
    fn recover(&mut self, secret: u8) -> Result {
        let (output, base, hash, scalar) = self.proof(self.input(), secret);
        let mut data = vec![1];
        for bytes in [output, base, hash, scalar] {
            data.extend(bytes);
        }
        self.send(
            Instruction {
                program_id: addr(experiment::ID),
                accounts: vec![AccountMeta::new(snapshot(), false)],
                data,
            },
            false,
            false,
        )
    }
    fn count(&self) -> u32 {
        u32::from_le_bytes(
            self.svm.get_account(&self.queue()).unwrap().data[8..12]
                .try_into()
                .unwrap(),
        )
    }
}
fn reject(result: Result, needle: &str) {
    let e = result.expect_err("expected rejection");
    assert!(
        e.meta.logs.iter().any(|l| l.contains(needle)),
        "expected {needle}, got {e:?}"
    );
}

#[test]
fn real_provider_admission_captures_request_and_normal_callback_consumes_once() {
    let mut e = Env::new();
    let balance = e.svm.get_balance(&e.authority.pubkey()).unwrap();
    let admission = e.admit().unwrap();
    assert_eq!(
        balance - e.svm.get_balance(&e.authority.pubkey()).unwrap(),
        500_000
    );
    assert_eq!(e.count(), 1);
    assert_eq!(&e.state()[72..104], &oracle_key(9));
    let mut queue = e.svm.get_account(&e.queue()).unwrap().data;
    let view = QueueAccount::load(&mut queue).unwrap();
    assert!(view.find_item_by_id(&e.input()).is_some());
    assert_ne!(e.input(), snapshot().to_bytes());
    e.advance(1);
    let input = e.input();
    let output = e.proof(input, 9).0;
    let normal = e.fulfill(input, 9).unwrap();
    assert_eq!(e.count(), 0);
    assert_eq!(e.state()[experiment::STATUS_OFFSET], 1);
    assert_eq!(
        &e.state()[experiment::RANDOMNESS_OFFSET..],
        solana_program::hash::hash(&output).as_ref()
    );
    println!(
        "provider_admission_cu={} provider_normal_callback_cu={}",
        admission.compute_units_consumed, normal.compute_units_consumed
    );
    let settled = e.state();
    assert!(e.fulfill(input, 9).is_err());
    e.advance(121);
    reject(e.recover(9), "ProofAlreadyConsumed");
    assert_eq!(e.state(), settled);
}

#[test]
fn real_provider_purge_then_original_proof_recovery_preserves_one_result() {
    let mut e = Env::new();
    e.admit().unwrap();
    let input = e.input();
    let output = e.proof(input, 9).0;
    e.advance(124);
    let before = e.svm.get_balance(&e.oracle.pubkey()).unwrap();
    e.send(
        convert(sdk::purge_expired_requests(pubkey(e.oracle.pubkey()), 0)),
        false,
        false,
    )
    .unwrap();
    assert_eq!(e.count(), 0);
    assert_eq!(
        e.svm.get_balance(&e.oracle.pubkey()).unwrap() - before,
        500_000
    );
    assert!(e.fulfill(input, 9).is_err());
    e.recover(9).unwrap();
    assert_eq!(
        &e.state()[experiment::RANDOMNESS_OFFSET..],
        solana_program::hash::hash(&output).as_ref()
    );
}

#[test]
fn post_cpi_capture_rejection_rolls_back_queue_request_and_fee() {
    let mut e = Env::new();
    let mut oracle = e.svm.get_account(&e.oracle_data()).unwrap();
    oracle.data[8..40].fill(0);
    e.svm.set_account(e.oracle_data(), oracle).unwrap();
    let before = e.svm.get_account(&e.queue()).unwrap();
    let payer = e.svm.get_balance(&e.authority.pubkey());
    reject(e.admit(), "InvalidRequestCapture");
    let after = e.svm.get_account(&e.queue()).unwrap();
    assert_eq!(after.data, before.data);
    assert_eq!(after.lamports, before.lamports);
    assert_eq!(e.svm.get_balance(&e.authority.pubkey()), payer);
    assert_eq!(e.state(), vec![0; experiment::SNAPSHOT_LEN]);
}

#[test]
fn callback_rejects_synthetic_oracle_key_replacement_but_original_recovery_remains_valid() {
    let mut e = Env::new();
    e.admit().unwrap();
    let pending = e.state();
    // Fault injection, not a claim that ModifyOracle allows changing a live key.
    let mut oracle = e.svm.get_account(&e.oracle_data()).unwrap();
    oracle.data[8..40].copy_from_slice(&oracle_key(10));
    e.svm.set_account(e.oracle_data(), oracle).unwrap();
    e.advance(1);
    reject(e.fulfill(e.input(), 10), "UnboundProviderCallback");
    assert_eq!(e.count(), 1);
    assert_eq!(e.state(), pending);
    e.advance(124);
    e.recover(9).unwrap();
}

#[test]
fn callback_rejects_synthetic_queue_input_replacement() {
    let mut e = Env::new();
    e.admit().unwrap();
    let pending = e.state();
    let mut queue = e.svm.get_account(&e.queue()).unwrap();
    // Queue body starts after discriminator; first aligned item at body16,
    // input follows the 8-byte slot. Only a VM fault can make this replacement.
    queue.data[32..64].copy_from_slice(&[99; 32]);
    e.svm.set_account(e.queue(), queue).unwrap();
    e.advance(1);
    reject(e.fulfill([99; 32], 9), "UnboundProviderCallback");
    assert_eq!(e.count(), 1);
    assert_eq!(e.state(), pending);
}

#[test]
fn repeated_admission_and_wrong_sysvar_cannot_create_another_request() {
    let mut e = Env::new();
    let mut bad = e.admit_ix();
    bad.accounts[5].pubkey = e.payer.pubkey();
    assert!(e.send(bad, true, false).is_err());
    assert_eq!(e.count(), 0);
    e.admit().unwrap();
    let state = e.state();
    let queue = e.svm.get_account(&e.queue()).unwrap();
    reject(e.admit(), "SnapshotAlreadyInitialized");
    assert_eq!(e.state(), state);
    assert_eq!(e.svm.get_account(&e.queue()).unwrap().data, queue.data);
}

#[test]
fn recovery_before_purge_blocks_a_late_normal_callback_without_changing_result() {
    let mut e = Env::new();
    e.admit().unwrap();
    let input = e.input();
    e.advance(124);
    e.recover(9).unwrap();
    let settled = e.state();
    reject(e.fulfill(input, 9), "ProofAlreadyConsumed");
    assert_eq!(e.count(), 1);
    assert_eq!(e.state(), settled);
    e.send(
        convert(sdk::purge_expired_requests(pubkey(e.oracle.pubkey()), 0)),
        false,
        false,
    )
    .unwrap();
    assert_eq!(e.count(), 0);
    assert_eq!(e.state(), settled);
}

#[test]
fn queue_occupancy_cost_is_measured_and_budget_failure_is_atomic() {
    for (bytes, records) in [(9500, 30), (30000, 120), (512000, 1000), (512000, 4800)] {
        let mut e = Env::new();
        e.populate_queue(bytes, records);
        let queue = e.svm.get_account(&e.queue()).unwrap();
        let funds = e.svm.get_balance(&e.authority.pubkey());
        if records == 4800 {
            let transaction_payer_before = e.svm.get_balance(&e.payer.pubkey()).unwrap();
            let error = e
                .admit()
                .expect_err("default budget must expose occupancy cost");
            println!(
                "provider_capture_default_budget_records={records} cu={} outcome={:?}",
                error.meta.compute_units_consumed, error.err
            );
            assert_eq!(error.meta.compute_units_consumed, 200_000);
            assert!(
                error
                    .meta
                    .logs
                    .iter()
                    .any(|line| line.contains("exceeded CUs meter")),
                "unexpected failure: {error:?}"
            );
            assert_eq!(e.svm.get_account(&e.queue()).unwrap().data, queue.data);
            assert_eq!(
                e.svm.get_account(&e.queue()).unwrap().lamports,
                queue.lamports
            );
            assert_eq!(e.svm.get_balance(&e.authority.pubkey()), funds);
            assert_eq!(e.state(), vec![0; experiment::SNAPSHOT_LEN]);
            assert!(
                e.svm.get_balance(&e.payer.pubkey()).unwrap() < transaction_payer_before,
                "network fee is not rolled back"
            );
        }
        match e.admit_with_limit() {
            Ok(meta) => {
                println!(
                    "provider_capture_load_bytes={bytes} records={records} cu={} outcome=accepted",
                    meta.compute_units_consumed
                );
                assert_eq!(e.count() as usize, records + 1);
            }
            Err(error) => {
                println!(
                    "provider_capture_load_bytes={bytes} records={records} cu={} outcome={:?}",
                    error.meta.compute_units_consumed, error.err
                );
                assert!(
                    records >= 1000,
                    "small queue unexpectedly failed: {error:?}"
                );
                assert!(
                    format!("{:?}", error.err).contains("ComputationalBudgetExceeded"),
                    "unexpected failure: {error:?}"
                );
                assert_eq!(e.svm.get_account(&e.queue()).unwrap().data, queue.data);
                assert_eq!(
                    e.svm.get_account(&e.queue()).unwrap().lamports,
                    queue.lamports
                );
                assert_eq!(e.svm.get_balance(&e.authority.pubkey()), funds);
                assert_eq!(e.state(), vec![0; experiment::SNAPSHOT_LEN]);
            }
        }
    }
}
