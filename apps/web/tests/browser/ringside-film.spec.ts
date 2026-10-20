import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { simulateContactCombatV5, V5_STRIKES, isV5Kick } from '@sollish/protocol';
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

// FILMSTRIPS of the 2D broadcast: three contact sheets of consecutive frames (80 ms steps) of a real engine round, saved to
// .tooling/contact-ui/film-*.png so motion and contact can be reviewed without watching video:
//   film-walk.png            a walking exchange (distance-driven walk cycle, no skating)
//   film-combo.png           a punch combination with hits (reach, hit reactions, hit-stop)
//   film-kick-knockdown.png  a kick, the knockdown and the fighter rising
// Every tile is the canvas as drawn by the real renderer (the dev hooks ringPreview / ringSeek / ringRender of the broadcast host),
// rendered in real-time order (about 60 fps in between the 80 ms tiles) so the smoothing behaves as it does live. The numeric gates
// (push boxes never overlap, per-frame position cap, tip-to-target gap at contact, referee never inside a fighter) run over three
// whole rounds in tests/ringside-display.test.ts; this file is the visual proof. Not a GPU, hosted-server or real-money test.
const PATH = '/live/ringside', WS = '/v5/arena/ringside', TICK = 50, STEP = 80, DIR = resolve(__dirname, '../../../../.tooling/contact-ui');
type Replay = ReturnType<typeof simulateContactCombatV5>;
const seedOf = (n: number) => createHash('sha256').update(`film:${n}`).digest('hex');
const isPunch = (t: string) => t in V5_STRIKES && !isV5Kick(t);

/** Path length (mm) of both fighters between two ticks. */
function travel(r: Replay, a: number, b: number) { let d = 0; for (let i = Math.max(1, a + 1); i <= Math.min(r.frames.length - 1, b); i++) for (const id of ['kor', 'ayaz'] as const) d += Math.hypot(r.frames[i]![id].x - r.frames[i - 1]![id].x, r.frames[i]![id].z - r.frames[i - 1]![id].z); return d; }
const contacts = (r: Replay, a: number, b: number) => r.events.filter(e => e.tick >= a && e.tick <= b && ['hit', 'block', 'dodge', 'miss'].includes(e.type));

/** The walking window: the most travel in 12 tiles with no contact. */
function walkWindow(r: Replay) { let best = { t: 0, d: -1 }; const span = Math.round(STEP * 12 / TICK); for (let t = 0; t + span < r.frames.length; t += 2) { if (contacts(r, t - 4, t + span).length) continue; const d = travel(r, t, t + span); if (d > best.d) best = { t, d }; } return best; }
/** The combination window: the most landed punches in 12 tiles. */
function comboWindow(r: Replay) { let best = { t: 0, n: -1 }; const span = Math.round(STEP * 12 / TICK); for (let t = 0; t + span < r.frames.length; t += 1) { const n = r.events.filter(e => e.tick >= t && e.tick <= t + span && (e.type === 'hit' || e.type === 'block') && isPunch(e.technique)).length * 3 + contacts(r, t, t + span).length; if (n > best.n) best = { t, n }; } return best; }

function pick(): { seed: string; r: Replay } {
  for (let n = 1; n <= 80; n++) { const seed = seedOf(n), r = simulateContactCombatV5(seed); if (r.events.some(e => e.type === 'knockdown' && isV5Kick(e.technique)) && r.events.some(e => e.type === 'rise')) return { seed, r }; }
  for (let n = 1; n <= 80; n++) { const seed = seedOf(n), r = simulateContactCombatV5(seed); if (r.events.some(e => e.type === 'knockdown') && r.events.some(e => e.type === 'rise')) return { seed, r }; }
  const seed = seedOf(1); return { seed, r: simulateContactCombatV5(seed) };
}

