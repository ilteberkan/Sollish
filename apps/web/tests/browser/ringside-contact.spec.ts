import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMBAT_V5_VERSION, COMBAT_V5_DURATION_MS, V5_PLAN_LEAD_MS, PLAN_COUNT, CONTACT_ENGINES, contactCommitmentInputV5, replayContactV5, planEntry, cornerObsHash, fallbackPlans, CONTACT_INITIAL, RINGSIDE_RESULT_MS, RINGSIDE_FEE_BPS, MATCH_LEDGER, MATCH_MARKETS, MATCH_OPEN_MS, carryInitial, matchComplete, matchResults, matchSeedHash, roundOutcome, parseRingClient, parseRingServer, combatResults, settlePariMutuelPool, type ContactBout, type PlanEntry, type RingClient, type RingServer, type RingRound, type RingSnapshot, type RingTicket, type RingTapeEntry, type RoundOutcome, type V5Replay, type V5Carry } from '@sollish/protocol';

// Transport/ledger FIXTURE for the actual hook and DOM. WebGL is deliberately
// unavailable: these are NOT GPU, hosted-server, SQLite or real-money tests.
type Bet = Extract<RingClient, { type: 'bet' }>;
type Record = RingTicket & { seq: number; acceptedAt: number; alias: string };
type Session = { token: string; balance: number; records: Record[] };
type Connection = { page: Page; route: WebSocketRoute; session: Session | null; closed: boolean };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const PATH = '/live/ringside', WS = '/v5/arena/ringside';
/** Commits the deterministic fallback plan log for a round, exactly as the server does without Jev. */
function planLog(seed: string, commitment: string, bout: ContactBout, carry?: V5Carry): PlanEntry[] { const plans: PlanEntry[] = []; for (let k = 0; k < PLAN_COUNT; k++) { const p = replayContactV5(seed, bout.initial, bout.round, plans, false, carry); if (!p.ok || !p.next) throw new Error('plan log'); plans.push(planEntry(k ? plans[k - 1]!.hash : commitment, k, cornerObsHash(p.next), fallbackPlans(p.next), 'fallback', null)); } return plans; }
const simulate = (seed: string, bout: ContactBout, plans: readonly PlanEntry[], carry?: V5Carry) => CONTACT_ENGINES[COMBAT_V5_VERSION].simulate(seed, bout.initial, bout.round, plans, carry) as V5Replay;
const display = (cents: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(cents / 100);

/** One match ledger: a 30 s window before round 1, closed between rounds, settled once at the end. */
class MatchFixture {
  now = 1_800_000_000_000; revision = 1; seeds = [1, 2, 3].map(n => digest(`match-browser-41-${n}`)); outcomes: RoundOutcome[] = []; carry: V5Carry | undefined;
  round: RingRound;
  records: Record[] = []; readonly sessions = new Map<string, Session>(); readonly connections: Connection[] = []; readonly commands: Bet[] = [];
  readonly poolFees = new Map<string, { fee: number; status: 'paid' | 'refunded' }>();
  constructor() {
    const bout: ContactBout = { id: '41', round: 1, score: { kor: 0, ayaz: 0 }, initial: structuredClone(CONTACT_INITIAL) };
    this.round = this.openRound('41', bout, MATCH_OPEN_MS, { ledger: MATCH_LEDGER, openedAt: this.now, closesAt: this.now + MATCH_OPEN_MS, seedHashes: this.seeds.map((s, i) => matchSeedHash('41', i + 1, s)), previous: [], results: null });
  }
  get seed() { return this.seeds[this.round.bout!.round - 1]!; }
  openRound(id: string, bout: ContactBout, window: number, match: NonNullable<RingRound['match']>): RingRound { return { id, phase: 'open', openedAt: this.now, closesAt: this.now + window, startsAt: null, endsAt: null, nextAt: null, seed: null, commitment: digest(contactCommitmentInputV5(id, this.seeds[bout.round - 1]!, bout)), engine: COMBAT_V5_VERSION, bout, results: null, plans: [], match }; }
  ticket(t: Record): RingTicket { return { id: t.id, roundId: t.roundId, market: t.market, outcome: t.outcome, amount: t.amount, status: t.status, payout: t.payout }; }
  tape(t: Record): RingTapeEntry { return { seq: t.seq, alias: t.alias, market: t.market, outcome: t.outcome, amount: t.amount, acceptedAt: t.acceptedAt, status: t.status, payout: t.payout }; }
  send(c: Connection, frame: RingServer) { expect(parseRingServer(JSON.stringify(frame))).not.toBeNull(); if (!c.closed) c.route.send(JSON.stringify(frame)); }
  get open() { return this.round.phase === 'open' && this.round.bout!.round === 1; }
  snapshot(): RingSnapshot { return { v: 2, type: 'snapshot', revision: this.revision, at: this.now, round: structuredClone(this.round), online: new Set(this.connections.filter(c => !c.closed && c.session).map(c => c.session!.token)).size, participants: new Set(this.records.map(t => t.alias)).size, total: this.records.reduce((n, t) => n + t.amount, 0), count: this.records.length,
    pools: MATCH_MARKETS.map(m => { const rows = this.records.filter(t => t.market === m.id), saved = this.poolFees.get(m.id); return { market: m.id, total: rows.reduce((n, t) => n + t.amount, 0), count: rows.length, sides: Object.fromEntries(m.outcomes.map(o => [o, rows.filter(t => t.outcome === o).reduce((n, t) => n + t.amount, 0)])), fee: saved?.fee ?? 0, distributed: saved ? rows.reduce((n, t) => n + t.payout, 0) : 0, status: saved?.status ?? (this.open ? 'open' : 'locked') }; }), tape: this.records.slice(-30).reverse().map(t => this.tape(t)) }; }
  private(c: Connection, fresh = false) { const s = c.session; if (s) this.send(c, { v: 2, type: 'session', ...(fresh ? { token: s.token } : {}), balance: s.balance, expires: this.now + 3_600_000, tickets: s.records.slice(-16).reverse().map(t => this.ticket(t)) }); }
  broadcast() { for (const c of this.connections) if (!c.closed) { this.send(c, this.snapshot()); this.private(c); } }
  latest(page: Page) { return this.connections.filter(c => c.page === page && !c.closed).at(-1)!; }
  async attach(page: Page) { await page.routeWebSocket(url => url.pathname === WS, route => {
    const c: Connection = { page, route, session: null, closed: false }; this.connections.push(c); expect(new URL(route.url()).search).toBe('');
    route.onClose(async (code, reason) => { if (!c.closed) { c.closed = true; await route.close({ code: code ?? 1000, reason: reason ?? 'Fixture close' }); } });
    route.onMessage(raw => { const f = parseRingClient(String(raw)); expect(f).not.toBeNull(); if (!f) return;
      if (f.type === 'session') { let s = f.token ? this.sessions.get(f.token) : undefined; if (f.token && !s) { this.send(c, { v: 2, type: 'error', code: 'SESSION_INVALID' }); return; } if (!s) { const token = (this.sessions.size + 1).toString(16).padStart(64, '0'); s = { token, balance: 100_000, records: [] }; this.sessions.set(token, s); } c.session = s; this.private(c, !f.token); this.revision++; this.broadcast(); return; }
      if (f.type === 'sync') { this.private(c); this.send(c, this.snapshot()); return; }
      if (f.type === 'audit') { this.send(c, { v: 2, type: 'audit', roundId: this.round.bout!.id, entries: this.records.slice().reverse().map(t => this.tape(t)) }); return; }
      this.commands.push(f); const s = c.session; expect(s).not.toBeNull(); if (!s) return;
      let record = s.records.find(t => t.id === f.id);
      if (!record) { expect(this.open).toBe(true); expect(this.now).toBeLessThan(this.round.closesAt); expect(f.roundId).toBe(this.round.bout!.id); expect(MATCH_MARKETS.some(m => m.id === f.market)).toBe(true); expect(s.balance).toBeGreaterThanOrEqual(f.amount); expect(s.records.some(t => t.roundId === f.roundId && t.market === f.market)).toBe(false);
        s.balance -= f.amount; record = { ...f, status: 'accepted', payout: 0, seq: this.records.length + 1, acceptedAt: this.now, alias: `S-${s.token.slice(-12).toUpperCase()}` }; s.records.push(record); this.records.push(record); this.revision++;
      } else expect(this.ticket(record)).toMatchObject({ id: f.id, roundId: f.roundId, market: f.market, outcome: f.outcome, amount: f.amount });
      this.send(c, { v: 2, type: 'ticket', ticket: this.ticket(record) }); this.broadcast();
    }); this.send(c, this.snapshot());
  }); }
  fight() { const startsAt = this.round.closesAt + V5_PLAN_LEAD_MS; this.now = startsAt; this.round = { ...this.round, phase: 'fighting', startsAt, endsAt: startsAt + COMBAT_V5_DURATION_MS, nextAt: startsAt + COMBAT_V5_DURATION_MS + RINGSIDE_RESULT_MS, seed: this.seed, plans: planLog(this.seed, this.round.commitment, this.round.bout!, this.carry) }; this.revision++; this.broadcast(); }
  /** Ends the round; settles every pool only when the bout is over. Returns true at the end of the match. */
  finish() {
    const replay = simulate(this.seed, this.round.bout!, this.round.plans!, this.carry); this.now = this.round.endsAt!;
    this.outcomes = [...this.outcomes.slice(0, this.round.bout!.round - 1), roundOutcome(replay)];
    const done = matchComplete(this.outcomes), results = done ? matchResults(this.outcomes) : null;
    this.round = { ...this.round, phase: 'result', results: combatResults(replay), match: { ...this.round.match!, results } };
    if (results) for (const market of MATCH_MARKETS) { if (this.poolFees.has(market.id)) continue; const rows = this.records.filter(t => t.market === market.id); const settled = settlePariMutuelPool({ poolId: `41:${market.id}`, outcomes: market.outcomes, feeBps: BigInt(RINGSIDE_FEE_BPS), escrowAmount: BigInt(rows.reduce((n, t) => n + t.amount, 0)), tickets: rows.map(t => ({ ticketId: String(t.seq).padStart(16, '0'), outcome: t.outcome, stake: BigInt(t.amount) })), winningOutcome: results[market.id] });
      for (const t of rows) { t.payout = Number(settled.payouts.find(p => p.ticketId === String(t.seq).padStart(16, '0'))!.payout); t.status = settled.status; [...this.sessions.values()].find(s => s.records.includes(t))!.balance += t.payout; } this.poolFees.set(market.id, { fee: Number(settled.platformFee), status: settled.status }); }
    this.revision++; this.broadcast(); return done;
  }
  /** The next round of the same bout: no betting window, the finished round published for replay. */
  nextRound() {
    const r = this.round, old = r.bout!, previous = simulate(this.seed, old, r.plans!, this.carry); this.carry = previous.carry; expect(previous.finish).toBe('decision');
    this.now = r.nextAt!; const bout: ContactBout = { id: old.id, round: (old.round + 1) as 2 | 3, score: { kor: old.score.kor + (previous.winner === 'kor' ? 1 : 0), ayaz: old.score.ayaz + (previous.winner === 'ayaz' ? 1 : 0) }, initial: carryInitial(previous.frames.at(-1)!) };
    this.round = this.openRound(String(Number(r.id) + 1), bout, 0, { ...r.match!, previous: [...r.match!.previous, { id: r.id, seed: r.seed!, initial: old.initial, plans: r.plans! }], results: null });
    this.revision++; this.broadcast(); return bout;
  }
}
async function prepare(page: Page, fixture: MatchFixture) {
  await page.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) { if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) return null; return original.call(this, type, ...args); } as typeof original; });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.clock.install({ time: fixture.now }); await fixture.attach(page);
}
const fighter = (page: Page, id: 'KOR' | 'AYAZ') => page.getByRole('button', { name: `${id} kazanır seçimi`, exact: true });
const cta = (page: Page) => page.locator('form button[type="submit"]');
const slip = (page: Page) => page.getByRole('complementary', { name: 'Maç kuponu' });
async function open(page: Page) { await page.goto(PATH); await expect(page.getByTestId('ringside-contact')).toHaveAttribute('data-stage', 'betting'); await expect(page.getByTestId('ring-balance')).toHaveText('1.000'); }
async function screenshot(page: Page, name: string, required: string[]) {
  const directory = resolve(__dirname, '../../../../.tooling/contact-ui'); mkdirSync(directory, { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  const geometry = await page.getByTestId('ringside-contact').evaluate(root => {
    const selectors = { stage: '[data-testid="ring-stage"]', flow: '[data-testid="ring-flow"]', cards: '[aria-label$="kazanır seçimi"]', slip: 'aside', amount: '#ring-amount', submit: 'form button[type="submit"]', handle: 'aside > button' };
    return { scope: 'WebSocket match-ledger fixture; WebGL disabled; dev browser DOM only', viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth, elements: Object.fromEntries(Object.entries(selectors).map(([key, selector]) => { const element = root.querySelector(selector); const r = element?.getBoundingClientRect(); return [key, r ? { x: r.x, y: r.y, width: r.width, height: r.height, visible: r.width > 0 && r.height > 0, fullyInViewport: r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight } : null]; })) };
  });
  for (const key of required) expect(geometry.elements[key]?.fullyInViewport, `${name}: ${key} must fit without scrolling`).toBe(true);
  const files = ['apps/web/components/ringside-arena.tsx', 'apps/web/components/ringside-contact.module.css', 'apps/web/lib/use-ringside.ts', 'packages/protocol/src/ringside.ts', 'packages/protocol/src/ringside-match.ts'];
  const sourceHashes = Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(resolve(directory, '../..', file))).digest('hex')]));
  writeFileSync(`${directory}/${name}-geometry.json`, JSON.stringify({ ...geometry, sourceHashes, productionBuild: false }, null, 2)); await page.screenshot({ path: `${directory}/${name}.png` });
}

