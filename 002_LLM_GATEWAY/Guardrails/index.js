'use strict';

const { clamp } = require('../../001_FOUNDATION/Utilities');

const MAX_PROMPT_LENGTH = 2000;
const BANNED_TERMS = ['copyrighted sample', 'stolen stems'];

const ALLOWED_KEYS = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const ALLOWED_MODES = ['major', 'minor'];

const MIN_VOICE_HZ = 50;
const MAX_VOICE_HZ = 1000;

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

// Client-submitted voice profiles (from the Voice Profile recording flow)
// are re-validated server-side rather than trusted as-is: pitches are
// clamped to a plausible human vocal range and malformed input is
// rejected outright.
function validateVoiceProfile(voiceProfile) {
  if (voiceProfile == null) return undefined;
  if (typeof voiceProfile !== 'object') throw new TypeError('voiceProfile must be an object');

  const minPitchHz = clamp(Number(voiceProfile.minPitchHz), MIN_VOICE_HZ, MAX_VOICE_HZ);
  const maxPitchHz = clamp(Number(voiceProfile.maxPitchHz), MIN_VOICE_HZ, MAX_VOICE_HZ);
  if (!Number.isFinite(minPitchHz) || !Number.isFinite(maxPitchHz)) {
    throw new TypeError('voiceProfile.minPitchHz/maxPitchHz must be finite numbers');
  }

  const averagePitchHz = Number.isFinite(Number(voiceProfile.averagePitchHz))
    ? clamp(Number(voiceProfile.averagePitchHz), MIN_VOICE_HZ, MAX_VOICE_HZ)
    : (minPitchHz + maxPitchHz) / 2;

  return {
    averagePitchHz,
    minPitchHz: Math.min(minPitchHz, maxPitchHz),
    maxPitchHz: Math.max(minPitchHz, maxPitchHz),
    brightness: Number.isFinite(Number(voiceProfile.brightness)) ? Number(voiceProfile.brightness) : 0,
  };
}

function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('spec must be an object');

  const key = ALLOWED_KEYS.includes(spec.key) ? spec.key : 'C';
  const mode = ALLOWED_MODES.includes(spec.mode) ? spec.mode : 'major';
  const instrumental = typeof spec.instrumental === 'boolean' ? spec.instrumental : undefined;

  return {
    ...spec,
    key,
    mode,
    tempo: clamp(Number(spec.tempo) || 100, 40, 220),
    bars: Math.round(clamp(Number(spec.bars) || 8, 1, 64)),
    instrumental,
    voiceProfile: validateVoiceProfile(spec.voiceProfile),
  };
}

module.exports = {
  MAX_PROMPT_LENGTH,
  BANNED_TERMS,
  ALLOWED_KEYS,
  ALLOWED_MODES,
  MIN_VOICE_HZ,
  MAX_VOICE_HZ,
  sanitizePrompt,
  validateSpec,
  validateVoiceProfile,
};
