/**
 * Ringside 2D broadcast: a classic fighting-game view. Frame sprites from a FIXED SIDE CAMERA (no orbit). What stands where and
 * which key frame shows is decided by ./display.ts (push boxes, strike reach, smooth motion, walk cycle by distance, minimum frame
 * holds) from the engine frames; ./animations.ts maps engine action, phase and events to key frames so the contact frame lands on
 * the engine's contact tick. Hit-stop, a squash and impact flashes sell the blows; frames snap, nothing cross-fades. The camera only
 * pans and zooms to keep both fighters framed. The background is the stage image (./arena.ts) with only the front ropes and the
 * apron over the fighters.
 *
 * Presentation only: it reads a committed replay and the round phase. Camera, frame rate, reduced motion, sound and hidden tabs
 * never touch a result or payout. Input is tap-to-select a fighter while bets are open (nothing else).
 */
import { V5_STRIKES, contactGuardPose, isV5Kick, isV5Strike, simulateContactCombatV5, type FighterId, type V5Fighter, type SparringEvent } from '@sollish/protocol';
import type { BroadcastProps } from '../ringside-25d/scene';
import { DEFAULT_BROADCAST_LABELS } from '../ringside-labels';
import { fallbackPlate, loadPlate, hash, type Canvas } from '../ringside-25d/arena';
import { loadRingsideAudio, type RingsideAudio } from '../ringside-audio';
import { TICK_MS, clamp, fighterPose, type Outcome, type Replay } from './animations';
import { DISPLAY, DisplaySim, type DisplayView } from './display';
import { drawFrame, loadFrames, metaOf, type CharKey, type FrameSet } from './frames';
import { APRON, HEIGHT_MM, STAGE, depthK, damp, fitScale, floorX, floorY, framing, groundLine, type Cam } from './geometry';
import { drawBackdrop, drawRingBack, drawRingFront, drawShadow, drawStage, loadTextures, softPlate, type Textures } from './arena';

export type Broadcast2DProps = BroadcastProps;
const TEAM = { kor: { color: '#ff5a1f', rgb: '255,120,70', name: 'KOR' }, ayaz: { color: '#4cc9f0', rgb: '110,210,245', name: 'AYAZ' } } as const;
const fighterAt = (id: FighterId, x: number, yaw: number): V5Fighter => ({ id, x, z: 0, yawMilliRad: yaw, health: 1000, stamina: 1000, stun: 0, action: 'guard', actionAt: 0, until: 0, phase: 'idle', combo: 0, hits: 0, knockdowns: 0, pose: contactGuardPose({ x, z: 0, yawMilliRad: yaw }) });
/** Before a seed is revealed: the engine's documented start marks, no seed or result implied. */
const WARMUP: Replay = { frames: [{ tick: 0, kor: fighterAt('kor', -1300, 1571), ayaz: fighterAt('ayaz', 1300, -1571), referee: { x: 0, z: -1600, yawMilliRad: 0, mode: 'watch', count: 0 } }], events: [] };

/** Display time with a brief hit-stop on clean shots; it catches up within ~150 ms. Never ahead of real time. */
export function hitStopTime(events: Replay['events'], realMs: number): number {
  let lag = 0;
  const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
  for (const e of events) {
    if (e.type !== 'hit') continue;
    const t = e.tick * TICK_MS, since = realMs - t;
    if (since < 0) break;
    if (since > 260) continue;
    const hold = clamp(e.damage / 50, .5, 1.2) * (e.counter ? 70 : 55);
    lag = Math.max(lag, since < hold ? since : hold * (1 - smooth((since - hold) / 150)));
  }
  return realMs - lag;
}

type View = { pan: number; visible: number; init: boolean; key: string; sim: DisplaySim; scale: number };
const mkView = (): View => ({ pan: 0, visible: 5200, init: false, key: '', sim: new DisplaySim(null), scale: .17 });

