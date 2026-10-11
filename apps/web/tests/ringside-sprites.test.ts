// Gates for the cutout sprite set (public/sprites/ringside, built by scripts/ringside-sprites.mjs): the manifest schema, every
// part present for all three characters, anchors inside their part, the payload budget, and the placement maths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { REQUIRED_PARTS, partMatrix, apply, boneLength, type CharacterId, type Manifest, type PartDef } from '../lib/ringside-25d/sprites';

const root = new URL('../public/sprites/ringside/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('parts.json', root), 'utf8')) as Manifest & { totalBytes: number };
const characters = Object.keys(REQUIRED_PARTS) as CharacterId[];

test('every required part exists for kor, ayaz and the referee, with a file, a size and a colour', () => {
  for (const id of characters) for (const name of REQUIRED_PARTS[id]) {
    const def = manifest.characters[id]?.parts[name];
    assert.ok(def, `${id}/${name} in parts.json`);
    const file = new URL(`${id}/${def.file}`, root);
    assert.ok(existsSync(file) && statSync(file).size > 500, `${id}/${name} file`);
    assert.ok(def.size[0] >= 8 && def.size[1] >= 8, `${id}/${name} size`);
    assert.equal(def.color.length, 3); assert.ok(def.color.every(v => v >= 0 && v <= 255));
    assert.ok(def.width.prox > 0 && def.width.dist > 0, `${id}/${name} widths`);
  }
});

test('anchors are inside the part and the two joints are well apart', () => {
  for (const id of characters) for (const [name, def] of Object.entries(manifest.characters[id].parts) as [string, PartDef][]) {
    for (const [k, [x, y]] of Object.entries(def.anchors) as [string, [number, number]][]) assert.ok(x >= 0 && x <= def.size[0] && y >= 0 && y <= def.size[1], `${id}/${name} ${k} anchor ${x},${y} inside ${def.size}`);
    assert.ok(boneLength(def) >= .25 * Math.min(def.size[0], def.size[1]) && boneLength(def) >= 20, `${id}/${name} anchors apart`);
    for (const [k, [x, y]] of Object.entries(def.extra ?? {})) assert.ok(x >= 0 && x <= def.size[0] && y >= 0 && y <= def.size[1], `${id}/${name} extra ${k}`);
  }
  for (const id of characters) assert.ok(manifest.characters[id].parts.torso!.extra?.shoulder, `${id} torso has a shoulder joint`);
});

test('payload budget: all character parts under 1.5 MB, ring canvas and apron under 400 KB each', () => {
  let total = 0;
  for (const id of characters) for (const def of Object.values(manifest.characters[id].parts)) total += statSync(new URL(`${id}/${def.file}`, root)).size;
  assert.ok(total <= 1.5 * 1024 * 1024, `characters ${total}`);
  for (const f of [manifest.canvas.file, manifest.apron.file]) assert.ok(statSync(new URL(f, root)).size <= 400 * 1024, f);
});

test('partMatrix puts the proximal anchor on the first joint and the distal anchor on the second, mirrored or not', () => {
  const def: PartDef = { file: 'x', size: [100, 300], anchors: { prox: [30, 10], dist: [60, 280] }, width: { prox: 20, dist: 20 }, color: [1, 2, 3] };
  for (const mirror of [false, true]) for (const [a, b] of [[{ x: 10, y: 20 }, { x: 110, y: 220 }], [{ x: 300, y: 300 }, { x: 250, y: 120 }], [{ x: 0, y: 0 }, { x: 0, y: 90 }]]) {
    const L = Math.hypot(b.x - a.x, b.y - a.y), m = partMatrix(def, mirror, a, b, L / boneLength(def), 1.7);
    const prox = apply(m, def.anchors.prox[0], def.anchors.prox[1]), dist = apply(m, def.anchors.dist[0], def.anchors.dist[1]);
    assert.ok(Math.hypot(prox.x - a.x, prox.y - a.y) < 1e-6 && Math.hypot(dist.x - b.x, dist.y - b.y) < 1e-6, `mirror ${mirror} anchors`);
    // A proper rotation plus scales: the determinant keeps its sign (no reflection) for the unmirrored sprite and flips for the mirrored one.
    const det = m[0] * m[3] - m[1] * m[2]; assert.ok(mirror ? det < 0 : det > 0);
  }
});
