import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONNECTOME_ACTIONS, CONNECTOME_POLICY_INFO, createPolicyState, chooseCombatAction, evaluateCombatPolicy } from '../src/connectome-policy';

const parity = JSON.parse(readFileSync(new URL('../../../experiments/connectome/evidence/policy-mlp-parity.json', import.meta.url), 'utf8')) as {modelSha256:string;steps:{inputs:number[];scores:number[];state:number[];action:string}[]};

test('frozen model matches 20 Python recurrent-state/logit/action reference steps', () => {
  assert.equal(CONNECTOME_POLICY_INFO.modelSha256, parity.modelSha256);
  const state = createPolicyState();
  for (const fixture of parity.steps) {
    const output = evaluateCombatPolicy(fixture.inputs, state);
    assert.equal(output.action, fixture.action);
    for (let i=0;i<128;i++) assert.ok(Math.abs(state[i]-fixture.state[i]) < 1e-10);
    for (let i=0;i<8;i++) assert.ok(Math.abs(output.scores[i]-fixture.scores[i]) < 1e-8);
  }
});

test('independent fighter states reset exactly and do not mutate input observations', () => {
  const a=createPolicyState(), b=createPolicyState(), clean=createPolicyState();
  const inputs=Object.freeze([...parity.steps[0].inputs]);
  assert.equal(chooseCombatAction(inputs,a),chooseCombatAction(inputs,b));
  assert.deepEqual(a,b);
  evaluateCombatPolicy(parity.steps[1].inputs,a);
  assert.notDeepEqual(a,b);
  assert.ok(clean.every(value=>value===0));
  a.fill(0);
  assert.deepEqual(evaluateCombatPolicy(inputs,a),evaluateCombatPolicy(inputs,clean));
  assert.deepEqual(a,clean);
  assert.deepEqual(inputs,parity.steps[0].inputs);
});

test('invalid inputs and state fail before changing recurrent memory', () => {
  const state=createPolicyState();
  chooseCombatAction(parity.steps[0].inputs,state);
  const before=state.slice();
  for(const value of [NaN,Infinity,-Infinity,1.001,-1.001,'0',null]) {
    const inputs=[...parity.steps[0].inputs]; inputs[0]=value as number;
    assert.throws(()=>chooseCombatAction(inputs,state),/POLICY_INPUT_INVALID/);
    assert.deepEqual(state,before);
  }
  for(const inputs of [[],Array(11).fill(0),null]) assert.throws(()=>chooseCombatAction(inputs as number[],state),/POLICY_INPUT_INVALID/);
  assert.throws(()=>chooseCombatAction(Array(10).fill(0),new Float64Array(127)),/POLICY_STATE_INVALID/);
  for(const value of [NaN,Infinity,1.01]) {
    const corrupt=createPolicyState();corrupt[10]=value;const saved=corrupt.slice();
    assert.throws(()=>chooseCombatAction(Array(10).fill(0),corrupt),/POLICY_STATE_INVALID/);
    assert.deepEqual(corrupt,saved);
  }
});

test('bounded extreme and sustained observations stay finite with legal action vocabulary', () => {
  const state=createPolicyState();
  for(let i=0;i<2400;i++) {
    const input=Array.from({length:10},(_,j)=>(i+j)%3-1);
    const output=evaluateCombatPolicy(input,state);
    assert.ok(CONNECTOME_ACTIONS.includes(output.action));
    assert.ok(output.scores.every(Number.isFinite));
    assert.ok(state.every(value=>Number.isFinite(value)&&Math.abs(value)<=1));
  }
  assert.equal(CONNECTOME_POLICY_INFO.wholeBrain,false);
  assert.equal(CONNECTOME_POLICY_INFO.financialReadiness,false);
});
