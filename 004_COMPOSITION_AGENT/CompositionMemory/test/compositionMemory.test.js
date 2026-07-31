'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCompositionMemory } = require('../index.js');

test('appendEvent + getHistory returns events in order', () => {
  const memory = createCompositionMemory();
  memory.appendEvent('s1', { type: 'prompt', text: 'a' });
  memory.appendEvent('s1', { type: 'prompt', text: 'b' });
  const history = memory.getHistory('s1');
  assert.equal(history.length, 2);
  assert.equal(history[1].text, 'b');
});

test('getHistory respects a limit as a sliding window', () => {
  const memory = createCompositionMemory();
  for (let i = 0; i < 5; i += 1) memory.appendEvent('s1', { type: 'prompt', i });
  const recent = memory.getHistory('s1', 2);
  assert.deepEqual(recent.map((e) => e.i), [3, 4]);
});

test('memory is capped per-session', () => {
  const memory = createCompositionMemory({ maxEventsPerSession: 3 });
  for (let i = 0; i < 10; i += 1) memory.appendEvent('s1', { type: 'prompt', i });
  const history = memory.getHistory('s1');
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((e) => e.i), [7, 8, 9]);
});

test('clear removes a session history', () => {
  const memory = createCompositionMemory();
  memory.appendEvent('s1', { type: 'prompt' });
  memory.clear('s1');
  assert.deepEqual(memory.getHistory('s1'), []);
});

test('lastEventOfType finds the most recent matching event', () => {
  const memory = createCompositionMemory();
  memory.appendEvent('s1', { type: 'prompt', text: 'a' });
  memory.appendEvent('s1', { type: 'result', value: 1 });
  memory.appendEvent('s1', { type: 'prompt', text: 'b' });
  const last = memory.lastEventOfType('s1', 'prompt');
  assert.equal(last.text, 'b');
});
