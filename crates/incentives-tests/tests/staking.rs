use anchor_lang::solana_program::{program_option::COption, program_pack::Pack};
use anchor_lang::{
    prelude::Pubkey, AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use anchor_spl::token_2022::spl_token_2022::{
    self as spl,
    extension::{
        metadata_pointer::MetadataPointer, permanent_delegate::PermanentDelegate,
        transfer_fee::TransferFeeConfig, BaseStateWithExtensionsMut, ExtensionType,
        StateWithExtensionsMut,
    },
    state::{Account as Token, AccountState, Mint},
};
use incentives::{StakePosition, StakingPool};
use litesvm::{types::FailedTransactionMetadata, LiteSVM};
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::path::PathBuf;
const SYSTEM: Pubkey = anchor_lang::pubkey!("11111111111111111111111111111111");
const LEGACY: Pubkey = anchor_spl::token::ID;
type TxResult = Result<(), Box<FailedTransactionMetadata>>;
fn addr(k: Pubkey) -> Address {
    Address::new_from_array(k.to_bytes())
}
fn key(k: &Keypair) -> Pubkey {
    Pubkey::new_from_array(k.pubkey().to_bytes())
}
fn convert(ix: anchor_lang::solana_program::instruction::Instruction) -> Instruction {
    Instruction {
        program_id: addr(ix.program_id),
        accounts: ix
            .accounts
            .into_iter()
            .map(|m| AccountMeta {
                pubkey: addr(m.pubkey),
                is_signer: m.is_signer,
                is_writable: m.is_writable,
            })
            .collect(),
        data: ix.data,
    }
}
fn ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    convert(anchor_lang::solana_program::instruction::Instruction {
        program_id: incentives::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    })
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
    svm.send_transaction(Transaction::new(
        &all,
        Message::new(instructions, Some(&payer.pubkey())),
        svm.latest_blockhash(),
    ))
    .map(|_| ())
    .map_err(Box::new)
}
fn named(result: TxResult, name: &str) {
    let e = result.expect_err("must fail");
    assert!(
        e.meta.logs.iter().any(|s| s.contains(name)),
        "expected {name}: {e:?}"
    );
}
fn read<T: AccountDeserialize>(svm: &LiteSVM, k: Pubkey) -> T {
    T::try_deserialize(&mut svm.get_account(&addr(k)).unwrap().data.as_slice()).unwrap()
}
fn set(svm: &mut LiteSVM, k: Pubkey, owner: Pubkey, data: Vec<u8>) {
    svm.set_account(
        addr(k),
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(data.len()),
            data,
            owner: addr(owner),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}
fn tokens(svm: &LiteSVM, k: Pubkey) -> u64 {
    Token::unpack(&svm.get_account(&addr(k)).unwrap().data)
        .unwrap()
        .amount
}
fn token_data(mint: Pubkey, owner: Pubkey, amount: u64) -> Vec<u8> {
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
    data
}
struct Env {
    svm: LiteSVM,
    fee: Keypair,
    admin: Keypair,
    a: Keypair,
    b: Keypair,
    house: Pubkey,
    mint: Pubkey,
    pool: Pubkey,
    principal: Pubkey,
    rewards: Pubkey,
    funding: Pubkey,
    ta: Pubkey,
    tb: Pubkey,
    pa: Pubkey,
    pb: Pubkey,
    token_program: Pubkey,
}
impl Env {
    fn bare(token_program: Pubkey) -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(
            addr(incentives::ID),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/incentives.so"),
        )
        .unwrap();
        let fee = Keypair::new();
        let admin = Keypair::new();
        let a = Keypair::new();
        let b = Keypair::new();
        for p in [&fee, &admin, &a, &b] {
            svm.airdrop(&p.pubkey(), 10_000_000_000).unwrap();
        }
        let (house, bump) =
            Pubkey::find_program_address(&[b"house", key(&admin).as_ref()], &house::ID);
        let mut data = vec![];
        house::HouseConfig {
            authority: key(&admin),
            game_program: Pubkey::new_unique(),
            paused: false,
            bump,
        }
        .try_serialize(&mut data)
        .unwrap();
        set(&mut svm, house, house::ID, data);
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
        set(&mut svm, mint, token_program, data);
        let funding = Pubkey::new_unique();
        let ta = Pubkey::new_unique();
        let tb = Pubkey::new_unique();
        set(
            &mut svm,
            funding,
            token_program,
            token_data(mint, key(&admin), 999_999_000_000_000),
        );
        set(
            &mut svm,
            ta,
            token_program,
            token_data(mint, key(&a), 500_000_000),
        );
        set(
            &mut svm,
            tb,
            token_program,
            token_data(mint, key(&b), 500_000_000),
        );
        let pool = Pubkey::find_program_address(
            &[
                b"staking",
                house.as_ref(),
                mint.as_ref(),
                &0_u64.to_le_bytes(),
            ],
            &incentives::ID,
        )
        .0;
        let principal =
            Pubkey::find_program_address(&[b"principal", pool.as_ref()], &incentives::ID).0;
        let rewards =
            Pubkey::find_program_address(&[b"staking_rewards", pool.as_ref()], &incentives::ID).0;
        let pa = Pubkey::find_program_address(
            &[b"stake", pool.as_ref(), key(&a).as_ref()],
            &incentives::ID,
        )
        .0;
        let pb = Pubkey::find_program_address(
            &[b"stake", pool.as_ref(), key(&b).as_ref()],
            &incentives::ID,
        )
        .0;
        let mut env = Self {
            svm,
            fee,
            admin,
            a,
            b,
            house,
            mint,
            pool,
            principal,
            rewards,
            funding,
            ta,
            tb,
            pa,
            pb,
            token_program,
        };
        env.time(90);
        env
    }
    fn time(&mut self, now: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = now;
        clock.slot += 1;
        self.svm.set_sysvar(&clock);
    }
    fn init_ix(&self, budget: u64, start_ts: i64, end_ts: i64) -> Instruction {
        ix(
            incentives::accounts::InitializePool {
                authority: key(&self.admin),
                house: self.house,
                mint: self.mint,
                pool: self.pool,
                principal_vault: self.principal,
                reward_vault: self.rewards,
                funding: self.funding,
                token_program: self.token_program,
                system_program: SYSTEM,
            },
            incentives::instruction::InitializePool {
                id: 0,
                start_ts,
                end_ts,
                budget,
            },
        )
    }
    fn init(&mut self, budget: u64, end: i64) {
        let i = self.init_ix(budget, 100, end);
        send(&mut self.svm, &self.fee, &[i], &[&self.admin]).unwrap();
        for p in [&self.a, &self.b] {
            let position = if key(p) == key(&self.a) {
                self.pa
            } else {
                self.pb
            };
            let i = ix(
                incentives::accounts::InitializeStaker {
                    player: key(p),
                    pool: self.pool,
                    position,
                    system_program: SYSTEM,
                },
                incentives::instruction::InitializeStaker {},
            );
            send(&mut self.svm, &self.fee, &[i], &[p]).unwrap();
        }
    }
    fn stake_ix(&self, b: bool, amount: u64, exit: bool) -> Instruction {
        let (player, position, player_tokens) = if b {
            (key(&self.b), self.pb, self.tb)
        } else {
            (key(&self.a), self.pa, self.ta)
        };
        let ac = incentives::accounts::StakeTokens {
            player,
            pool: self.pool,
            position,
            mint: self.mint,
            principal_vault: self.principal,
            player_tokens,
            token_program: self.token_program,
        };
        if exit {
            ix(ac, incentives::instruction::Unstake { amount })
        } else {
            ix(ac, incentives::instruction::Stake { amount })
        }
    }
    fn stake(&mut self, b: bool, amount: u64, exit: bool) -> TxResult {
        let i = self.stake_ix(b, amount, exit);
        send(
            &mut self.svm,
            &self.fee,
            &[i],
            &[if b { &self.b } else { &self.a }],
        )
    }
    fn claim_ix(&self, b: bool) -> Instruction {
        let (player, position, player_tokens) = if b {
            (key(&self.b), self.pb, self.tb)
        } else {
            (key(&self.a), self.pa, self.ta)
        };
        ix(
            incentives::accounts::ClaimStaking {
                player,
                pool: self.pool,
                position,
                mint: self.mint,
                reward_vault: self.rewards,
                player_tokens,
                token_program: self.token_program,
            },
            incentives::instruction::ClaimStaking {},
        )
    }
    fn claim(&mut self, b: bool) -> TxResult {
        let i = self.claim_ix(b);
        send(
            &mut self.svm,
            &self.fee,
            &[i],
            &[if b { &self.b } else { &self.a }],
        )
    }
    fn pool(&self) -> StakingPool {
        read(&self.svm, self.pool)
    }
}

