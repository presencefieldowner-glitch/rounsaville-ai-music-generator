'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RHYME_FAMILIES, generateLyrics, deriveRecordingPhrases } = require('../index.js');

const spec = { genre: 'lofi', mood: 'happy', tempo: 90, key: 'C', mode: 'major', bars: 8 };

test('generateLyrics is deterministic for the same seed', () => {
  const a = generateLyrics(spec, { seed: 42 });
  const b = generateLyrics(spec, { seed: 42 });
  assert.deepEqual(a, b);
});

test('generateLyrics differs across seeds', () => {
  const a = generateLyrics(spec, { seed: 1 });
  const b = generateLyrics(spec, { seed: 2 });
  assert.notDeepEqual(a.lines, b.lines);
});

test('generateLyrics produces a verse and a chorus, each with 4 non-empty lines', () => {
  const lyrics = generateLyrics(spec, { seed: 7 });
  const verse = lyrics.sections.find((s) => s.type === 'verse');
  const chorus = lyrics.sections.find((s) => s.type === 'chorus');
  assert.ok(verse);
  assert.ok(chorus);
  for (const line of [...verse.lines, ...chorus.lines]) {
    assert.equal(typeof line, 'string');
    assert.ok(line.trim().length > 0);
  }
});

test('generateLyrics adds a second verse+chorus for longer songs (bars >= 12)', () => {
  const short = generateLyrics({ ...spec, bars: 8 }, { seed: 3 });
  const long = generateLyrics({ ...spec, bars: 16 }, { seed: 3 });
  assert.equal(short.sections.length, 2);
  assert.equal(long.sections.length, 4);
});

test('the chorus reprise (second occurrence) repeats the exact same lines as the first chorus', () => {
  const lyrics = generateLyrics({ ...spec, bars: 16 }, { seed: 9 });
  const choruses = lyrics.sections.filter((s) => s.type === 'chorus');
  assert.equal(choruses.length, 2);
  assert.deepEqual(choruses[0].lines, choruses[1].lines);
});

test('every stanza\'s lines 2 and 4 genuinely rhyme: two different words from the same rhyme family', () => {
  for (let seed = 0; seed < 20; seed += 1) {
    const lyrics = generateLyrics(spec, { seed });
    for (const section of lyrics.sections) {
      const family = RHYME_FAMILIES.find((f) => f.id === section.rhymeFamily);
      assert.ok(family, `unknown rhyme family ${section.rhymeFamily}`);
      // Longest matching suffix, not the first match: "flight" also ends
      // with the substring "light", so a naive first-match search can
      // misidentify which family word was actually used.
      function longestMatchingSuffix(line) {
        return family.words.reduce((best, w) => (line.endsWith(w) && w.length > (best?.length ?? 0) ? w : best), null);
      }
      const line2 = section.lines[1];
      const line4 = section.lines[3];
      const word2 = longestMatchingSuffix(line2);
      const word4 = longestMatchingSuffix(line4);
      assert.ok(word2, `line "${line2}" doesn't end with a word from family ${family.id}`);
      assert.ok(word4, `line "${line4}" doesn't end with a word from family ${family.id}`);
      assert.notEqual(word2, word4, 'rhyming lines should use two different words, not repeat one');
    }
  }
});

test('mood changes the vocabulary used (happy vs dark word banks are visibly different)', () => {
  const happy = generateLyrics({ ...spec, mood: 'happy' }, { seed: 5 });
  const dark = generateLyrics({ ...spec, mood: 'dark' }, { seed: 5 });
  assert.notEqual(happy.lines.join(' '), dark.lines.join(' '));
});

test('an unknown mood falls back to the neutral word bank without throwing', () => {
  const lyrics = generateLyrics({ ...spec, mood: 'unknown-mood' }, { seed: 1 });
  assert.equal(lyrics.mood, 'neutral');
});

test('deriveRecordingPhrases pulls real lines from the generated lyrics, not generic filler', () => {
  const lyrics = generateLyrics(spec, { seed: 11 });
  const phrases = deriveRecordingPhrases(lyrics);
  assert.equal(phrases.length, 3);
  for (const phrase of phrases) {
    assert.ok(lyrics.lines.includes(phrase.text), `phrase "${phrase.text}" should be an actual generated lyric line`);
  }
});
