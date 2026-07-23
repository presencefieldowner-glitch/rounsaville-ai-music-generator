'use strict';

const { createGenerationSpec } = require('../../001_FOUNDATION/Types');

// Turns free-form user text into a structured GenerationSpec. This stands
// in for an actual LLM call: it's a deterministic, dependency-free parser
// so the rest of the pipeline (and its tests) don't need network access or
// API keys. ModelRouter is the seam where a real LLM/embeddings backend
// would be plugged in later without touching downstream modules.

const GENRE_KEYWORDS = {
  lofi: 'lofi',
  'lo-fi': 'lofi',
  ambient: 'ambient',
  cinematic: 'cinematic',
  edm: 'edm',
  electronic: 'edm',
  jazz: 'jazz',
  rock: 'rock',
  classical: 'classical',
  trap: 'trap',
};

const MOOD_KEYWORDS = {
  happy: 'happy',
  uplifting: 'happy',
  sad: 'sad',
  melancholic: 'sad',
  dark: 'dark',
  ominous: 'dark',
  calm: 'calm',
  relaxing: 'calm',
  energetic: 'energetic',
  intense: 'energetic',
};

const KEY_PATTERN = /\b([A-G](?:#|b)?)\s*(major|minor|maj|min)?\b/i;
const TEMPO_PATTERN = /\b(\d{2,3})\s*(?:bpm)\b/i;
const BARS_PATTERN = /\b(\d{1,3})\s*bars?\b/i;

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

  return { ...spec, sourceText: text };
}

function buildSystemPrompt(spec) {
  return (
    `Compose an ${spec.bars}-bar ${spec.genre} piece in ${spec.key} ${spec.mode} ` +
    `at ${spec.tempo} BPM with a ${spec.mood} mood.`
  );
}

module.exports = { parsePrompt, buildSystemPrompt };