#[test]
fn classic_and_token2022_real_transfers_preserve_principal_and_funded_rewards() {
    for program in [LEGACY, spl::ID] {
        let mut e = Env::bare(program);
        e.init(1000, 200);
        assert_eq!(tokens(&e.svm, e.rewards), 1000);
        e.time(100);
        e.stake(false, 100, false).unwrap();
        assert_eq!(tokens(&e.svm, e.principal), 100);
        e.time(150);
        e.claim(false).unwrap();
        assert_eq!(e.pool().claimed, 500);
        e.stake(false, 100, true).unwrap();
        assert_eq!(tokens(&e.svm, e.principal), 0);
        assert_eq!(tokens(&e.svm, e.ta), 500_000_500);
        e.time(250);
        named(e.claim(false), "NothingToClaim");
        assert_eq!(tokens(&e.svm, e.rewards), 500);
        assert_eq!(e.pool().claimed, 500);
    }
}
#[test]
fn staggered_stakes_have_exact_time_weighted_rewards_and_offline_claims_do_not_expire() {
    let mut e = Env::bare(LEGACY);
    e.init(1000, 200);
    e.time(100);
    e.stake(false, 100, false).unwrap();
    e.time(150);
    e.stake(true, 100, false).unwrap();
    e.time(200);
    e.stake(false, 100, true).unwrap();
    e.stake(true, 100, true).unwrap();
    e.time(10_000_000);
    e.claim(false).unwrap();
    e.claim(true).unwrap();
    assert_eq!(tokens(&e.svm, e.ta), 500_000_750);
    assert_eq!(tokens(&e.svm, e.tb), 500_000_250);
    assert_eq!(e.pool().claimed, 1000);
    assert_eq!(tokens(&e.svm, e.rewards), 0);
    named(e.claim(false), "NothingToClaim");
}
#[test]
fn repeated_tiny_updates_do_not_destroy_time_emission_or_position_fractions() {
    let mut bulk = Env::bare(LEGACY);
    bulk.init(97, 197);
    bulk.time(100);
    bulk.stake(false, 3, false).unwrap();
    bulk.time(197);
    bulk.claim(false).unwrap();
    let expected = bulk.pool().claimed;
    let mut many = Env::bare(LEGACY);
    many.init(97, 197);
    many.time(100);
    many.stake(false, 3, false).unwrap();
    for t in 101..=197 {
        many.time(t);
        let result = many.claim(false);
        if result.is_err() {
            named(result, "NothingToClaim");
        }
    }
    assert_eq!(many.pool().claimed, expected);
    assert!(97 - expected <= 1);
    assert!(many.pool().claimed <= many.pool().allocated);
    assert_eq!(tokens(&many.svm, many.rewards) + many.pool().claimed, 97);
}
#[test]
fn clock_regression_and_schedule_boundaries_never_lock_principal_or_double_rewards() {
    let mut e = Env::bare(LEGACY);
    e.init(1000, 200);
    e.stake(false, 100, false).unwrap();
    named(e.claim(false), "NothingToClaim");
    e.time(150);
    e.claim(false).unwrap();
    e.time(120);
    named(e.claim(false), "NothingToClaim");
    e.stake(false, 1, true).unwrap();
    e.time(200);
    named(e.stake(false, 1, false), "PoolEnded");
    e.stake(false, 99, true).unwrap();
    e.claim(false).unwrap();
    assert!(e.pool().claimed <= 1000);
    assert_eq!(tokens(&e.svm, e.principal), 0);
}
#[test]
fn funding_failure_and_invalid_schedules_roll_back_all_initialization() {
    let mut e = Env::bare(LEGACY);
    let before = tokens(&e.svm, e.funding);
    let i = e.init_ix(u64::MAX, 100, 200);
    assert!(send(&mut e.svm, &e.fee, &[i], &[&e.admin]).is_err());
    assert!(e.svm.get_account(&addr(e.pool)).is_none());
    assert!(e.svm.get_account(&addr(e.rewards)).is_none());
    assert_eq!(tokens(&e.svm, e.funding), before);
    for (start, end) in [(89, 200), (100, 100), (101, 100), (-1, 100)] {
        let i = e.init_ix(100, start, end);
        named(
            send(&mut e.svm, &e.fee, &[i], &[&e.admin]),
            "InvalidSchedule",
        );
    }
}
#[test]
fn players_cannot_use_other_positions_recipients_or_the_reward_vault_as_principal() {
    let mut e = Env::bare(LEGACY);
    e.init(1000, 200);
    e.time(100);
    e.stake(false, 100, false).unwrap();
    e.time(150);
    let mut i = e.claim_ix(false);
    i.accounts[5].pubkey = addr(e.tb);
    assert!(send(&mut e.svm, &e.fee, &[i], &[&e.a]).is_err());
    let mut i = e.claim_ix(true);
    i.accounts[2].pubkey = addr(e.pa);
    assert!(send(&mut e.svm, &e.fee, &[i], &[&e.b]).is_err());
    let mut i = e.stake_ix(false, 1, true);
    i.accounts[4].pubkey = addr(e.rewards);
    assert!(send(&mut e.svm, &e.fee, &[i], &[&e.a]).is_err());
    assert_eq!(e.pool().claimed, 0);
    assert_eq!(tokens(&e.svm, e.principal), 100);
}
#[test]
fn overdraw_zero_and_failed_deposit_preserve_stake_and_rewards() {
    let mut e = Env::bare(LEGACY);
    e.init(1000, 200);
    e.time(100);
    e.stake(false, 100, false).unwrap();
    e.time(150);
    named(e.stake(false, 101, true), "InsufficientStake");
    named(e.stake(false, 0, false), "ZeroAmount");
    assert!(e.stake(false, u64::MAX / 2, false).is_err());
    assert_eq!(e.pool().emitted, 0);
    assert_eq!(e.pool().total_staked, 100);
    assert_eq!(read::<StakePosition>(&e.svm, e.pa).amount, 100);
    e.claim(false).unwrap();
    assert_eq!(e.pool().claimed, 500);
}
#[test]
fn direct_donations_cannot_be_withdrawn_as_someone_elses_principal_or_rewards() {
    let mut e = Env::bare(LEGACY);
    e.init(1000, 200);
    for destination in [e.principal, e.rewards] {
        let i = convert(
            spl::instruction::transfer_checked(
                &LEGACY,
                &e.funding,
                &e.mint,
                &destination,
                &key(&e.admin),
                &[],
                777,
                6,
            )
            .unwrap(),
        );
        send(&mut e.svm, &e.fee, &[i], &[&e.admin]).unwrap();
    }
    e.time(100);
    e.stake(false, 100, false).unwrap();
    e.time(200);
    e.stake(false, 100, true).unwrap();
    e.claim(false).unwrap();
    assert_eq!(tokens(&e.svm, e.principal), 777);
    assert_eq!(tokens(&e.svm, e.rewards), 777);
    assert_eq!(e.pool().claimed, 1000);
}
#[test]
fn zero_stake_intervals_are_not_backdated_to_late_depositors() {
    let mut e = Env::bare(LEGACY);
    e.init(1000, 200);
    e.time(150);
    e.stake(false, 100, false).unwrap();
    e.time(200);
    e.claim(false).unwrap();
    assert_eq!(e.pool().claimed, 500);
    assert_eq!(e.pool().allocated, 500);
    assert_eq!(e.pool().emitted, 1000);
    assert_eq!(tokens(&e.svm, e.rewards), 500);
}
#[test]
fn mutable_or_wrong_precision_mints_are_rejected_before_accepting_funding() {
    for case in 0..3 {
        let mut e = Env::bare(LEGACY);
        let mut account = e.svm.get_account(&addr(e.mint)).unwrap();
        let mut mint = Mint::unpack(&account.data).unwrap();
        match case {
            0 => mint.decimals = 9,
            1 => mint.mint_authority = COption::Some(key(&e.admin)),
            _ => mint.freeze_authority = COption::Some(key(&e.admin)),
        };
        Mint::pack(mint, &mut account.data).unwrap();
        e.svm.set_account(addr(e.mint), account).unwrap();
        let i = e.init_ix(100, 100, 200);
        named(
            send(&mut e.svm, &e.fee, &[i], &[&e.admin]),
            if case == 0 {
                "InvalidMint"
            } else {
                "MutableMint"
            },
        );
        assert!(e.svm.get_account(&addr(e.pool)).is_none());
    }
}
#[test]
fn token2022_value_changing_extensions_fail_closed_metadata_only_is_supported() {
    for extension in [
        ExtensionType::TransferFeeConfig,
        ExtensionType::PermanentDelegate,
        ExtensionType::MetadataPointer,
    ] {
        let mut e = Env::bare(spl::ID);
        let base = Mint::unpack(&e.svm.get_account(&addr(e.mint)).unwrap().data).unwrap();
        let mut data =
            vec![0; ExtensionType::try_calculate_account_len::<Mint>(&[extension]).unwrap()];
        {
            let mut extended =
                StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut data).unwrap();
            match extension {
                ExtensionType::TransferFeeConfig => {
                    extended.init_extension::<TransferFeeConfig>(false).unwrap();
                }
                ExtensionType::PermanentDelegate => {
                    extended.init_extension::<PermanentDelegate>(false).unwrap();
                }
                _ => {
                    extended.init_extension::<MetadataPointer>(false).unwrap();
                }
            }
            extended.base = base;
            extended.pack_base();
            extended.init_account_type().unwrap();
        }
        set(&mut e.svm, e.mint, spl::ID, data);
        let i = e.init_ix(100, 100, 200);
        let result = send(&mut e.svm, &e.fee, &[i], &[&e.admin]);
        if extension == ExtensionType::MetadataPointer {
            result.unwrap();
            assert_eq!(tokens(&e.svm, e.rewards), 100);
        } else {
            named(result, "UnsupportedExtension");
            assert!(e.svm.get_account(&addr(e.pool)).is_none());
        }
    }
}

