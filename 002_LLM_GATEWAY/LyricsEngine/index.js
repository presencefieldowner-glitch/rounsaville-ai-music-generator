'use strict';

const { createRng, hashStringToSeed } = require('../../001_FOUNDATION/Utilities');

// A real, deterministic, template + rhyme-family lyric generator — not an
// LLM (there's no network access to one here), not GPT-quality writing,
// but a genuine, working, testable generative technique: mad-libs-style
// line templates filled from mood-themed word banks, with true rhymes
// (words drawn from hand-grouped rhyme families, guaranteed to actually
// rhyme by sound) closing alternating lines in an ABCB scheme, which is
// itself a common real song structure.
//
// IMPORTANT: this produces *text* only. There is no text-to-singing-voice
// synthesis anywhere in this codebase — 004_COMPOSITION_AGENT/
// TrackGenerator's "vocal" track is a wordless pitch-range-matched melody,
// not these words being sung. Recording the phrases derived from these
// lyrics only calibrates pitch range (see 003_AUDIO_ENGINE/VoiceProfiler);
// it does not make the output audio pronounce them, and it does not clone
// voice timbre.

const MOOD_WORDS = {
  happy: { nouns: ['sunlight', 'laughter', 'colors', 'morning', 'friend'], adjectives: ['golden', 'bright', 'wild', 'easy'] },
  sad: { nouns: ['silence', 'shadow', 'letter', 'goodbye', 'memory'], adjectives: ['distant', 'quiet', 'broken', 'grey'] },
  dark: { nouns: ['whisper', 'stranger', 'mirror', 'static', 'echo'], adjectives: ['cold', 'hollow', 'restless', 'sharp'] },
  calm: { nouns: ['tide', 'horizon', 'breath', 'stillness', 'river'], adjectives: ['gentle', 'slow', 'soft', 'steady'] },
  energetic: { nouns: ['engine', 'lightning', 'heartbeat', 'crowd', 'wire'], adjectives: ['loud', 'restless', 'electric', 'unstoppable'] },
  neutral: { nouns: ['road', 'window', 'city', 'season', 'clock'], adjectives: ['long', 'familiar', 'ordinary', 'open'] },
};

const FREE_LINES = {
  happy: [
    "We're dancing under a {adjective} sky",
    'Every {noun} feels brand new today',
    "I found my {noun} and I won't let go",
    'This {adjective} feeling keeps me high',
  ],
  sad: [
    "I'm still holding onto the {noun}",
    "Nothing feels the same, it's {adjective} now",
    'I keep replaying every {noun}',
    'The {adjective} silence says it somehow',
  ],
  dark: [
    "There's a {noun} waiting in the dark",
    'I can feel it, {adjective}, closing in',
    'Every {noun} hides a deeper mark',
    "We're standing where the shadows begin",
  ],
  calm: [
    "The world goes {adjective} when you're near",
    'I let the {noun} carry me away',
    'Every {adjective} moment feels like home',
    'Time moves slow on a {noun} day',
  ],
  energetic: [
    "We're running faster than the {noun}",
    "Turn it up, we're never slowing down",
    'Every {noun} burns {adjective} and fast',
    "We're alive in every single sound",
  ],
  neutral: [
    'Somewhere between the {noun} and the door',
    "We keep moving, we don't know why",
    'Another {noun}, {adjective} as before',
    'We just keep on going by',
  ],
};

// Generic enough to close naturally on any rhyme-family noun below
// ("the night" / "the flame" / "the rain" / "the glow" / "the gold" /
// "the heart" all read fine).
const RHYME_LINE_TEMPLATES = [
  'I can still feel the {rhyme}',
  'Nothing left but the {rhyme}',
  'We were chasing the {rhyme}',
  'Caught up in the {rhyme}',
  'Living for the {rhyme}',
  'Holding onto the {rhyme}',
];

