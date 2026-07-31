'use strict';

// Per-session event log (prompts, generation results, edits) so the agent
// can build a context window without re-deriving history from scratch.

function createCompositionMemory({ maxEventsPerSession = 200 } = {}) {
  const store = new Map();

  function appendEvent(sessionId, event) {
    if (!sessionId) throw new TypeError('sessionId is required');
    const events = store.get(sessionId) ?? [];
    const entry = { ...event, at: event.at ?? Date.now() };
    events.push(entry);
    if (events.length > maxEventsPerSession) events.shift();
    store.set(sessionId, events);
    return entry;
  }

  function getHistory(sessionId, limit) {
    const events = store.get(sessionId) ?? [];
    if (!limit) return [...events];
    return events.slice(-limit);
  }

  function clear(sessionId) {
    store.delete(sessionId);
  }

  function lastEventOfType(sessionId, type) {
    const events = store.get(sessionId) ?? [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i].type === type) return events[i];
    }
    return null;
  }

  return { appendEvent, getHistory, clear, lastEventOfType };
}

module.exports = { createCompositionMemory };