test.describe('Contact 5 match ledger', () => {
test('desktop: fighter cards fill one match slip; pools, tickets and prices update for every viewer', async ({ page, context }) => {
  const f = new MatchFixture(), other = await context.newPage(); await page.setViewportSize({ width: 1440, height: 900 }); await prepare(page, f); await prepare(other, f); await open(page); await open(other);
  await fighter(page, 'KOR').click(); await expect(fighter(page, 'KOR')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#ring-amount').fill('25'); await expect(cta(page)).toHaveText('KOR kazanır · 25 DEMO'); await cta(page).click();
  await fighter(other, 'AYAZ').click(); await other.getByRole('button', { name: '10', exact: true }).click(); await cta(other).click();
  await expect(page.getByTestId('ring-total')).toContainText('2 bilet · 35 DEMO'); await expect(page.getByTestId('ring-balance')).toHaveText('975');
  await expect(page.getByTestId('ring-tickets')).toContainText('KOR kazanır'); await expect(cta(page)).toHaveText('Bu pazarda biletin var'); await expect(cta(page)).toBeDisabled();
  expect(f.commands.map(c => [c.roundId, c.market, c.outcome, c.amount])).toEqual([['41', 'match-winner', 'kor', 2500], ['41', 'match-winner', 'ayaz', 1000]]);
  // KOR backers share the AYAZ stake: 35 DEMO less 2% over 25 DEMO on KOR.
  await expect(page.getByTestId('ring-tickets')).toContainText(`kazanırsa ${display(Math.floor((3500 - 70) * 2500 / 2500))}`);
  await page.getByRole('group', { name: 'Pazar' }).getByRole('button', { name: 'Tam sonuç' }).click(); await expect(page.locator('fieldset button')).toHaveCount(5);
  await page.locator('fieldset button', { hasText: 'AYAZ durdurmayla' }).click(); await expect(cta(page)).toHaveText('AYAZ durdurmayla · 25 DEMO'); await cta(page).click();
  await expect(page.getByTestId('ring-balance')).toHaveText('950'); await expect(page.getByTestId('ring-tickets').locator('[data-tone]')).toHaveCount(2);
  await page.getByRole('group', { name: 'Pazar' }).getByRole('button', { name: 'Kazanan' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, 'desktop', ['stage', 'flow', 'submit']);
});

for (const width of [320, 390]) test(`mobile ${width}px: tapping a fighter opens the bottom slip; no horizontal overflow`, async ({ page }) => {
  const f = new MatchFixture(); await page.setViewportSize({ width, height: 844 }); await prepare(page, f); await page.goto(PATH);
  await expect(page.getByTestId('ringside-contact')).toHaveAttribute('data-stage', 'betting');
  await expect(slip(page)).toHaveAttribute('data-open', 'false'); await expect(page.locator('#ring-amount')).toBeHidden();
  await fighter(page, 'AYAZ').click(); await expect(slip(page)).toHaveAttribute('data-open', 'true');
  await expect(page.locator('fieldset button[aria-pressed="true"]')).toContainText('AYAZ kazanır');
  await page.locator('#ring-amount').fill('12,5'); await cta(page).click();
  await expect(page.getByTestId('ring-balance')).toHaveText('987,5'); expect(f.commands).toHaveLength(1); expect(f.commands[0]).toMatchObject({ roundId: '41', market: 'match-winner', outcome: 'ayaz', amount: 1250 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, width === 390 ? 'mobile' : 'mobile-320', ['submit', 'amount']);
  await page.locator('aside > button').first().click(); await expect(slip(page)).toHaveAttribute('data-open', 'false');
  await screenshot(page, width === 390 ? 'mobile-collapsed' : 'mobile-320-collapsed', ['stage', 'handle']);
});

test('a whole match: bets close before round 1, rounds replay from the published log, pools settle once at the end', async ({ page, context }) => {
  const f = new MatchFixture(), other = await context.newPage(); await page.setViewportSize({ width: 1280, height: 900 }); await prepare(page, f); await prepare(other, f); await open(page); await open(other);
  await fighter(page, 'KOR').click(); await cta(page).click(); await fighter(other, 'AYAZ').click(); await cta(other).click();
  await expect(page.getByTestId('ring-total')).toContainText('2 bilet'); const player = f.latest(page).session!, ticketId = player.records[0]!.id;
  f.fight(); await expect(page.getByTestId('ringside-contact')).toHaveAttribute('data-stage', 'fighting'); await expect(page.getByTestId('ring-clock')).toContainText('RAUNT 1');
  await expect(page.locator('form')).toHaveCount(0); await expect(page.getByTestId('ring-tickets')).toContainText(/Şu an (önde|geride)|Başa baş/);
  for (let guard = 0; guard < 3; guard++) {
    const ended = f.finish(); await expect(page.getByTestId('ring-stage')).toHaveAttribute('data-phase', 'result');
    if (ended) break;
    expect(player.records[0]!.status).toBe('accepted'); await expect(page.getByTestId('ringside-contact')).toHaveAttribute('data-stage', 'break');
    await expect(page.getByRole('status').filter({ hasText: 'BİTTİ' })).toBeVisible();
    const bout = f.nextRound(); await expect(page.getByTestId('ring-flow').locator('li[data-state="done"]', { hasText: `R${bout.round - 1}` })).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0); await expect(page.getByRole('region', { name: 'Maç özeti' })).toContainText(/aldı|Berabere/);
    f.fight(); await expect(page.getByTestId('ring-clock')).toContainText(`RAUNT ${bout.round}`);
  }
  const results = f.round.match!.results!; expect(results).not.toBeNull();
  await expect(page.getByTestId('ringside-contact')).toHaveAttribute('data-stage', 'final');
  await expect(page.getByRole('status').filter({ hasText: 'SONUCU' })).toContainText(results['match-winner'] === 'draw' ? 'BERABERE' : results['match-winner'].toUpperCase());
  const mine = player.records.find(t => t.id === ticketId)!; expect(mine.status).not.toBe('accepted');
  await expect(page.getByTestId('ring-balance')).toHaveText(display(player.balance));
  await expect(page.getByTestId('ring-tickets')).toContainText(mine.status === 'refunded' ? 'İade' : mine.payout > 0 ? 'Kazandı' : 'Kaybetti');
  const before = player.balance; f.finish(); await expect(page.getByTestId('ring-balance')).toHaveText(display(before)); expect(player.balance).toBe(before);
  await screenshot(page, 'final', ['stage']);
});

test('cutoff closes the slip locally without a push; a locked match field change is rejected', async ({ page }) => {
  const f = new MatchFixture(); await prepare(page, f); await open(page); await page.clock.fastForward(MATCH_OPEN_MS);
  await expect(page.locator('form')).toHaveCount(0); await expect(slip(page)).toContainText('Kapalı'); expect(f.commands).toHaveLength(0);
  const tampered = f.snapshot(); tampered.revision++; tampered.round.match!.seedHashes[2] = digest('swapped'); f.send(f.latest(page), tampered);
  await expect(page.getByTestId('ringside-contact').getByRole('alert')).toContainText('Kilitli maç verisi değişti'); expect(f.commands).toHaveLength(0);
});

test('a revealed seed must match both its round commitment and its published match hash', async ({ page }) => {
  const f = new MatchFixture(); f.fight(); f.round.bout!.initial.health.kor = 999; await prepare(page, f); await page.goto(PATH);
  await expect(page.getByTestId('ringside-contact').getByRole('alert')).toContainText(/Maç seed taahhüdü uyuşmuyor|Maç geçmişi tekrar ile uyuşmuyor/); expect(f.commands).toHaveLength(0);
  const g = new MatchFixture(); g.fight(); g.round.match!.seedHashes[0] = digest('not-this-seed'); const other = await page.context().newPage(); await prepare(other, g); await other.goto(PATH);
  await expect(other.getByTestId('ringside-contact').getByRole('alert')).toContainText('Maç geçmişi tekrar ile uyuşmuyor'); expect(g.commands).toHaveLength(0);
});

test('the 2.5D broadcast draws pick rings while bets are open and the committed bout on a 2D canvas', async ({ page }) => {
  const f = new MatchFixture(); await page.setViewportSize({ width: 1440, height: 900 }); await prepare(page, f); await open(page);
  const canvas = page.locator('[data-boxing-scene="broadcast"] canvas[data-renderer^="canvas2d"]'); await expect(canvas).toHaveCount(1);
  const lit = () => canvas.evaluate((c: HTMLCanvasElement) => { const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let n = 0, orange = 0; for (let i = 0; i < d.length; i += 16) { if (d[i]! + d[i + 1]! + d[i + 2]! > 150) n++; if (d[i]! > 200 && d[i + 1]! > 70 && d[i + 1]! < 130 && d[i + 2]! < 90) orange++; } return { lit: n / (d.length / 16), orange: orange / (d.length / 16) }; });
  await page.clock.runFor(250); const warm = await lit(); expect(warm.lit).toBeGreaterThan(.01); expect(warm.orange).toBeGreaterThan(.0005);
  await page.getByTestId('ring-stage').screenshot({ path: resolve(__dirname, '../../../../.tooling/contact-ui/broadcast-betting.png') });
  f.fight(); await expect(page.getByTestId('ring-stage')).toHaveAttribute('data-phase', 'fighting'); await page.clock.fastForward(12_000); await page.clock.runFor(250);
  expect((await lit()).lit).toBeGreaterThan(.01); await expect(page.getByText('Görüntü açılamadı.', { exact: false })).toHaveCount(0);
  await page.getByTestId('ring-stage').screenshot({ path: resolve(__dirname, '../../../../.tooling/contact-ui/broadcast-fighting.png') });
});
});
