/** Isolated research adapter. Never edits or replaces the deployed v3 engine. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { atomicImport } from './atomic-module.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ENGINE_SHA = '0813ec0765c66ca7344a69bb7e971a089ca7486fee51bd523851695c1c41c3c8';
export const FROZEN_POLICY_SHA = '37590c7fb528b14baa232e980fcbf8c9d16daa14aff48d5c59b2034e549e15aa';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const episodeSeed = (partition, id) => sha(`sollish-selfplay-v1:${partition}:${id}`);
function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('ADAPTER_SOURCE_SHAPE_CHANGED');
  return source.replace(from, to);
}
export function adaptSource(source) {
  if (sha(source) !== ENGINE_SHA) throw new Error('FROZEN_ENGINE_HASH_MISMATCH');
  let adapted = replaceOnce(source,
    'initial:ContactInitial=CONTACT_INITIAL):ContactReplay{',
    'initial:ContactInitial=CONTACT_INITIAL,options:{controllers?:[((x:readonly number[])=>CombatAction)|null,((x:readonly number[])=>CombatAction)|null];recordFrames?:boolean;onDecision?:(side:number,tick:number,proposed:CombatAction,effective:CombatAction)=>void}={}):ContactReplay{');
  adapted = replaceOnce(adapted,
    'let next:CombatAction=chooseCombatAction(inputs,a.memory);',
    'let next:CombatAction=options.controllers?.[i]?.(Object.freeze(inputs.slice()))??chooseCombatAction(inputs,a.memory); const proposed=next;');
  adapted = replaceOnce(adapted, 'a.action=next;a.actionAt=tick;',
    'options.onDecision?.(i,tick,proposed,next);a.action=next;a.actionAt=tick;');
  adapted = replaceOnce(adapted, 'frames.push({tick,kor:view(agents[0]),ayaz:view(agents[1]),referee:{...referee}});',
    'if(options.recordFrames!==false||tick===0||tick===COMBAT_V3_DURATION_MS/CONTACT_TICK_MS)frames.push({tick,kor:view(agents[0]),ayaz:view(agents[1]),referee:{...referee}});');
  return adapted;
}
export async function loadEnvironment() {
  const folder = resolve(ROOT, 'packages/protocol/src');
  const source = await readFile(resolve(folder, 'combat-v3.ts'), 'utf8');
  if (sha(await readFile(resolve(folder, 'connectome-policy.ts'))) !== FROZEN_POLICY_SHA) throw new Error('FROZEN_POLICY_HASH_MISMATCH');
  const adapted = adaptSource(source);
  const result = await build({stdin:{contents:adapted,loader:'ts',resolveDir:folder,sourcefile:'isolated-selfplay-v3-adapter.ts'},bundle:true,format:'esm',platform:'node',target:'node24',write:false});
  const code = result.outputFiles[0].contents;
  const path = resolve(ROOT, '.tooling/combat-selfplay', `${sha(code)}.mjs`);
  const module = await atomicImport(path, code);
  return {simulate:module.simulateContactCombat,initial:module.CONTACT_INITIAL,adapterSha256:sha(code),engineSha256:ENGINE_SHA};
}
