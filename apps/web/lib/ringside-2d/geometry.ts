/**
 * Ringside 2D geometry: the fixed side camera. Presentation only.
 *
 * Screen x follows the engine's x axis (the ring's long axis, KOR on the left at the start). The engine depth z is a 2.5D
 * lane: it moves a fighter a little up (far, z < 0) or down (near, z > 0) the screen and scales him by a few percent.
 * The camera never rotates; it only pans and zooms to keep both fighters framed.
 */
import type { FighterId } from '@sollish/protocol';

/** Ring geometry in mm, as the engine and the 2.5D arena use it (the corner posts at +-POST on both axes). */
export const POST = 3650, APRON = 4250;
/** Three ropes (white, red, blue from the top), as in the stage image: heights above the canvas in mm. */
export const ROPES_MM = [842, 544, 245] as const, POST_TOP_MM = 1150;
/** Screen lane: vertical pixels per engine mm of depth, as a share of the horizontal scale; and the near/far size change per metre. */
export const LANE = .15, DEPTH_SCALE = .025, APRON_MM = 400;
/** The stage image (public/sprites/ringside2d/stage.webp): where the ring's centre and the z = 0 feet line sit in it (fractions) and how many mm its full width spans at the feet line. Retune here if the art changes. */
export const STAGE = { cx: .505, feetY: .79, widthMm: 7906, halfMm: 3950 };
/** Nominal body height (mm) the frames are scaled to (guard pose), by character. */
export const HEIGHT_MM = { kor: 1750, ayaz: 1860, referee: 1790 } as const;

export type Facing = 1 | -1;
/**
 * Which way a fighter faces on screen: toward the other fighter. When the two are almost on top of each other (clinch,
 * crossing over) the previous side is kept; with no history the engine's own heading decides.
 */
export function facing(self: { x: number; yawMilliRad: number }, other: { x: number }, previous: Facing | null, dead = 120): Facing {
  const dx = other.x - self.x;
  if (dx > dead) return 1;
  if (dx < -dead) return -1;
  if (previous) return previous;
  const s = Math.sin(self.yawMilliRad / 1000);
  return s >= 0 ? 1 : -1;
}
/** Referee faces the fight. */
export function refereeFacing(ref: { x: number }, mid: number, previous: Facing | null): Facing {
  return facing({ x: ref.x, yawMilliRad: 0 }, { x: mid }, previous, 250);
}

export type Cam = { panMm: number; scale: number; W: number; H: number; groundY: number; shakeX: number; shakeY: number };
/** Screen position of an engine point on the floor (x, z in mm). */
export const floorX = (cam: Cam, x: number, z = 0) => cam.W / 2 + (x - cam.panMm) * cam.scale * depthK(z) + cam.shakeX;
export const floorY = (cam: Cam, z: number) => cam.groundY + z * cam.scale * LANE + cam.shakeY;
/** Size factor of something standing at depth z (near is larger). */
export const depthK = (z: number) => 1 + z / 1000 * DEPTH_SCALE;

/** The picture needs, from the feet line: the tallest pose above (a victory pose with raised arms, 2050 mm) and the ring's near edge below. */
const ABOVE_MM = 2050, BELOW_MM = POST * LANE * 1.15, TOP_INSET = .19, BOTTOM_INSET = .02;
/** Pixels per mm for a viewport: the fight needs `visibleMm` of width, and a fighter must fit under the HUD cards (the top 19%). */
export function fitScale(W: number, H: number, visibleMm: number) {
  return Math.min(W / visibleMm, H * (1 - TOP_INSET - BOTTOM_INSET) / (ABOVE_MM + BELOW_MM));
}
/** Feet line (screen y at z = 0): the fighters stand under the HUD, centred in the free height when the width limits the zoom. */
export const groundLine = (H: number, scale: number) => {
  const avail = H * (1 - TOP_INSET - BOTTOM_INSET), spare = Math.max(0, avail - (ABOVE_MM + BELOW_MM) * scale);
  return H * TOP_INSET + spare * .5 + ABOVE_MM * scale;
};
/** Visible width (mm) that frames both fighters (and the referee while a count or a break is on) with margin. */
export function framing(xs: number[], panLimit = APRON + 400) {
  const lo = Math.min(...xs), hi = Math.max(...xs), spread = hi - lo;
  const visible = Math.max(4200, Math.min(7600, spread + 3000));
  const pan = (lo + hi) / 2;
  const limit = Math.max(0, panLimit - visible / 2);
  return { pan: Math.max(-limit, Math.min(limit, pan)), visible };
}
/** Critically damped follow (frame-rate independent). */
export const damp = (cur: number, target: number, rate: number, dt: number) => target + (cur - target) * Math.exp(-rate * dt);

export const opponent = (id: FighterId): FighterId => id === 'kor' ? 'ayaz' : 'kor';
