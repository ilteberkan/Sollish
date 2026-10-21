// Damla lobby posters: original code-drawn SVG (twilight, travertine terraces, turquoise basins, one glowing drop).
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const require = createRequire('/home/user/Sollish/node_modules/.pnpm/node_modules/');
const { chromium } = require('/home/user/Sollish/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright');
const sharp = require('/home/user/Sollish/node_modules/.pnpm/sharp@0.35.5_@types+node@24.19.0/node_modules/sharp');
const OUT = process.argv[2];
const sizes = { tile: [360, 480], wide: [1320, 540], narrow: [780, 520], land: [560, 350] };
function hash(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function terraces(cx, top, dx, dy, rows, path) {
  let s = '';
  for (let i = rows - 1; i >= 0; i--) {
    const y = top + i * dy, half = (i / 2 + 0.55) * dx, face = dy * 0.8, lip = dy * 0.22;
    s += `<ellipse cx="${cx}" cy="${y + face + lip * 0.5}" rx="${half}" ry="${lip}" fill="rgba(20,40,48,.45)"/>`;
    let d = `M${cx - half} ${y} L${cx + half} ${y} Q${cx + half + dx * 0.1} ${y + face * 0.5} ${cx + half - dx * 0.05} ${y + face}`;
    const n = i + 2;
    for (let k = n; k >= 0; k--) { const xk = cx - half + (2 * half * k) / n; d += ` Q${xk + half / n} ${y + face * (1.05 + hash(i, k) * 0.2)} ${xk} ${y + face}`; }
    d += ` Q${cx - half - dx * 0.1} ${y + face * 0.5} ${cx - half} ${y} Z`;
    s += `<path d="${d}" fill="url(#face)"/>`;
    for (let k = 0; k < (i + 2) * 3; k++) { const x = cx - half + 2 * half * hash(k, i * 9); s += `<path d="M${x} ${y + lip} v${face * (0.3 + hash(i, k * 5) * 0.6)}" stroke="#fffaf0" stroke-opacity="${0.15 + hash(k, i) * 0.3}" stroke-width="${1 + hash(i, k) * 2}" stroke-linecap="round"/>`; }
    s += `<ellipse cx="${cx}" cy="${y}" rx="${half + dx * 0.05}" ry="${lip * 1.2}" fill="url(#lip)"/>`;
    let b = 0; for (let j = 0; j < i; j++) if (path[j] === 'R') b++;
    for (let k = 0; k <= i; k++) {
      const bx = cx + (k - i / 2) * dx, on = k === b;
      s += `<ellipse cx="${bx}" cy="${y}" rx="${dx * 0.42}" ry="${Math.min(dy * 0.26, dx * 0.2)}" fill="#fbf7ee"/>`;
      s += `<ellipse cx="${bx}" cy="${y + 1}" rx="${dx * 0.36}" ry="${Math.min(dy * 0.21, dx * 0.16)}" fill="url(#water)"/>`;
      if (on) s += `<ellipse cx="${bx}" cy="${y + 1}" rx="${dx * 0.5}" ry="${Math.min(dy * 0.3, dx * 0.24)}" fill="none" stroke="#e8ffff" stroke-opacity=".75" stroke-width="2"/>`;
    }
  }
  return s;
}
function drop(x, y, r) {
  return `<g transform="translate(${x} ${y})"><circle r="${r * 4}" fill="url(#halo)"/><path d="M0 ${-r * 1.8} C${r * .4} ${-r} ${r} ${-r * .3} ${r} ${r * .2} A${r} ${r} 0 0 1 ${-r} ${r * .2} C${-r} ${-r * .3} ${-r * .4} ${-r} 0 ${-r * 1.8}Z" fill="url(#drop)" stroke="#fff" stroke-width="${r * .12}"/><ellipse cx="${-r * .38}" cy="${-r * .1}" rx="${r * .22}" ry="${r * .36}" fill="#fff" transform="rotate(-22 ${-r * .38} ${-r * .1})"/></g>`;
}
const pools = [['#ff5c70', 10], ['#f08048', 5], ['#e2be54', 2], ['#48c496', 1.2], ['#26b2be', 0.5], ['#40808c', 0.3]];
function poolRow(cx, y, dx, rows, h) {
  let s = '';
  for (let k = 0; k <= rows; k++) {
    const d = Math.abs(k - rows / 2) / (rows / 2), c = d > 0.99 ? '#ffcd46' : d > 0.8 ? '#f08048' : d > 0.6 ? '#e2be54' : d > 0.4 ? '#48c496' : d > 0.2 ? '#26b2be' : '#40808c';
    s += `<rect x="${cx + (k - rows / 2) * dx - dx * 0.44}" y="${y - h / 2}" width="${dx * 0.88}" height="${h}" rx="${h * 0.25}" fill="${c}" stroke="#f6f1e7" stroke-width="2"/>`;
  }
  return s;
}
function svg(w, h, variant) {
  const rows = variant === 'tile' ? 8 : 9, path = 'RLRRLRLRR';
  const land = variant !== 'tile';
  const boardW = land ? Math.min(w * 0.55, h * 1.15) : w * 0.92;
  const cx = land ? w * (variant === 'wide' ? 0.66 : 0.64) : w / 2;
  const dx = boardW / (rows + 1.5);
  const top = land ? h * 0.2 : h * 0.15;
  const dy = (h * (land ? 0.62 : 0.47)) / rows;
  const poolY = top + rows * dy + dy * 0.4;
  let b = 0; for (const p of path.slice(0, rows - 2)) if (p === 'R') b++;
  const dropRow = rows - 2;
  const dropX = cx + (b - dropRow / 2) * dx + dx * 0.32, dropY = top + dropRow * dy - dy * 1.1;
  const title = land
    ? `<g transform="translate(${w * 0.06} ${h * (variant === 'land' ? 0.3 : 0.36)})"><text font-family="Barlow, 'DejaVu Sans', sans-serif" font-weight="800" font-size="${h * (variant === 'land' ? 0.18 : 0.17)}" fill="url(#word)" letter-spacing="${h * 0.012}" stroke="#0c3a48" stroke-width="2" paint-order="stroke">DAMLA</text><text y="${h * 0.1}" font-family="Barlow, 'DejaVu Sans', sans-serif" font-weight="700" font-size="${h * 0.052}" fill="#9fe7e6" letter-spacing="${h * 0.02}">PAMUKKALE</text><rect y="${h * 0.15}" width="${h * 0.42}" height="${h * 0.07}" rx="${h * 0.035}" fill="#3fd0d4"/><text x="${h * 0.21}" y="${h * 0.2}" text-anchor="middle" font-family="Barlow, 'DejaVu Sans', sans-serif" font-weight="800" font-size="${h * 0.034}" fill="#04222a" letter-spacing="1.5">SOLLISH ORIGINAL</text></g>`
    : `<g transform="translate(${w / 2} ${h * 0.85})" text-anchor="middle"><text font-family="Barlow, 'DejaVu Sans', sans-serif" font-weight="800" font-size="${w * 0.19}" fill="url(#word)" letter-spacing="${w * 0.012}" stroke="#0c3a48" stroke-width="2" paint-order="stroke">DAMLA</text><text y="${w * 0.085}" font-family="Barlow, 'DejaVu Sans', sans-serif" font-weight="700" font-size="${w * 0.055}" fill="#9fe7e6" letter-spacing="${w * 0.022}">PAMUKKALE</text></g>`;
  let stars = ''; for (let i = 0; i < 40; i++) stars += `<circle cx="${hash(i, 1) * w}" cy="${hash(i, 2) * h * 0.4}" r="${0.5 + hash(i, 3) * 1.2}" fill="#fff" opacity="${0.3 + hash(i, 4) * 0.5}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#061624"/><stop offset=".55" stop-color="#12394b"/><stop offset="1" stop-color="#2c5e6c"/></linearGradient>
<radialGradient id="glow" cx="${cx / w}" cy=".1" r=".8"><stop offset="0" stop-color="#ffd6a0" stop-opacity=".35"/><stop offset="1" stop-color="#ffd6a0" stop-opacity="0"/></radialGradient>
<linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1ece2"/><stop offset=".55" stop-color="#dcd3c3"/><stop offset="1" stop-color="#b9ad98"/></linearGradient>
<linearGradient id="lip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf8"/><stop offset="1" stop-color="#f1ece2"/></linearGradient>
<radialGradient id="water" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#c9fbf6"/><stop offset=".45" stop-color="#41d3d6"/><stop offset="1" stop-color="#128ea6"/></radialGradient>
<radialGradient id="halo"><stop offset="0" stop-color="#aaffff" stop-opacity=".6"/><stop offset="1" stop-color="#aaffff" stop-opacity="0"/></radialGradient>
<radialGradient id="drop" cx=".35" cy=".4" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#b9f6ff"/><stop offset="1" stop-color="#2fb7d0"/></radialGradient>
<linearGradient id="word" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#dff8f7"/><stop offset="1" stop-color="#8fe3e6"/></linearGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/><rect width="${w}" height="${h}" fill="url(#glow)"/>${stars}
${terraces(cx, top, dx, dy, rows, path)}
${poolRow(cx, poolY, dx, rows, Math.min(dy * 0.7, dx * 0.6))}
${drop(dropX, dropY, Math.max(6, dx * 0.2))}
${title}
</svg>`;
}
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
for (const [variant, [w, h]] of Object.entries(sizes)) {
  const s = svg(w, h, variant);
  writeFileSync(`${OUT}/damla-${variant}.svg`, s);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0">${s}</body></html>`);
  const png = await page.screenshot({ type: 'png' });
  let q = 82, out;
  do { out = await sharp(png).webp({ quality: q, effort: 6 }).toBuffer(); q -= 6; } while (out.length > 76 * 1024 && q > 30);
  writeFileSync(`${OUT}/damla-${variant}.webp`, out);
  writeFileSync(`${OUT}/damla-${variant}.png`, png);
  console.log(variant, out.length);
}
await browser.close();
