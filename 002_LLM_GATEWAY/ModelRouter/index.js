'use strict';

const { createLogger } = require('../../001_FOUNDATION/Utilities');

const logger = createLogger('ModelRouter', { level: 'warn' });

// Registry of named "model" backends (sync or async functions taking a
// GenerationSpec and returning a Composition-shaped result). Real LLM/audio
// model integrations register themselves here; callers never depend on a
// specific backend, only on `route()`.

function createModelRouter() {
  const models = new Map();

  function register(name, fn, { priority = 0 } = {}) {
    if (typeof fn !== 'function') throw new TypeError('model handler must be a function');
    models.set(name, { fn, priority });
  }

  function unregister(name) {
    models.delete(name);
  }

  function candidatesFor(spec) {
    return [...models.entries()]
      .filter(([, def]) => !def.filter || def.filter(spec))
      .sort((a, b) => b[1].priority - a[1].priority)
      .map(([name]) => name);
  }

  async function route(spec, { preferred } = {}) {
    if (models.size === 0) throw new Error('ModelRouter has no registered models');

    const order = preferred && models.has(preferred)
      ? [preferred, ...candidatesFor(spec).filter((n) => n !== preferred)]
      : candidatesFor(spec);

    let lastError;
    for (const name of order) {
      try {
        const result = await models.get(name).fn(spec);
        return { modelUsed: name, result };
      } catch (err) {
        lastError = err;
        logger.warn(`model "${name}" failed, trying next`, { error: err.message });
      }
    }
    throw lastError ?? new Error('No model could satisfy the request');
  }

  return { register, unregister, route, candidatesFor };
}

module.exports = { createModelRouter };
