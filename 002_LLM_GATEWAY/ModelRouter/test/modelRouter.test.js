'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelRouter } = require('../index.js');

test('route dispatches to the highest priority model', async () => {
  const router = createModelRouter();
  router.register('low', async () => 'low-result', { priority: 0 });
  router.register('high', async () => 'high-result', { priority: 10 });
  const { modelUsed, result } = await router.route({ genre: 'ambient' });
  assert.equal(modelUsed, 'high');
  assert.equal(result, 'high-result');
});

test('route falls back to the next model on failure', async () => {
  const router = createModelRouter();
  router.register('flaky', async () => {
    throw new Error('boom');
  }, { priority: 10 });
  router.register('stable', async () => 'stable-result', { priority: 5 });
  const { modelUsed } = await router.route({ genre: 'ambient' });
  assert.equal(modelUsed, 'stable');
});

test('route throws when every model fails', async () => {
  const router = createModelRouter();
  router.register('a', async () => {
    throw new Error('a failed');
  });
  await assert.rejects(() => router.route({}));
});

test('route respects a preferred model when registered', async () => {
  const router = createModelRouter();
  router.register('a', async () => 'a-result', { priority: 10 });
  router.register('b', async () => 'b-result', { priority: 1 });
  const { modelUsed } = await router.route({}, { preferred: 'b' });
  assert.equal(modelUsed, 'b');
});
