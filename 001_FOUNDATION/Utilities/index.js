'use strict';

let idCounter = 0;

function generateId(prefix = 'id') {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}${idCounter.toString(36)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function midiToFrequency(midiNote) {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function linearToDb(linear) {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(fn, { attempts = 3, delayMs = 50 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  throw lastError;
}

// Deterministic PRNG (mulberry32) so generation is reproducible given a seed.
function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function createLogger(name, { level = 'info' } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const log = (lvl, msg, meta) => {
    if (LEVELS[lvl] < threshold) return;
    const line = `[${new Date().toISOString()}] [${lvl.toUpperCase()}] [${name}] ${msg}`;
    // eslint-disable-next-line no-console
    console[lvl === 'debug' ? 'log' : lvl](line, meta ?? '');
  };
  return {
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
  };
}

module.exports = {
  generateId,
  clamp,
  midiToFrequency,
  dbToLinear,
  linearToDb,
  sleep,
  retry,
  createRng,
  hashStringToSeed,
  createLogger,
};
