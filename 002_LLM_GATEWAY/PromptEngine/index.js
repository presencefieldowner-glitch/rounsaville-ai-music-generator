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

// Requires an explicit "in <key>" / "key of <key>" context rather than a
// bare letter anywhere in the text. The earlier bare-letter version of
// this pattern (`/\b([A-G](?:#|b)?)\s*(major|minor)?\b/i`) matched the
// leading article "a"/"A" in ordinary prose — "a lofi track in C major"
// was silently parsed as key A, not C, because "a" (the very first word)
// satisfied `[A-G]` under the case-insensitive flag before the regex ever
// reached "C major". Anchoring to "in "/"key of " fixes the overwhelming
// majority of real prompts; it can still misfire on incidental phrases
// like "walking in a park" (no known fix without real NLP), which is why
// GenerationPipeline/TrackGenerator treat the resulting key as a
// best-effort hint, not ground truth.
const KEY_PATTERN = /\b(?:in\s+(?:the\s+key\s+of\s+)?|key\s+of\s+)([A-G])(#|b)?\s*(major|minor|maj|min)?\b/i;
const TEMPO_PATTERN = /\b(\d{2,3})\s*(?:bpm)\b/i;
const BARS_PATTERN = /\b(\d{1,3})\s*bars?\b/i;
const INSTRUMENTAL_PATTERN = /\b(instrumental|no vocals?|no lyrics|without vocals?|without lyrics)\b/i;
const VOCAL_PATTERN = /\b(with vocals?|with lyrics|sung|singing|vocals? included)\b/i;
const NO_DRUMS_PATTERN = /\b(no drums?|no percussion|without drums?|without percussion|drumless)\b/i;
const NO_BASS_PATTERN = /\b(no bass(?:line)?|without bass(?:line)?|bassless)\b/i;
// "3/4" is the unambiguous form; "waltz" is a real, common enough genre
// descriptor that implies 3/4 time on its own. Anything else (including
// unrecognized signatures like "6/8") falls back to the 4/4 default rather
// than silently claiming to support a feel this generator doesn't actually
// produce differently.
const WALTZ_PATTERN = /\b(3\s*\/\s*4|waltz)\b/i;
const FOUR_FOUR_PATTERN = /\b4\s*\/\s*4\b/i;

// Enharmonic normalization: TrackGenerator/Guardrails only recognize sharp
// spellings (ALLOWED_KEYS has no flats), so "Bb minor" would otherwise
// silently fall back to the default key instead of resolving to its real
// pitch class.
const FLAT_TO_SHARP = { Ab: 'G#', Bb: 'A#', Cb: 'B', Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#' };

// Returns true/false when the text explicitly says one way or the other,
// or undefined when it doesn't mention vocals at all (leaving the caller's
// own default, e.g. a UI toggle, in charge).
function detectInstrumental(text) {
  if (INSTRUMENTAL_PATTERN.test(text)) return true;
  if (VOCAL_PATTERN.test(text)) return false;
  return undefined;
}

// Same true/undefined-only convention as detectInstrumental: an explicit
// "no drums"/"no bass" in the prompt sets true; otherwise undefined leaves
// the caller (a UI toggle, or just the default of including the track) in
// charge, rather than this function asserting a false the text never said.
function detectNoDrums(text) {
  return NO_DRUMS_PATTERN.test(text) ? true : undefined;
}

function detectNoBass(text) {
  return NO_BASS_PATTERN.test(text) ? true : undefined;
}

// [3, 4] / [4, 4] only, both real, both distinctly handled downstream by
// TrackGenerator (see its beatsPerBar-driven rhythm grid and the separate
// waltz drum pattern) — not a lookup table pretending to support meters
// nothing actually plays differently for.
function detectTimeSignature(text) {
  if (WALTZ_PATTERN.test(text)) return [3, 4];
  if (FOUR_FOUR_PATTERN.test(text)) return [4, 4];
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

  const mode = keyMatch && /min/i.test(keyMatch[3] || '') ? 'minor' : 'major';
  let key = 'C';
  if (keyMatch) {
    const letter = keyMatch[1].toUpperCase();
    const accidental = keyMatch[2] || '';
    key = accidental.toLowerCase() === 'b' ? FLAT_TO_SHARP[letter + 'b'] ?? letter : letter + accidental;
  }

  const spec = createGenerationSpec({
    genre,
    mood,
    tempo: tempoMatch ? Number(tempoMatch[1]) : 100,
    key,
    mode,
    bars: barsMatch ? Number(barsMatch[1]) : 8,
  });

  return {
    ...spec,
    sourceText: text,
    instrumental: detectInstrumental(text),
    noDrums: detectNoDrums(text),
    noBass: detectNoBass(text),
    timeSignature: detectTimeSignature(text),
  };
}

function buildSystemPrompt(spec) {
  const vocalClause = spec.instrumental === true ? ', instrumental (no vocals)' : '';
  const drumsClause = spec.noDrums === true ? ', no drums' : '';
  const bassClause = spec.noBass === true ? ', no bass' : '';
  const [beatsPerBar] = spec.timeSignature ?? [4, 4];
  const timeClause = beatsPerBar === 3 ? ', in 3/4 waltz time' : '';
  return (
    `Compose an ${spec.bars}-bar ${spec.genre} piece in ${spec.key} ${spec.mode} ` +
    `at ${spec.tempo} BPM with a ${spec.mood} mood${vocalClause}${drumsClause}${bassClause}${timeClause}.`
  );
}

module.exports = {
  parsePrompt,
  buildSystemPrompt,
  detectInstrumental,
  detectNoDrums,
  detectNoBass,
  detectTimeSignature,
};