/** Plays the preview round in order and returns a contact sheet (PNG data URL) of the canvas at the given times (ms). */
async function sheet(page: Page, seed: string, times: number[], labels: string[], cols: number) {
  return page.evaluate(async ({ seed, times, labels, cols }) => {
    const host = document.querySelector('[data-boxing-scene="broadcast"]') as HTMLElement & { ringRender: (n: number) => void; ringSeek: (m: number | null) => void; ringPreview: (s: string | null) => void };
    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    host.ringPreview(seed);
    let now = 5000, cur = Math.max(0, times[0]! - 900);
    const advance = (to: number) => { for (; cur < to; cur += 1000 / 60) { host.ringSeek(cur); now += 1000 / 60; host.ringRender(now); } host.ringSeek(to); now += 1000 / 60; host.ringRender(now); cur = to; };
    const rows = Math.ceil(times.length / cols), tw = 480, th = Math.round(tw * canvas.height / canvas.width), label = 22;
    const out = document.createElement('canvas'); out.width = cols * tw; out.height = rows * (th + label);
    const g = out.getContext('2d')!; g.fillStyle = '#05060a'; g.fillRect(0, 0, out.width, out.height); g.font = '600 13px ui-monospace, monospace'; g.textBaseline = 'middle';
    for (let i = 0; i < times.length; i++) {
      advance(times[i]!);
      const x = (i % cols) * tw, y = Math.floor(i / cols) * (th + label);
      g.drawImage(canvas, 0, 0, canvas.width, canvas.height, x, y + label, tw, th);
      g.fillStyle = '#e9e4da'; g.fillText(labels[i]!, x + 8, y + label / 2);
      g.strokeStyle = 'rgba(255,255,255,.18)'; g.strokeRect(x + .5, y + .5, tw - 1, th + label - 1);
    }
    return out.toDataURL('image/png');
  }, { seed, times, labels, cols });
}

test.describe('Ringside 2D filmstrips', () => {
  test('walking exchange, punch combination with hits, and a kick with the knockdown and rise', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.routeWebSocket(url => url.pathname === WS, () => { /* an open, silent socket: only the canvas is needed */ });
    await page.goto(PATH);
    const host = page.locator('[data-boxing-scene="broadcast"]'); await expect(host).toHaveCount(1);
    await expect(page.locator('[data-boxing-scene="broadcast"] canvas[data-renderer^="canvas2d"]')).toHaveCount(1);
    await expect.poll(() => host.evaluate(h => { const f = (h as unknown as { ringFrames?: () => { loaded: number; total: number; stage: boolean } | null }).ringFrames?.(); return !!f && f.loaded >= f.total && f.stage; }), { timeout: 20_000 }).toBe(true);
    mkdirSync(DIR, { recursive: true });
    const { seed, r } = pick(), tag = (ms: number) => { const t = Math.round(ms / TICK), ev = r.events.filter(e => e.tick === t && e.type !== 'count').map(e => `${e.type[0]!.toUpperCase()}:${e.actor[0]}:${e.technique}`).join(' '); return `t=${String(Math.round(ms)).padStart(5)} ms  tick ${t}${ev ? '  ' + ev : ''}`; };
    const save = async (name: string, times: number[], cols: number) => { const url = await sheet(page, seed, times, times.map(tag), cols); writeFileSync(`${DIR}/${name}.png`, Buffer.from(url.split(',')[1]!, 'base64')); };

    const w = walkWindow(r), c = comboWindow(r);
    await save('film-walk', Array.from({ length: 12 }, (_, i) => w.t * TICK + i * STEP), 4);
    await save('film-combo', Array.from({ length: 12 }, (_, i) => c.t * TICK + i * STEP), 4);

    // Kick and knockdown: from just before the knockdown blow, in 80 ms steps, then the rise (the second half of the sheet).
    const kd = r.events.find(e => e.type === 'knockdown')!, rise = r.events.find(e => e.type === 'rise' && e.tick > kd.tick), kdMs = kd.tick * TICK, riseMs = (rise?.tick ?? kd.tick + 60) * TICK;
    const strikeStart = [...r.events].reverse().find(e => e.type === 'strike' && e.actor === kd.actor && e.tick <= kd.tick)?.tick ?? kd.tick - 6;
    const first = Math.min(strikeStart * TICK, kdMs - 4 * STEP), times = [...Array.from({ length: 7 }, (_, i) => first + i * STEP), ...Array.from({ length: 5 }, (_, i) => riseMs - 2 * STEP + i * STEP)];
    await save('film-kick-knockdown', times, 4);
    expect(w.d).toBeGreaterThan(300); expect(c.n).toBeGreaterThan(0);
  });
});