/** Mounts the 2D broadcast on `host` (a positioned element) and returns the cleanup. `props` is read on every frame. */
export function mountBroadcast2D(host: HTMLElement, props: () => Broadcast2DProps): () => void {
  let TXT = DEFAULT_BROADCAST_LABELS;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  // pan-y: vertical swipes keep scrolling the page; the only input is a tap.
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) { props().onError?.(); canvas.remove(); return () => {}; }

  let plate: Canvas = fallbackPlate();
  const cancelPlate = loadPlate('/images/ringside-arena.jpg', c => { plate = softPlate(c); }, () => {});
  plate = softPlate(plate);
  let tex: Textures = { canvas: null, apron: null, stage: null };
  const textures = loadTextures('/sprites/ringside/', t => { tex = t; });
  let frames: FrameSet | null = null;
  const live = mkView(), replayView = mkView();
  const cancelFrames = loadFrames('/sprites/ringside2d/', set => { frames = set; live.sim.setManifest(set.manifest); replayView.sim.setManifest(set.manifest); if (set.manifest.stage) textures.stage(`/sprites/ringside2d/${set.manifest.stage.file}`); }, () => { frames = null; });

  let raf = 0, disposed = false, ready = false, visible = true, last = -Infinity, lastNow = 0, dpr = 1, seek: number | null = null, preview: Replay | null = null;
  const boxes: { id: FighterId; x0: number; y0: number; x1: number; y1: number }[] = [];
  let audio: RingsideAudio | null = null, audioMs = -1, audioKey = '', bellKey = '';
  const audioAbort = new AbortController();

  const resize = () => {
    const r = host.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, r.width > 900 ? 1.6 : 2);
    canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr)); last = -Infinity;
  };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(host);
  const io = new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); }); io.observe(host);

  // ---- input: a tap selects a fighter (the only interaction) -----------------------------------------
  const onClick = (e: MouseEvent) => {
    const select = props().onSelectFighter; if (!select) return;
    const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    const hit = boxes.find(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
    if (hit) select(hit.id);
  };
  canvas.addEventListener('click', onClick);

  const silhouette = (x: number, y: number, h: number, color: string) => { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x - h * .13, y - h, h * .26, h, h * .1); ctx.fill(); };

  // The referee is drawn through a small layer so he can be tinted darker (upstage, away from the key light) without touching the fighters.
  const layer = document.createElement('canvas'), lctx = layer.getContext('2d');
  const drawRefSprite = (set: FrameSet, frame: number, x: number, y: number, px: number, dir: 1 | -1): boolean => {
    if (!lctx) return drawFrame(ctx, set, 'referee', frame, x, y, px, dir);
    const h = Math.max(8, Math.ceil(HEIGHT_MM.referee * px * 1.3)), w = Math.max(8, Math.ceil(h * 1.1));
    if (layer.width !== w || layer.height !== h) { layer.width = w; layer.height = h; } else lctx.clearRect(0, 0, w, h);
    const ok = drawFrame(lctx, set, 'referee', frame, w / 2, h - 3, px, dir);
    if (!ok) return false;
    lctx.save(); lctx.globalCompositeOperation = 'source-atop'; lctx.fillStyle = 'rgba(8,12,26,.3)'; lctx.fillRect(0, 0, w, h); lctx.restore();
    ctx.drawImage(layer, x - w / 2, y - h + 3);
    return true;
  };

  // ---- one view of the fight (live or replay) ----------------------------------------------------------
  const drawView = (replay: Replay, timeMs: number, phase: BroadcastProps['phase'], view: View, now: number, dt: number, reduced: boolean, winner: FighterId | 'draw' | null, isReplay: boolean) => {
    const W = canvas.width, H = canvas.height, lastTick = replay.frames.length - 1;
    const tickF = phase === 'fighting' ? clamp(timeMs / TICK_MS, 0, lastTick) : phase === 'finished' ? lastTick : 0;
    const outcome = (id: FighterId): Outcome => phase !== 'finished' || !winner ? null : winner === 'draw' ? 'draw' : winner === id ? 'win' : 'lose';
    const accent = phase === 'finished' && (winner === 'kor' || winner === 'ayaz') ? winner : null;
    view.sim.scale = view.scale;
    const dv: DisplayView = view.sim.step(replay, tickF, dt * 1000, { kor: outcome('kor'), ayaz: outcome('ayaz') }, now);
    const eng = replay.frames[Math.min(lastTick, Math.floor(tickF))]!;

    // Camera: pan and zoom only. During a count, a break or a stoppage the referee is part of the frame.
    const refIn = eng.referee.mode !== 'watch' || eng.kor.action === 'down' || eng.ayaz.action === 'down' || eng.kor.action === 'rise' || eng.ayaz.action === 'rise';
    const stageOn = !!tex.stage, fr = framing(refIn ? [dv.kor.x, dv.ayaz.x, dv.ref.x] : [dv.kor.x, dv.ayaz.x], stageOn ? STAGE.halfMm : APRON + 400);
    if (!view.init) { view.init = true; view.pan = fr.pan; view.visible = fr.visible; }
    else { view.pan = damp(view.pan, fr.pan, reduced ? 12 : 4.5, dt); view.visible = damp(view.visible, fr.visible, reduced ? 12 : 2.5, dt); }
    const scale = fitScale(W, H, view.visible);
    // The stage image must always cover the picture: with the zoom the height allows (not only the framing's), the pan stays inside it.
    const reach = Math.max(0, (stageOn ? STAGE.halfMm : APRON + 400) - W / scale / 2), pan = clamp(view.pan, -reach, reach);
    view.scale = scale;
    const cam: Cam = { panMm: pan, scale, W, H, groundY: groundLine(H, scale), shakeX: 0, shakeY: 0 };

    // Impacts: events within the last 900 ms (flashes, labels, camera shake).
    type Imp = { e: Replay['events'][number]; ageMs: number };
    const imps: Imp[] = [];
    for (const e of replay.events) {
      if (e.tick > tickF) break;
      if (e.type !== 'hit' && e.type !== 'block' && e.type !== 'dodge' && e.type !== 'knockdown') continue;
      const ageMs = (tickF - e.tick) * TICK_MS; if (ageMs <= 900) imps.push({ e, ageMs });
    }
    if (!reduced) for (const { e, ageMs } of imps) if (e.type === 'hit' && ageMs < 170) { const k = clamp(e.damage / 50) * (1 - ageMs / 170) * 9 * dpr; cam.shakeX += (hash(Math.floor(now / 16) + e.tick) - .5) * 2 * k; cam.shakeY += (hash(Math.floor(now / 16) + e.tick + 9) - .5) * k; }

    if (tex.stage) drawStage(ctx, cam, tex.stage, accent);
    else { drawBackdrop(ctx, cam, plate, accent); drawRingBack(ctx, cam, tex); }

    // The referee stands upstage: smaller, darker, and always drawn behind both fighters.
    {
      const z = dv.ref.z, px = scale * depthK(z) * DISPLAY.refSize, x = floorX(cam, dv.ref.x, z), y = floorY(cam, z);
      drawShadow(ctx, x, y, 280 * px, .3);
      if (!frames || !drawRefSprite(frames, dv.ref.frame, x, y, px, dv.ref.dir)) silhouette(x, y, HEIGHT_MM.referee * px, '#9a958b');
    }
    const ents = [{ id: 'kor' as const, z: dv.kor.z }, { id: 'ayaz' as const, z: dv.ayaz.z }].sort((a, b) => a.z - b.z);
    if (!isReplay) boxes.length = 0;
    const where: Partial<Record<FighterId, { x: number; y: number; k: number; px: number; h: number; dir: 1 | -1; frame: number }>> = {};
    for (const en of ents) {
      const z = dv[en.id].z, k = depthK(z), px = scale * k, x = floorX(cam, dv[en.id].x, z), y = floorY(cam, z);
      const id = en.id, v = dv[id], down = v.why === 'down', who: CharKey = id;
      drawShadow(ctx, x, y, (down ? 640 : 330) * px * (1 - Math.min(.4, v.lift / 90)), (down ? .5 : .46) * (1 - Math.min(.5, v.lift / 60)));
      const reduce = reduced ? 0 : 1, h = HEIGHT_MM[id] * px;
      if (!frames || !drawFrame(ctx, frames, who, v.frame, x, y, px, v.dir, { sx: 1 + (v.sx - 1) * reduce, sy: 1 + (v.sy - 1) * reduce, lean: v.lean * reduce, lift: v.lift * px * reduce })) silhouette(x, y, h, TEAM[id].color);
      where[id] = { x, y, k, px, h, dir: v.dir, frame: v.frame };
      if (!isReplay) boxes.push({ id, x0: (x - 520 * px) / dpr, x1: (x + 520 * px) / dpr, y0: (y - h * 1.02) / dpr, y1: (y + 60 * px) / dpr });
    }
    drawRingFront(ctx, cam, tex);

    // Impact effects on top: flash on the glove or foot, shock ring, spikes and one callout at a time.
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const newest = new Map<string, number>();
    imps.forEach(({ e, ageMs }, n) => { const k = `${e.type}:${e.target}`, cur = newest.get(k); if (cur === undefined || ageMs < imps[cur]!.ageMs) newest.set(k, n); });
    const shown = new Set([...newest.values()].sort((a, b) => imps[a]!.ageMs - imps[b]!.ageMs).slice(0, 1));
    imps.forEach(({ e, ageMs }, n) => {
      const tb = where[e.target], ab = where[e.actor]; if (!tb || !ab) return;
      if (e.type !== 'hit' && e.type !== 'block') {
        if (e.type === 'dodge' && shown.has(n) && ageMs < 500) { const fade = 1 - ageMs / 500; ctx.font = `900 ${Math.round(17 * dpr)}px ui-sans-serif, system-ui, sans-serif`; ctx.fillStyle = `rgba(233,228,218,${fade * .9})`; ctx.fillText(TXT.dodge, tb.x, tb.y - tb.h * 1.05 - (ageMs / 500) * 24 * dpr); }
        return;
      }
      // The flash sits where the blow met the target: on his hurtbox edge facing the attacker (head box for head blows, torso box otherwise,
      // in the pose he had just before the blow), at the height of the striking glove or foot in the contact frame.
      const part = e.bodyPart ?? 'body', s = scale * tb.k, man = frames?.manifest;
      const am = man ? metaOf(man, e.actor, fighterPose(replay, e.actor, e.tick).frame) : null, tm = man ? metaOf(man, e.target, fighterPose(replay, e.target, Math.max(0, e.tick - .001)).frame) : null;
      const toward = Math.sign(ab.x - tb.x) || -tb.dir, region = isV5Strike(e.technique) ? V5_STRIKES[e.technique].target : 'body';
      let cx = tb.x + toward * 170 * s, cy = tb.y - (part === 'head' ? 1560 : part === 'leg' ? 480 : 1150) * s;
      if (man && am && tm) { const box = region === 'head' ? tm.head : tm.body; cx = tb.x + toward * Math.abs(box[1] - tm.anchor[0]) * man.characters[e.target].mmPerPx * tb.px; cy = tb.y - (am.anchor[1] - am.tip[1]) * man.characters[e.actor].mmPerPx * ab.px; }
      const rgb = e.type === 'block' ? '233,228,218' : TEAM[e.actor].rgb, t = ageMs / 1000, r = (60 + t * (e.type === 'hit' ? 1000 : 500)) * s * .5;
      if (e.type === 'hit' && t < .14) { const R = 260 * s, core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); core.addColorStop(0, `rgba(255,252,240,${(1 - t / .14) * .95})`); core.addColorStop(.35, `rgba(${rgb},${(1 - t / .14) * .6})`); core.addColorStop(1, `rgba(${rgb},0)`); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = core; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); ctx.restore(); }
      if (t < .45) { ctx.strokeStyle = `rgba(${rgb},${(1 - t / .45) * .9})`; ctx.lineWidth = Math.max(1.5, (1 - t / .45) * 36 * s); ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, r), 0, Math.PI * 2); ctx.stroke(); }
      if (e.type === 'hit' && t < .2) { ctx.strokeStyle = `rgba(255,246,228,${1 - t / .2})`; ctx.lineWidth = Math.max(1, 14 * s); for (let i = 0; i < 10; i++) { const ang = hash(e.tick * 31 + i) * Math.PI * 2, r0 = r * 1.1, r1 = r * (1.7 + hash(e.tick + i)); ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1); ctx.stroke(); } }
      let label = '';
      if (e.type === 'hit') label = e.counter ? TXT.counter : (e.combo ?? 0) >= 1 ? TXT.combo((e.combo ?? 0) + 1) : (isV5Kick(e.technique) ? (TXT.kicks as Record<string, string>)[e.technique] : (TXT.parts as Record<string, string>)[part]) ?? '';
      else label = TXT.parts.guard;
      if (imps.some(o => o.e.type === 'knockdown' && Math.abs(o.ageMs - ageMs) <= TICK_MS) && e.type === 'hit') label = '';
      const a = ageMs / 1100;
      if (!label || a > .55 || !shown.has(n)) return;
      const fade = 1 - a / .55, size = Math.round(19 * dpr * (e.counter || (e.combo ?? 0) >= 2 ? 1.25 : 1)), ly = Math.min(cy, tb.y - tb.h * .75) - (a * 300) * s * .6;
      ctx.font = `900 ${size}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = `rgba(0,0,0,${(.55 * fade).toFixed(3)})`; ctx.fillText(label, cx + 1.5 * dpr, ly + 1.5 * dpr);
      ctx.fillStyle = e.type === 'hit' ? `rgba(${rgb},${fade})` : `rgba(233,228,218,${fade * .95})`; ctx.fillText(label, cx, ly);
    });
    return { kd: eng.kor.action === 'down' ? { fighter: 'kor' as const } : eng.ayaz.action === 'down' ? { fighter: 'ayaz' as const } : null, tickF };
  };

  // ---- overlays -------------------------------------------------------------
  let uiFont = '';
  const pickOverlay = (sel: NonNullable<BroadcastProps['selection']>, now: number, reduced: boolean) => {
    if (!uiFont) uiFont = getComputedStyle(document.body).fontFamily || 'ui-sans-serif, system-ui, sans-serif';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const b of boxes) {
      const team = TEAM[b.id], on = sel.selected === b.id, cx = (b.x0 + b.x1) / 2 * dpr, foot = (b.y1 - 4) * dpr, w = Math.max(30 * dpr, (b.x1 - b.x0) * dpr * .55);
      const pulse = reduced ? 0 : (now / 1500 + (b.id === 'ayaz' ? .5 : 0)) % 1;
      ctx.beginPath(); ctx.ellipse(cx, foot, w * .8, w * .24, 0, 0, Math.PI * 2);
      if (on) { ctx.fillStyle = `rgba(${team.rgb},.22)`; ctx.fill(); }
      ctx.lineWidth = (on ? 3.5 : 2) * dpr; ctx.strokeStyle = `rgba(${team.rgb},${on ? 1 : .75})`; ctx.stroke();
      if (!reduced) { ctx.beginPath(); ctx.ellipse(cx, foot, w * (.8 + .55 * pulse), w * (.24 + .16 * pulse), 0, 0, Math.PI * 2); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = `rgba(${team.rgb},${.6 * (1 - pulse)})`; ctx.stroke(); }
      const label = sel.labels[b.id]; if (!label) continue;
      ctx.font = `600 ${Math.round(15 * dpr)}px ${uiFont}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(label).width + 26 * dpr, th = 32 * dpr, x = cx - tw / 2, y = Math.max(8 * dpr, b.y0 * dpr - th - 12 * dpr);
      ctx.beginPath(); ctx.roundRect(x, y, tw, th, th / 2);
      ctx.fillStyle = on ? team.color : 'rgba(10,13,18,.84)'; ctx.fill(); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = team.color; ctx.stroke();
      ctx.fillStyle = on ? '#0a0d12' : '#f3f5f8'; ctx.fillText(label, cx, y + th / 2 + dpr);
    }
  };
  const banner = (text: string, sub: string, color: string, alpha: number, y = .2) => {
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(Math.min(W, H) * .11)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillText(text, W / 2 + 3 * dpr, H * y + 3 * dpr);
    ctx.fillStyle = color; ctx.fillText(text, W / 2, H * y);
    if (sub) { ctx.font = `700 ${Math.round(Math.min(W, H) * .032)}px ui-sans-serif, system-ui, sans-serif`; ctx.fillStyle = 'rgba(233,228,218,.85)'; ctx.fillText(sub, W / 2, H * y + Math.min(W, H) * .085); }
    ctx.globalAlpha = 1;
  };
  const replayFrame = (label: string, progress: number) => {
    const W = canvas.width, H = canvas.height, bar = H * .085;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar);
    ctx.fillStyle = 'rgba(255,90,31,.95)'; ctx.fillRect(18 * dpr, bar + 14 * dpr, 92 * dpr, 24 * dpr);
    ctx.fillStyle = '#0b0d10'; ctx.font = `900 ${Math.round(12 * dpr)}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, 26 * dpr, bar + 26 * dpr);
    ctx.fillStyle = 'rgba(233,228,218,.25)'; ctx.fillRect(0, H - bar - 2 * dpr, W, 2 * dpr);
    ctx.fillStyle = 'rgba(233,228,218,.85)'; ctx.fillRect(0, H - bar - 2 * dpr, W * clamp(progress), 2 * dpr);
  };
  const grade = (flash: number) => {
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const vig = ctx.createRadialGradient(W / 2, H * .5, Math.min(W, H) * .4, W / 2, H * .5, Math.max(W, H) * .8);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, W, H); }
  };
  /** Best moment for a highlight: the knockdown blow, else the heaviest clean hit. */
  const moment = (events: Replay['events']) => {
    const kd = events.find(e => e.type === 'knockdown');
    if (kd) return kd.tick;
    let best: Replay['events'][number] | null = null;
    for (const e of events) if (e.type === 'hit' && (!best || e.damage > best.damage)) best = e;
    return best ? best.tick : null;
  };

  // ---- audio from committed events -------------------------------------------
  const playAudio = (replay: Replay, fromMs: number, toMs: number) => {
    if (!audio) return;
    const out: SparringEvent[] = [];
    for (const e of replay.events) {
      const t = e.tick * TICK_MS; if (t <= fromMs || t > toMs) continue;
      const base = { id: e.tick * 7 + (e.actor === 'kor' ? 1 : 2), tick: e.tick, actor: e.actor === 'kor' ? 'a' : 'b', target: e.target === 'kor' ? 'a' : 'b', attack: null, point: null, damage: Math.round(e.damage * 1.3), reason: null } as unknown as SparringEvent;
      const heavy = e.technique === 'cross' || e.technique === 'rearHook' || e.technique === 'uppercut' || isV5Kick(e.technique);
      const type = e.type === 'strike' ? (heavy ? 'attack' : null) : e.type === 'hit' ? (e.counter ? 'counter' : 'hit') : e.type === 'block' ? 'block' : e.type === 'knockdown' ? 'knockdown' : e.type === 'finish' ? 'knockout' : null;
      if (type) { out.push({ ...base, type } as SparringEvent); if (type === 'counter') out.push({ ...base, type: 'hit' } as SparringEvent); }
    }
    if (out.length) audio.events(out, Math.floor(toMs / TICK_MS));
  };

  // ---- main loop ------------------------------------------------------------
  const render = (now: number, force = false) => {
    if (!force) raf = requestAnimationFrame(t => render(t));
    if (disposed || (!force && (!visible || document.hidden))) return;
    const state = props(), reduced = state.reducedMotion; TXT = state.labels ?? DEFAULT_BROADCAST_LABELS;
    if (!force && now - last < (reduced ? 1000 / 30 : 1000 / 60) - 2) return;
    const dt = clamp((now - (lastNow || now)) / 1000, 0, .1); lastNow = now; last = now;
    try {
      const real = preview ?? (state.replay?.frames.length ? state.replay : null), replay: Replay = real ?? WARMUP, phase = real ? (seek !== null ? 'fighting' : state.phase) : 'idle';
      const key = `${state.fightId}:${phase}`;
      if (key !== live.key) { live.key = key; live.init = false; live.sim.reset(); }
      const total = Math.max(TICK_MS, (replay.frames.length - 1) * TICK_MS);
      const elapsed = seek !== null ? seek : state.playbackPositionMs !== undefined ? clamp(state.playbackPositionMs, 0, state.durationMs) : state.startedAt !== null && Number.isFinite(state.startedAt) ? Math.max(0, now - state.startedAt) : 0;
      // Partial logs (plans still arriving) never run past their last committed frame.
      const realMs = phase === 'fighting' ? Math.min(elapsed, total) : phase === 'finished' ? total : 0;
      const winner = state.winner ?? (phase === 'finished' ? 'draw' : null);

      // Sound follows real time (never the hit-stop or replay clock).
      if (state.sound && !audio && !audioAbort.signal.aborted && audioKey !== 'loading') { audioKey = 'loading'; loadRingsideAudio(audioAbort.signal).then(a => { if (disposed) { a.dispose(); return; } audio = a; void a.resume().then(() => a.setEnabled(!!props().sound)); }).catch(() => { audioKey = 'failed'; }); }
      if (audio) { audio.setEnabled(!!state.sound); if (state.sound) { const fightKey = `${state.fightId}`; if (phase === 'fighting' && bellKey !== fightKey + ':start') { bellKey = fightKey + ':start'; audio.bell(1); audioMs = realMs; } if (phase === 'finished' && bellKey !== fightKey + ':end') { bellKey = fightKey + ':end'; audio.bell(3); } if (phase === 'fighting') { if (realMs < audioMs) audioMs = realMs; playAudio(replay, audioMs, realMs); audioMs = realMs; } } }

      // Replays: the knockdown blow during the count (half speed), and the round's best moment after the bell.
      let replayWindow: { at: number; from: number; label: string; progress: number } | null = null;
      if (!reduced && phase === 'fighting') {
        const kd = replay.events.find(e => e.type === 'knockdown' && realMs >= e.tick * TICK_MS + 1300);
        if (kd) {
          const t1 = kd.tick * TICK_MS, rise = replay.events.find(e => e.tick > kd.tick && (e.type === 'rise' || e.type === 'finish')), stop = Math.min(t1 + 1300 + 3000, rise ? rise.tick * TICK_MS - 400 : Infinity), from = t1 - 1000;
          if (realMs < stop) replayWindow = { from, at: from + (realMs - t1 - 1300) * .5, label: TXT.replay, progress: (realMs - t1 - 1300) / (stop - t1 - 1300) };
        }
      }
      if (!reduced && phase === 'finished' && state.startedAt !== null && state.playbackPositionMs === undefined) {
        const since = now - state.startedAt - state.durationMs, best = moment(replay.events);
        if (best !== null && since > 1600 && since < 1600 + 4750) { const t1 = best * TICK_MS, from = t1 - 1200; replayWindow = { from, at: from + (since - 1600) * .4, label: TXT.highlight, progress: (since - 1600) / 4750 }; }
      }
      if (replayWindow) {
        const wkey = `${state.fightId}:${replayWindow.from}`;
        if (replayView.key !== wkey) { replayView.key = wkey; replayView.init = false; replayView.sim.reset(); }
        const at = clamp(replayWindow.at, 0, total);
        drawView(replay, at, 'fighting', replayView, now, dt * .5, reduced, null, true);
        grade(0); replayFrame(replayWindow.label, replayWindow.progress);
        finish(state); return;
      }
      const display = reduced || phase !== 'fighting' ? realMs : hitStopTime(replay.events, realMs);
      const { kd, tickF } = drawView(replay, display, phase, live, now, dt, reduced, winner, false);
      const kdEvent = replay.events.filter(e => e.type === 'knockdown' && e.tick <= tickF).at(-1);
      const kdAge = kd && kdEvent ? (tickF - kdEvent.tick) * TICK_MS : 1e9;
      grade(kd && !reduced && kdAge < 200 ? (1 - kdAge / 200) * .3 : 0);
      if (phase === 'idle' && state.selection) pickOverlay(state.selection, now, reduced);
      if (phase === 'fighting' && kd) {
        const refCount = replay.frames[Math.min(replay.frames.length - 1, Math.floor(tickF))]!.referee.count, countEvt = replay.events.filter(e => e.type === 'count' && e.tick * TICK_MS <= display).at(-1);
        if (kdAge < 1300) banner(TXT.knockdown, TXT.knockdownSub(TEAM[kd.fighter === 'kor' ? 'ayaz' : 'kor'].name), TEAM[kd.fighter === 'kor' ? 'ayaz' : 'kor'].color, clamp(1 - Math.max(0, kdAge - 900) / 400));
        else if (refCount > 0 && countEvt) { const age = display - countEvt.tick * TICK_MS; banner(String(refCount), TXT.count, '#e9e4da', clamp(1 - age / 900), .3); }
      }
      const fin = replay.events.find(e => e.type === 'finish' && e.tick * TICK_MS <= display);
      if (phase === 'fighting' && fin) banner(TXT.stoppage, TXT.stoppageSub(TEAM[fin.actor].name), TEAM[fin.actor].color, clamp((display - fin.tick * TICK_MS) / 300));
      const rise = replay.events.filter(e => e.type === 'rise' && e.tick * TICK_MS <= display).at(-1);
      const up = rise ? display - rise.tick * TICK_MS - 650 : -1;
      if (phase === 'fighting' && rise && up >= 0 && up < 1300) banner(TXT.rise, TXT.riseSub, '#e9e4da', clamp(1 - up / 1300), .3);
      finish(state);
    } catch (error) {
      console.error('Ringside 2D broadcast failed', error);
      disposed = true; cancelAnimationFrame(raf); state.onError?.();
    }
  };
  const finish = (state: BroadcastProps) => {
    canvas.style.cursor = state.onSelectFighter && state.selection && state.phase === 'idle' ? 'pointer' : 'default';
    if (!ready) { ready = true; canvas.dataset.renderer = 'canvas2d-sprites'; state.onReady?.(); }
  };
  raf = requestAnimationFrame(t => render(t));
  // Development-only inspection hooks: force a frame, pin the fight clock, or preview a local fallback-plan round.
  if (process.env.NODE_ENV !== 'production') { const h = host as HTMLElement & { ringRender?: (now: number) => void; ringSeek?: (ms: number | null) => void; ringPreview?: (seed: string | null) => void; ringFrames?: () => { loaded: number; total: number; stage: boolean } | null }; h.ringRender = now => render(now, true); h.ringSeek = ms => { seek = ms; }; h.ringPreview = seed => { preview = seed ? simulateContactCombatV5(seed) : null; }; h.ringFrames = () => frames ? { loaded: frames.loaded, total: frames.total, stage: !!tex.stage } : null; }
  return () => {
    disposed = true; audioAbort.abort(); audio?.dispose(); cancelAnimationFrame(raf); cancelPlate(); textures.cancel(); cancelFrames(); ro.disconnect(); io.disconnect();
    canvas.removeEventListener('click', onClick); canvas.remove();
  };
}
