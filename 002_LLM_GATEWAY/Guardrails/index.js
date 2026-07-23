'use strict';

const { clamp } = require('../../001_FOUNDATION/Utilities');

const MAX_PROMPT_LENGTH = 2000;
const BANNED_TERMS = ['copyrighted sample', 'stolen stems'];

const ALLOWED_KEYS = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const ALLOWED_MODES = ['major', 'minor'];

function sanitizePrompt(text) {
  if (typeof text !== 'string') throw new TypeError('prompt must be a string');
  const trimmed = text.trim().slice(0, MAX_PROMPT_LENGTH);
  const lower = trimmed.toLowerCase();
  const violations = BANNED_TERMS.filter((term) => lower.includes(term));
  if (violations.length > 0) {
    throw new Error(`prompt violates content policy: ${violations.join(', ')}`);
  }
  return trimmed;
}

function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('spec must be an object');

  const key = ALLOWED_KEYS.includes(spec.key) ? spec.key : 'C';
  const mode = ALLOWED_MODES.includes(spec.mode) ? spec.mode : 'major';

  return {
    ...spec,
    key,
    mode,
    tempo: clamp(Number(spec.tempo) || 100, 40, 220),
    bars: Math.round(clamp(Number(spec.bars) || 8, 1, 64)),
  };
}

module.exports = {
  MAX_PROMPT_LENGTH,
  BANNED_TERMS,
  ALLOWED_KEYS,
  ALLOWED_MODES,
  sanitizePrompt,
  validateSpec,
};
