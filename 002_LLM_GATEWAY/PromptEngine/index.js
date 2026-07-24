'use strict';

const { createGenerationSpec } = require('../../001_FOUNDATION/Types');

// Turns free-form user text into a structured GenerationSpec. This stands
// in for an actual LLM call: it's a deterministic, dependency-free parser
// so the rest of the pipeline (and its tests) don't need network access or
// API keys. ModelRouter is the seam where a real LLM/embeddings backend
// would be plugged in later without touching downstream modules.

// Direct genre names plus common aliases that map onto the same 8 genre
// buckets TrackGenerator actually specializes for (chord progression,
// timbre, reverb space) — so "synthwave"/"house" get the real edm
// treatment rather than silently falling through to a generic default.
const GENRE_KEYWORDS = {
  lofi: 'lofi',
  'lo-fi': 'lofi',
  chill: 'lofi',
  study: 'lofi',
  ambient: 'ambient',
  meditation: 'ambient',
  atmospheric: 'ambient',
  cinematic: 'cinematic',
  orchestral: 'cinematic',
  'film score': 'cinematic',
  soundtrack: 'cinematic',
  edm: 'edm',
  electronic: 'edm',
  synthwave: 'edm',
  house: 'edm',
  techno: 'edm',
  jazz: 'jazz',
  rock: 'rock',
  metal: 'rock',
  punk: 'rock',
  classical: 'classical',
  acoustic: 'classical',
  folk: 'classical',
  trap: 'trap',
  'hip hop': 'trap',
  'hip-hop': 'trap',
  hiphop: 'trap',
};

const MOOD_KEYWORDS = {
  happy: 'happy',
  uplifting: 'happy',
  romantic: 'happy',
  sad: 'sad',
  melancholic: 'sad',
  nostalgic: 'sad',
  dark: 'dark',
  ominous: 'dark',
  mysterious: 'dark',
  calm: 'calm',
  relaxing: 'calm',
  peaceful: 'calm',
  dreamy: 'calm',
  energetic: 'energetic',
  intense: 'energetic',
  aggressive: 'energetic',
  epic: 'energetic',
};

const KEY_PATTERN = /\b([A-G](?:#|b)?)\s*(major|minor|maj|min)?\b/i;
const TEMPO_PATTERN = /\b(\d{2,3})\s*(?:bpm)\b/i;
const BARS_PATTERN = /\b(\d{1,3})\s*bars?\b/i;
const INSTRUMENTAL_PATTERN = /\b(instrumental|no vocals?|no lyrics|without vocals?|without lyrics)\b/i;
const VOCAL_PATTERN = /\b(with vocals?|with lyrics|sung|singing|vocals? included)\b/i;

// Returns true/false when the text explicitly says one way or the other,
// or undefined when it doesn't mention vocals at all (leaving the caller's
// own default, e.g. a UI toggle, in charge).
function detectInstrumental(text) {
  if (INSTRUMENTAL_PATTERN.test(text)) return true;
  if (VOCAL_PATTERN.test(text)) return false;
  return undefined;
}

function findKeyword(text, dictionary) {
  const lower = text.toLowerCase();
  for (const [keyword, value] of Object.entries(dictionary)) {
    if (lower.includes(keyword)) return value;
  }
  return undefined;
}

function parsePrompt(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new TypeError('parsePrompt requires non-empty text');
  }

  const genre = findKeyword(text, GENRE_KEYWORDS) ?? 'ambient';
  const mood = findKeyword(text, MOOD_KEYWORDS) ?? 'neutral';

  const tempoMatch = text.match(TEMPO_PATTERN);
  const barsMatch = text.match(BARS_PATTERN);
  const keyMatch = text.match(KEY_PATTERN);

  const mode = keyMatch && /min/i.test(keyMatch[2] || '') ? 'minor' : 'major';
  const key = keyMatch ? keyMatch[1].toUpperCase() : 'C';

  const spec = createGenerationSpec({
    genre,
    mood,
    tempo: tempoMatch ? Number(tempoMatch[1]) : 100,
    key,
    mode,
    bars: barsMatch ? Number(barsMatch[1]) : 8,
  });

  return { ...spec, sourceText: text, instrumental: detectInstrumental(text) };
}

function buildSystemPrompt(spec) {
  const vocalClause = spec.instrumental === true ? ', instrumental (no vocals)' : '';
  return (
    `Compose an ${spec.bars}-bar ${spec.genre} piece in ${spec.key} ${spec.mode} ` +
    `at ${spec.tempo} BPM with a ${spec.mood} mood${vocalClause}.`
  );
}

module.exports = { parsePrompt, buildSystemPrompt, detectInstrumental };
