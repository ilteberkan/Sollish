/** Canvas text of the Ringside broadcast. Presentation only; the component supplies the translated set. */
export type BroadcastLabels = {
  parts: Record<'head' | 'body' | 'guard' | 'leg', string>;
  kicks: Record<'teep' | 'lowKick' | 'bodyKick' | 'headKick' | 'knee', string>;
  counter: string; dodge: string; down: string; floor: string; count: string; replay: string; highlight: string;
  knockdown: string; stoppage: string; rise: string; riseSub: string;
  combo: (hits: number) => string;
  knockdownSub: (name: string) => string;
  stoppageSub: (name: string) => string;
};
export const DEFAULT_BROADCAST_LABELS: BroadcastLabels = {
  parts: { head: 'HEAD', body: 'BODY', guard: 'GUARD', leg: 'LEG' },
  kicks: { teep: 'TEEP', lowKick: 'LOW KICK', bodyKick: 'BODY KICK', headKick: 'HEAD KICK', knee: 'KNEE' },
  counter: 'COUNTER', dodge: 'DODGED', down: 'DOWN', floor: 'RINGSIDE · LIVE', count: 'REFEREE COUNT', replay: 'REPLAY', highlight: 'MOMENT OF THE ROUND',
  knockdown: 'KNOCKDOWN', stoppage: 'STOPPAGE', rise: 'BACK UP', riseSub: 'The fight goes on',
  combo: hits => `${hits}-HIT COMBO`, knockdownSub: name => `${name} put them down`, stoppageSub: name => `${name} wins`,
};