// Hand-grouped by actual sound, not spelling, so every pair genuinely
// rhymes: night/light/sight/flight/height/fight, flame/name/game/fame/
// blame, rain/pain/chain/stain, glow/flow/snow, gold/cold/hold,
// heart/start.
const RHYME_FAMILIES = [
  { id: 'night', words: ['night', 'light', 'sight', 'flight', 'height', 'fight'] },
  { id: 'flame', words: ['flame', 'name', 'game', 'fame', 'blame'] },
  { id: 'rain', words: ['rain', 'pain', 'chain', 'stain'] },
  { id: 'glow', words: ['glow', 'flow', 'snow'] },
  { id: 'gold', words: ['gold', 'cold', 'hold'] },
  { id: 'heart', words: ['heart', 'start'] },
];

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function pickTwoDistinct(rng, arr) {
  const first = pick(rng, arr);
  const rest = arr.filter((w) => w !== first);
  const second = rest.length > 0 ? pick(rng, rest) : first;
  return [first, second];
}

function fillFreeLine(rng, template, words) {
  return template
    .replace(/\{noun\}/g, () => pick(rng, words.nouns))
    .replace(/\{adjective\}/g, () => pick(rng, words.adjectives));
}

function fillRhymeLine(rng, rhymeWord) {
  return pick(rng, RHYME_LINE_TEMPLATES).replace('{rhyme}', rhymeWord);
}

// ABCB: lines 1 and 3 are free (thematic), lines 2 and 4 end with two
// different words from the same rhyme family, so they truly rhyme with
// each other.
function makeStanza(rng, moodKey) {
  const words = MOOD_WORDS[moodKey] ?? MOOD_WORDS.neutral;
  const freeLines = FREE_LINES[moodKey] ?? FREE_LINES.neutral;
  const family = pick(rng, RHYME_FAMILIES);
  const [rhymeA, rhymeB] = pickTwoDistinct(rng, family.words);

  return {
    lines: [
      fillFreeLine(rng, pick(rng, freeLines), words),
      fillRhymeLine(rng, rhymeA),
      fillFreeLine(rng, pick(rng, freeLines), words),
      fillRhymeLine(rng, rhymeB),
    ],
    rhymeFamily: family.id,
  };
}

// Song length loosely scales section count with bar count: short pieces
// get verse+chorus, longer ones get verse+chorus+verse+chorus.
function generateLyrics(spec, { seed } = {}) {
  const rng = createRng(seed ?? hashStringToSeed(`lyrics:${JSON.stringify(spec)}`));
  const moodKey = MOOD_WORDS[spec.mood] ? spec.mood : 'neutral';

  const verse = makeStanza(rng, moodKey);
  const chorus = makeStanza(rng, moodKey);
  const sections = [
    { type: 'verse', ...verse },
    { type: 'chorus', ...chorus },
  ];

  if ((spec.bars ?? 8) >= 12) {
    sections.push({ type: 'verse', ...makeStanza(rng, moodKey) });
    sections.push({ type: 'chorus', lines: chorus.lines, rhymeFamily: chorus.rhymeFamily }); // reprise, same text
  }

  return { mood: moodKey, sections, lines: sections.flatMap((s) => s.lines) };
}

// Derives concrete phrases for the voice-recording flow from the actual
// generated lyrics (real lines from *this* song) instead of generic
// filler text — spread across the song's structure so the recordings
// span a bit of vocal variety. Still pitch-range calibration only; see
// the module-level note above.
function deriveRecordingPhrases(lyrics) {
  const verseSection = lyrics.sections.find((s) => s.type === 'verse');
  const chorusSection = lyrics.sections.find((s) => s.type === 'chorus');

  return [
    { id: 'verse-open', label: 'Verse line (comfortable range)', text: verseSection.lines[0] },
    { id: 'verse-close', label: 'Verse line (spoken naturally)', text: verseSection.lines[2] },
    { id: 'chorus-line', label: 'Chorus line (reach a bit higher)', text: chorusSection.lines[1] },
  ];
}

module.exports = {
  MOOD_WORDS,
  FREE_LINES,
  RHYME_FAMILIES,
  generateLyrics,
  deriveRecordingPhrases,
};
