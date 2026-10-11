// Coordinator A/B of the live root-offset rate: same engine bout (seed 7), 30 s, dev runtime, GPU WebGL headless.
import { chromium } from '/Users/macmini/Desktop/Sollish/apps/web/node_modules/@playwright/test/index.mjs';
const [base, label] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(base + '/lab/ringside/play?probe=1&seed=7');
await page.locator('canvas[data-renderer="webgl-sparring"]').waitFor({ timeout: 120_000 });
await page.getByRole('button', { name: 'Dövüşü başlat ↗', exact: true }).click({ timeout: 90_000 });
await page.waitForTimeout(30000);
const r = await page.evaluate(() => {
  const d = window.__sollishProbe, q = (xs, p) => xs.length ? +[...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))].toFixed(4) : null;
  const limb = /glove|upperarm|lowerarm|forearm|hand/, cat = { 'arm-arm': 0, 'arm-body': 0, 'body-body': 0 };
  for (const [pair, n] of Object.entries(d.worstPairs)) { const [a, b] = pair.split('/'); const la = limb.test(a), lb = limb.test(b); cat[la && lb ? 'arm-arm' : la || lb ? 'arm-body' : 'body-body'] += n; }
  return { frames: d.penetration.length, rootJumpMax: q(d.rootJump, 1), rootJumpP99: q(d.rootJump, .99), penP50: q(d.penetration, .5), penP99: q(d.penetration, .99), over1cm: d.penetration.filter(x => x > .01).length, worstFramesOver5mmByCategory: cat, bodyBodyPairs: Object.entries(d.worstPairs).filter(([p]) => !limb.test(p.split('/')[0]) && !limb.test(p.split('/')[1])).sort((a, b) => b[1] - a[1]).slice(0, 4) };
});
await browser.close(); console.log(JSON.stringify({ label, ...r }));
