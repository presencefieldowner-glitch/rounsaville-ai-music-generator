'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateId,
  clamp,
  midiToFrequency,
  dbToLinear,
  linearToDb,
  retry,
  createRng,
  hashStringToSeed,
} = require('../index.js');

test('generateId produces unique, prefixed ids', () => {
  const a = generateId('sess');
  const b = generateId('sess');
  assert.notEqual(a, b);
  assert.match(a, /^sess_/);
});

test('clamp bounds a value', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
});

test('midiToFrequency matches known reference pitches', () => {
  assert.ok(Math.abs(midiToFrequency(69) - 440) < 1e-9);
  assert.ok(Math.abs(midiToFrequency(60) - 261.6255653) < 1e-3);
});

test('dbToLinear/linearToDb round-trip', () => {
  const linear = dbToLinear(-6);
  assert.ok(Math.abs(linearToDb(linear) - -6) < 1e-9);
});

test('retry succeeds after transient failures', async () => {
  let calls = 0;
  const result = await retry(async () => {
    calls += 1;
    if (calls < 3) throw new Error('transient');
    return 'ok';
  }, { attempts: 5, delayMs: 1 });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('createRng is deterministic for a given seed', () => {
  const seed = hashStringToSeed('same-seed');
  const rngA = createRng(seed);
  const rngB = createRng(seed);
  const seqA = [rngA(), rngA(), rngA()];
  const seqB = [rngB(), rngB(), rngB()];
  assert.deepEqual(seqA, seqB);
  for (const value of seqA) {
    assert.ok(value >= 0 && value < 1);
  }
});