#[test]
fn house_admin_has_no_principal_transfer_authority_and_positions_cannot_reset() {
    let mut e = Env::bare(LEGACY);
    e.init(1000, 200);
    e.time(100);
    e.stake(false, 100, false).unwrap();
    let steal = convert(
        spl::instruction::transfer_checked(
            &LEGACY,
            &e.principal,
            &e.mint,
            &e.funding,
            &key(&e.admin),
            &[],
            1,
            6,
        )
        .unwrap(),
    );
    assert!(send(&mut e.svm, &e.fee, &[steal], &[&e.admin]).is_err());
    let reset = ix(
        incentives::accounts::InitializeStaker {
            player: key(&e.a),
            pool: e.pool,
            position: e.pa,
            system_program: SYSTEM,
        },
        incentives::instruction::InitializeStaker {},
    );
    assert!(send(&mut e.svm, &e.fee, &[reset], &[&e.a]).is_err());
    assert_eq!(read::<StakePosition>(&e.svm, e.pa).amount, 100);
    e.time(-1);
    e.stake(false, 100, true).unwrap();
    assert_eq!(tokens(&e.svm, e.ta), 500_000_000);
}

#[test]
fn maximum_representable_funded_budget_does_not_overflow_accumulator_or_payout() {
    let mut e = Env::bare(LEGACY);
    set(
        &mut e.svm,
        e.funding,
        LEGACY,
        token_data(e.mint, key(&e.admin), u64::MAX - 1),
    );
    set(&mut e.svm, e.ta, LEGACY, token_data(e.mint, key(&e.a), 1));
    set(&mut e.svm, e.tb, LEGACY, token_data(e.mint, key(&e.b), 0));
    let mut mint_data = vec![0; Mint::LEN];
    Mint::pack(
        Mint {
            mint_authority: COption::None,
            supply: u64::MAX,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut mint_data,
    )
    .unwrap();
    set(&mut e.svm, e.mint, LEGACY, mint_data);
    e.init(u64::MAX - 1, 200);
    e.time(100);
    e.stake(false, 1, false).unwrap();
    e.time(200);
    e.claim(false).unwrap();
    e.stake(false, 1, true).unwrap();
    assert_eq!(tokens(&e.svm, e.ta), u64::MAX);
    assert_eq!(e.pool().claimed, u64::MAX - 1);
    assert_eq!(tokens(&e.svm, e.rewards), 0);
}
