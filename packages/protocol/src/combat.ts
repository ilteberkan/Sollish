/** Ringside research baseline: deterministic kinematic combat, NOT a connectome or trained policy.
 * No balances, tickets, odds, identities, clocks or provider calls enter this simulation.
 * All settlement state uses integer millimetres / 50 ms ticks. Rendering is non-authoritative.
 */
export const COMBAT_VERSION = 'ringside-kinematic-1' as const;
export const COMBAT_TICK_MS = 50;
export const COMBAT_DURATION_MS = 60_000;
export type FighterId = 'kor' | 'ayaz';
export type CombatAction = 'guard' | 'advance' | 'retreat' | 'circle' | 'slip' | 'jab' | 'cross' | 'hook' | 'kick' | 'down';
export type CombatFighter = { id: FighterId; x: number; z: number; health: number; stamina: number; action: CombatAction; actionAt: number; until: number; hits: number; knockdowns: number };
export type CombatFrame = { tick: number; kor: CombatFighter; ayaz: CombatFighter };
export type CombatEvent = { tick: number; type: 'strike' | 'hit' | 'dodge' | 'block' | 'miss' | 'knockdown' | 'recovery' | 'finish'; actor: FighterId; target: FighterId; technique: CombatAction; damage: number };
export type CombatReplay = { version: typeof COMBAT_VERSION; seed: string; frames: CombatFrame[]; events: CombatEvent[]; winner: FighterId | 'draw'; firstHit: FighterId | 'simultaneous' | 'none'; knockdown: 'yes' | 'no'; finish: 'stoppage' | 'decision' };
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const attacks = ['jab', 'cross', 'hook', 'kick'] as const;
const stats = { jab: [5, 9, 1200, 65, 75], cross: [8, 15, 1250, 115, 130], hook: [9, 16, 1000, 135, 145], kick: [12, 21, 1750, 165, 180] } as const;
type Agent = CombatFighter & { landed: boolean; seen: number[]; rng: () => number };
function random(seed: string, side: number) {
  // Independent, equally distributed streams per fighter. Not cryptographic: the seed source is.
  let a = (parseInt(seed.slice(side * 16, side * 16 + 8), 16) ^ parseInt(seed.slice(side * 16 + 8, side * 16 + 16), 16)) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return (t ^ t >>> 14) >>> 0; };
}
const view = (a: Agent): CombatFighter => ({ id: a.id, x: a.x, z: a.z, health: a.health, stamina: a.stamina, action: a.action, actionAt: a.actionAt, until: a.until, hits: a.hits, knockdowns: a.knockdowns });
const distance = (a: CombatFighter, b: CombatFighter) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const attacking = (a: CombatAction): a is keyof typeof stats => Object.hasOwn(stats, a);
export function simulateCombat(seed: string): CombatReplay {
  if (!/^[0-9a-f]{64}$/.test(seed)) throw new TypeError('Expected a 32-byte lowercase seed');
  const create = (id: FighterId, index: number): Agent => ({ id, x: index ? 1300 : -1300, z: 0, health: 1000, stamina: 1000, action: 'guard', actionAt: 0, until: 10, hits: 0, knockdowns: 0, landed: false, seen: [0,0,0,0], rng: random(seed, index) });
  const a = create('kor', 0), b = create('ayaz', 1), agents = [a,b];
  const frames: CombatFrame[] = [], events: CombatEvent[] = [];
  let winner: CombatReplay['winner'] = 'draw', finish: CombatReplay['finish'] = 'decision', stopped = false;
  const event = (tick: number, type: CombatEvent['type'], actor: Agent, target: Agent, damage = 0) => events.push({ tick, type, actor: actor.id, target: target.id, technique: actor.action, damage });
  const action = (actor: Agent, value: CombatAction, tick: number, length: number) => { actor.action = value; actor.actionAt = tick; actor.until = tick + length; actor.landed = false; };
  for (let tick = 0; tick <= COMBAT_DURATION_MS / COMBAT_TICK_MS; tick++) {
    if (!stopped) {
      // Decisions see the same pre-tick state, rather than privileged access to the other new action.
      const observations = agents.map(view);
      for (let i = 0; i < 2; i++) {
        const self = agents[i], other = observations[1-i];
        self.stamina = Math.min(1000, self.stamina + (attacking(self.action) ? 1 : 5));
        if (tick < self.until) continue;
        if (self.action === 'down') { self.health = 500; event(tick, 'recovery', self, agents[1-i]); }
        const gap = distance(self, other), roll = self.rng() % 100;
        const observedAttack = attacks.indexOf(other.action as typeof attacks[number]);
        if (observedAttack >= 0 && tick - other.actionAt < stats[attacks[observedAttack]][0]) {
          self.seen[observedAttack]++;
          // Bounded within-match adaptation to observed attacks, not learned neural weights.
          const evade = Math.min(70, 32 + self.seen[observedAttack] * 3);
          if (roll < evade && self.stamina >= 70) { self.stamina -= 70; action(self, 'slip', tick, 9); continue; }
          if (roll < 85) { action(self, 'guard', tick, 8); continue; }
        }
        if (self.stamina < 200 || (self.health < 260 && roll < 65)) action(self, 'retreat', tick, 12);
        else if (gap > 1450) action(self, 'advance', tick, 10);
        else if (roll < 16) action(self, 'circle', tick, 12);
        else if (roll < 25) action(self, 'guard', tick, 8);
        else {
          const attack = attacks[self.rng() % attacks.length], spec = stats[attack];
          if (self.stamina < spec[4]) action(self, 'guard', tick, 10);
          else { self.stamina -= spec[4]; action(self, attack, tick, spec[1]); event(tick, 'strike', self, agents[1-i]); }
        }
      }
      const beforeMove = agents.map(view);
      for (let i = 0; i < 2; i++) {
        const self = agents[i], other = beforeMove[1-i]; const dx = Math.sign(other.x-self.x), dz = Math.sign(other.z-self.z);
        if (self.action === 'advance' && distance(self, other) > 1050) { self.x += dx * 48; self.z += dz * 36; }
        if (self.action === 'retreat') { self.x -= dx * 50; self.z -= dz * 30; }
        if (self.action === 'circle' || self.action === 'slip') { const direction = (self.actionAt % 2) ? 1 : -1; self.x -= dz * 22 * direction; self.z += dx * 35 * direction; }
        self.x = clamp(self.x,-3300,3300); self.z = clamp(self.z,-2300,2300);
      }
      // Contacts are resolved simultaneously; neither side receives first-mover damage priority.
      const damage = [0,0];
      for (let i = 0; i < 2; i++) {
        const self = agents[i], other = agents[1-i];
        if (!attacking(self.action) || self.landed || tick-self.actionAt !== stats[self.action][0]) continue;
        self.landed = true; const spec = stats[self.action];
        if (other.action === 'down' || distance(self, other) > spec[2]) { event(tick,'miss',self,other); continue; }
        if (other.action === 'slip') { event(tick,'dodge',self,other); continue; }
        if (other.action === 'guard') { damage[1-i] += Math.floor(spec[3]/5); event(tick,'block',self,other,Math.floor(spec[3]/5)); continue; }
        damage[1-i] += spec[3]; self.hits++; event(tick,'hit',self,other,spec[3]);
      }
      for (let i = 0; i < 2; i++) {
        const self = agents[i]; self.health = Math.max(0,self.health-damage[i]);
        if (self.health === 0 && self.action !== 'down') { self.knockdowns++; event(tick,'knockdown',agents[1-i],self); action(self,'down',tick,80); }
      }
      if (agents.some(f => f.knockdowns >= 2)) {
        stopped = true; finish = 'stoppage'; winner = a.knockdowns >= 2 && b.knockdowns >= 2 ? 'draw' : a.knockdowns >= 2 ? 'ayaz' : 'kor';
        event(tick,'finish',winner === 'ayaz' ? b : a,winner === 'ayaz' ? a : b);
      }
    }
    frames.push({ tick, kor:view(a), ayaz:view(b) });
  }
  if (!stopped) { const scoreA = a.hits * 10 - a.knockdowns * 30, scoreB = b.hits * 10 - b.knockdowns * 30; winner = scoreA === scoreB ? 'draw' : scoreA > scoreB ? 'kor' : 'ayaz'; }
  const first = events.find(e=>e.type==='hit');
  const firstHit = !first ? 'none' : events.filter(e=>e.type==='hit'&&e.tick===first.tick).length > 1 ? 'simultaneous' : first.actor;
  return { version:COMBAT_VERSION,seed,frames,events,winner,firstHit,knockdown:events.some(e=>e.type==='knockdown')?'yes':'no',finish };
}
export function combatFrameAt(replay: CombatReplay, elapsedMs: number): CombatFrame {
  const tick = Math.floor(clamp(Number.isFinite(elapsedMs) ? elapsedMs : 0,0,COMBAT_DURATION_MS)/COMBAT_TICK_MS);
  return replay.frames[tick];
}
