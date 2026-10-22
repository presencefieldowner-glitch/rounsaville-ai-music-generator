'use strict';

const { generateId } = require('../../001_FOUNDATION/Utilities');
const { createSession } = require('../../001_FOUNDATION/Types');

// In-memory session registry. One process's worth of state; a real
// deployment would swap this for Redis/Postgres behind the same interface.

function createSessionManager({ ttlMs = 30 * 60 * 1000 } = {}) {
  const sessions = new Map();

  function create(meta = {}) {
    const session = createSession({ id: generateId('sess'), meta });
    sessions.set(session.id, session);
    return session;
  }

  function get(id) {
    return sessions.get(id) ?? null;
  }

  function update(id, patch) {
    const existing = sessions.get(id);
    if (!existing) throw new Error(`session not found: ${id}`);
    const updated = { ...existing, ...patch, id: existing.id, updatedAt: Date.now() };
    sessions.set(id, updated);
    return updated;
  }

  function remove(id) {
    return sessions.delete(id);
  }

  function list() {
    return [...sessions.values()];
  }

  function pruneExpired(now = Date.now()) {
    let pruned = 0;
    for (const [id, session] of sessions) {
      if (now - session.updatedAt > ttlMs) {
        sessions.delete(id);
        pruned += 1;
      }
    }
    return pruned;
  }

  return { create, get, update, remove, list, pruneExpired };
}

module.exports = { createSessionManager };
