import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  ASENA_SLOT, CASCADE_SLOT, CEZERI_SLOT, EBRU_SLOT, playAsenaRound, playCezeriRound, SLOT_GAMES, TARHUN_SLOT, deriveSeedHex, playEbruRound, isClientSeed, playCascade2Round, playStormRound, slotBytesToHex, slotGame, slotHexToBytes,
  slotNonceMessage, slotReceiptMessage, slotReplayMessage, slotServerSeedHash, verifySlotRound,
} from "../src/index";

/* Known-answer vectors computed with Python's hmac/hashlib (an implementation independent of WebCrypto):
   hmac.new(key, f"{clientSeed}:{nonce}".encode(), sha256).hexdigest()[:32], sha256(key).hexdigest(). */
const VECTORS = [
  { seed: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", hash: "630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd", client: "sollish", nonce: 0, seedHex: "69f3caf5d027f409172ac9fb360d57e3" },
  { seed: "86c7b1c952955a4e71fe5373d64bf143c4b120d33f65ecd3f833fe74c5a1e172", hash: "b0cfa9735dd69f67daa193dd89402817200e236a4a4439374bd31af8b2bd581e", client: "a1B2-c3_D4", nonce: 42, seedHex: "a1e999637032a2402e98fa320d1fd33c" },
  { seed: "ff".repeat(32), hash: "af9613760f72635fbdb44a5a0a63c39f12af30f950a6ee5c971be188e89c4051", client: "x", nonce: 999_999_999, seedHex: "fecd17283a2ab8ae1aded01356eb8d13" },
] as const;

test("deriveSeedHex and the seed hash match fixed known-answer vectors (hex and byte input)", async () => {
  for (const v of VECTORS) {
    assert.equal(await deriveSeedHex(v.seed, v.client, v.nonce), v.seedHex);
    assert.equal(await deriveSeedHex(slotHexToBytes(v.seed), v.client, v.nonce), v.seedHex);
    assert.equal(await slotServerSeedHash(v.seed), v.hash);
  }
});

test("WebCrypto derivation equals node:crypto HMAC for random seeds, client seeds and nonces", async () => {
  for (let i = 0; i < 64; i++) {
    const seed = crypto.getRandomValues(new Uint8Array(32)), client = slotBytesToHex(crypto.getRandomValues(new Uint8Array(1 + (i % 32)))), nonce = i * 7919;
    const expected = createHmac("sha256", seed).update(`${client}:${nonce}`).digest("hex").slice(0, 32);
    assert.equal(await deriveSeedHex(seed, client, nonce), expected);
    assert.equal(await slotServerSeedHash(seed), createHash("sha256").update(seed).digest("hex"));
  }
});

test("inputs are strict: seed length, client seed alphabet, nonce range, hex case", async () => {
  await assert.rejects(deriveSeedHex("00".repeat(31), "a", 0), RangeError);
  await assert.rejects(deriveSeedHex("AA".repeat(32), "a", 0), RangeError);
  for (const bad of ["", "a b", "a:b", "ü", "x".repeat(65), "a\nb"]) { assert.equal(isClientSeed(bad), false); await assert.rejects(deriveSeedHex("00".repeat(32), bad, 0), RangeError); }
  for (const bad of [-1, 1.5, Number.NaN, 1_000_000_001]) assert.throws(() => slotNonceMessage("a", bad), RangeError);
  assert.equal(slotNonceMessage("seed_A-1", 12), "seed_A-1:12");
  assert.throws(() => slotHexToBytes("abc"), RangeError);
});

test("registry: own ids only, engines and costs are the protocol functions", () => {
  assert.deepEqual(Object.keys(SLOT_GAMES).sort(), ["asena", "cascade", "cezeri", "ebru", "tarhun"]);
  for (const id of ["__proto__", "constructor", "toString", "Cascade", "", "cascade/x"]) assert.equal(slotGame(id), null);
  assert.equal(slotGame("cascade"), CASCADE_SLOT); assert.equal(slotGame("tarhun"), TARHUN_SLOT); assert.equal(slotGame("ebru"), EBRU_SLOT);
  const seed = "0123456789abcdef0123456789abcdef";
  assert.deepEqual(CASCADE_SLOT.play(seed, 1000, "ante"), playCascade2Round(seed, 1000, "ante"));
  assert.deepEqual(TARHUN_SLOT.play(seed, 1000, "buy"), playStormRound(seed, 1000, "buy"));
  assert.deepEqual(EBRU_SLOT.play(seed, 1000, "buy"), playEbruRound(seed, 1000, "buy"));
  for (const game of [CASCADE_SLOT, TARHUN_SLOT, EBRU_SLOT]) {
    assert.equal(game.cost(1000, "standard"), 1000); assert.equal(game.cost(1000, "ante"), 1250); assert.equal(game.cost(1000, "buy"), 100_000);
    assert.throws(() => game.cost(1001, "standard"), RangeError); assert.throws(() => game.cost(1000, "turbo"), RangeError);
    for (const mode of game.modes) { assert.ok(game.rtp[mode]!.rtp > 0.9 && game.rtp[mode]!.rtp < 1); assert.ok(game.rtp[mode]!.stdDev > 0); }
    assert.equal(game.maxMultiplier, game === EBRU_SLOT ? 10_000 : 5000);
  }
  assert.equal(EBRU_SLOT.engineId, "ebru-ink-1");
  assert.equal(slotGame("cezeri"), CEZERI_SLOT); assert.equal(CEZERI_SLOT.engineId, "cezeri-gears-1"); assert.equal(CEZERI_SLOT.maxMultiplier, 10_000);
  assert.deepEqual(CEZERI_SLOT.play(seed, 1000, "buy"), playCezeriRound(seed, 1000, "buy"));
  assert.equal(CEZERI_SLOT.cost(1000, "standard"), 1000); assert.equal(CEZERI_SLOT.cost(1000, "ante"), 1250); assert.equal(CEZERI_SLOT.cost(1000, "buy"), 100_000);
  assert.throws(() => CEZERI_SLOT.cost(1001, "standard"), RangeError);
  for (const mode of CEZERI_SLOT.modes) assert.ok(CEZERI_SLOT.rtp[mode]!.rtp > 0.9 && CEZERI_SLOT.rtp[mode]!.rtp < 1);
  assert.equal(slotGame("asena"), ASENA_SLOT); assert.equal(ASENA_SLOT.engineId, "asena-stars-1"); assert.equal(ASENA_SLOT.maxMultiplier, 5000);
  assert.deepEqual(ASENA_SLOT.play(seed, 1000, "buy"), playAsenaRound(seed, 1000, "buy"));
  assert.equal(ASENA_SLOT.cost(1000, "standard"), 1000); assert.equal(ASENA_SLOT.cost(1000, "ante"), 1250); assert.equal(ASENA_SLOT.cost(1000, "buy"), 80_000);
  assert.throws(() => ASENA_SLOT.cost(1001, "standard"), RangeError); assert.throws(() => ASENA_SLOT.cost(1000, "turbo"), RangeError);
  for (const mode of ASENA_SLOT.modes) assert.ok(ASENA_SLOT.rtp[mode]!.rtp > 0.9 && ASENA_SLOT.rtp[mode]!.rtp < 1);
});

test("verifySlotRound recomputes hash, seed, engine round, payout, total and cost and flags each mismatch", async () => {
  const v = VECTORS[1];
  const truth = playCascade2Round(v.seedHex, 2000, "standard");
  const ok = await verifySlotRound(CASCADE_SLOT, { serverSeed: v.seed, serverSeedHash: v.hash, clientSeed: v.client, nonce: v.nonce, betCents: 2000, mode: "standard" },
    { engineId: "candy-cascade-2", seedHex: v.seedHex, payoutCents: truth.payoutCents, totalHundredths: truth.totalHundredths, costCents: 2000 });
  assert.equal(ok.ok, true); assert.equal(ok.error, null); assert.deepEqual(ok.round, truth);
  assert.deepEqual(ok.checks, { hash: true, engine: true, seed: true, payout: true, total: true, cost: true });
  const base = { serverSeed: v.seed, serverSeedHash: v.hash, clientSeed: v.client, nonce: v.nonce, betCents: 2000, mode: "standard" };
  assert.equal((await verifySlotRound(CASCADE_SLOT, { ...base, serverSeedHash: "0".repeat(64) })).checks.hash, false);
  assert.equal((await verifySlotRound(CASCADE_SLOT, { ...base, nonce: 43 }, { seedHex: v.seedHex })).checks.seed, false);
  const wrongPay = await verifySlotRound(CASCADE_SLOT, base, { payoutCents: truth.payoutCents + 1 });
  assert.equal(wrongPay.ok, false); assert.equal(wrongPay.checks.payout, false); assert.equal(wrongPay.error, "MISMATCH");
  assert.equal((await verifySlotRound(CASCADE_SLOT, base, { engineId: "storm-throne-1" })).ok, false);
  assert.equal((await verifySlotRound(CASCADE_SLOT, { ...base, betCents: 1234 })).error, "ENGINE_REJECTED_INPUT");
  assert.equal((await verifySlotRound(CASCADE_SLOT, { ...base, serverSeed: "zz" })).error, "SERVER_SEED_FORMAT");
  const storm = await verifySlotRound(TARHUN_SLOT, { ...base, mode: "buy" });
  assert.equal(storm.ok, true); assert.deepEqual(storm.round, playStormRound(v.seedHex, 2000, "buy"));
});

test("signed canonical texts have a fixed field order and refuse line breaks", () => {
  const receipt = { roundId: "a".repeat(32), game: "cascade", engineId: "candy-cascade-2", mode: "standard", betCents: 100, costCents: 100, payoutCents: 0, totalHundredths: 0, seedHex: "b".repeat(32), serverSeedHash: "c".repeat(64), clientSeed: "abc", nonce: 3, balanceCents: 99_900, at: 1_760_000_000_000 };
  assert.equal(slotReceiptMessage(receipt), `sollish-slot-receipt-1\n${"a".repeat(32)}\ncascade\ncandy-cascade-2\nstandard\n100\n100\n0\n0\n${"b".repeat(32)}\n${"c".repeat(64)}\nabc\n3\n99900\n1760000000000`);
  assert.throws(() => slotReceiptMessage({ ...receipt, clientSeed: "a\nb" }), RangeError);
  const replay = { ...receipt, serverSeed: null, clientSeed: null };
  assert.ok(slotReplayMessage(replay).endsWith("\n3\n-\n-"));
  assert.ok(!slotReplayMessage(replay).includes("99900"));
});
