'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionManager } = require('../index.js');

test('create returns a session with a generated id', () => {
  const manager = createSessionManager();
  const session = manager.create({ userAgent: 'test' });
  assert.match(session.id, /^sess_/);
  assert.equal(manager.get(session.id).id, session.id);
});

test('update merges fields and bumps updatedAt', async () => {
  const manager = createSessionManager();
  const session = manager.create();
  await new Promise((r) => setTimeout(r, 5));
  const updated = manager.update(session.id, { meta: { title: 'new' } });
  assert.equal(updated.meta.title, 'new');
  assert.ok(updated.updatedAt >= session.updatedAt);
});

test('update throws for an unknown session', () => {
  const manager = createSessionManager();
  assert.throws(() => manager.update('nope', {}));
});

test('remove deletes a session', () => {
  const manager = createSessionManager();
  const session = manager.create();
  assert.equal(manager.remove(session.id), true);
  assert.equal(manager.get(session.id), null);
});

test('pruneExpired removes sessions past the ttl', () => {
  const manager = createSessionManager({ ttlMs: 10 });
  const session = manager.create();
  const future = session.updatedAt + 1000;
  const pruned = manager.pruneExpired(future);
  assert.equal(pruned, 1);
  assert.equal(manager.get(session.id), null);
});
