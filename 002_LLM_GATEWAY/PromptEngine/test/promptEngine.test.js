'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parsePrompt,
  buildSystemPrompt,
  detectInstrumental,
  detectNoDrums,
  detectNoBass,
  detectTimeSignature,
} = require('../index.js');

test('parsePrompt extracts genre, mood, tempo, bars, key', () => {
  const spec = parsePrompt('An energetic edm track in A minor at 128 bpm, 16 bars');
  assert.equal(spec.genre, 'edm');
  assert.equal(spec.mood, 'energetic');
  assert.equal(spec.tempo, 128);
  assert.equal(spec.bars, 16);
  assert.equal(spec.key, 'A');
  assert.equal(spec.mode, 'minor');
});

test('parsePrompt falls back to sensible defaults', () => {
  const spec = parsePrompt('something with no obvious keywords');
  assert.equal(spec.genre, 'ambient');
  assert.equal(spec.mood, 'neutral');
  assert.equal(spec.tempo, 100);
  assert.equal(spec.bars, 8);
});

test('parsePrompt rejects empty input', () => {
  assert.throws(() => parsePrompt(''));
});

test('buildSystemPrompt renders a readable instruction', () => {
  const spec = parsePrompt('calm lofi at 70 bpm');
  const prompt = buildSystemPrompt(spec);
  assert.match(prompt, /lofi/);
  assert.match(prompt, /70 BPM/);
});

test('parsePrompt resolves genre aliases onto the real genre buckets', () => {
  assert.equal(parsePrompt('a synthwave night drive').genre, 'edm');
  assert.equal(parsePrompt('orchestral film score for a trailer').genre, 'cinematic');
  assert.equal(parsePrompt('acoustic folk around a campfire').genre, 'classical');
  assert.equal(parsePrompt('hip hop beat with hard drums').genre, 'trap');
});

test('parsePrompt resolves mood aliases', () => {
  assert.equal(parsePrompt('an epic battle theme').mood, 'energetic');
  assert.equal(parsePrompt('a nostalgic piano piece').mood, 'sad');
  assert.equal(parsePrompt('a mysterious dungeon crawl').mood, 'dark');
});

test('detectInstrumental recognizes explicit instrumental requests', () => {
  assert.equal(detectInstrumental('an instrumental jazz track'), true);
  assert.equal(detectInstrumental('lofi beat, no vocals please'), true);
  assert.equal(detectInstrumental('a track without lyrics'), true);
});

test('detectInstrumental recognizes explicit vocal requests', () => {
  assert.equal(detectInstrumental('a pop song with vocals'), false);
  assert.equal(detectInstrumental('something with singing'), false);
});

test('detectInstrumental returns undefined when the text is silent on vocals', () => {
  assert.equal(detectInstrumental('an energetic edm track at 128 bpm'), undefined);
});

test('parsePrompt carries the detected instrumental flag onto the spec', () => {
  assert.equal(parsePrompt('an instrumental ambient piece').instrumental, true);
  assert.equal(parsePrompt('a ballad with vocals').instrumental, false);
  assert.equal(parsePrompt('an ambient piece').instrumental, undefined);
});

test('buildSystemPrompt mentions instrumental when explicitly requested', () => {
  const spec = parsePrompt('an instrumental cinematic piece at 90 bpm');
  assert.match(buildSystemPrompt(spec), /instrumental/i);
});

// Regression test for a real bug: the previous key regex (`/\b([A-G]...)/i`)
// matched a bare leading article "a"/"A" as the key under the
// case-insensitive flag, so "a lofi track in C major" silently came back
// as key A, not C. Anchoring the pattern to "in "/"key of " context fixes it.
test('parsePrompt does not mistake the leading article "a" for the key A', () => {
  assert.equal(parsePrompt('a happy pop song').key, 'C'); // no explicit key -> default
  assert.equal(parsePrompt('a lofi track in C major at 80 bpm, 4 bars').key, 'C');
  assert.equal(parsePrompt('an energetic edm track').key, 'C');
});

test('parsePrompt still extracts an explicit "in <key> <mode>" key correctly', () => {
  assert.equal(parsePrompt('a ballad in A minor at 90 bpm').key, 'A');
  assert.equal(parsePrompt('a ballad in A minor at 90 bpm').mode, 'minor');
  assert.equal(parsePrompt('a cinematic piece in the key of D').key, 'D');
  assert.equal(parsePrompt('a rock track, key of E minor').key, 'E');
});

test('parsePrompt normalizes flat key spellings to their sharp enharmonic equivalent', () => {
  assert.equal(parsePrompt('a jazz tune in Bb minor').key, 'A#');
  assert.equal(parsePrompt('a jazz tune in Bb minor').mode, 'minor');
  assert.equal(parsePrompt('a pop song in Eb major').key, 'D#');
  assert.equal(parsePrompt('a ballad in Db').key, 'C#');
});

test('detectNoDrums / detectNoBass recognize explicit negative instrument requests', () => {
  assert.equal(detectNoDrums('a lofi beat with no drums'), true);
  assert.equal(detectNoDrums('an ambient, drumless piece'), true);
  assert.equal(detectNoDrums('a normal rock track'), undefined);
  assert.equal(detectNoBass('an ambient track without bass'), true);
  assert.equal(detectNoBass('a bassless intro'), true);
  assert.equal(detectNoBass('a normal rock track'), undefined);
});

test('parsePrompt carries noDrums/noBass onto the spec', () => {
  const spec = parsePrompt('a cinematic piece with no drums and no bass');
  assert.equal(spec.noDrums, true);
  assert.equal(spec.noBass, true);
  assert.equal(parsePrompt('a normal rock track').noDrums, undefined);
});

test('detectTimeSignature recognizes 3/4 and the word "waltz", defaults everything else to undefined', () => {
  assert.deepEqual(detectTimeSignature('a piece in 3/4 time'), [3, 4]);
  assert.deepEqual(detectTimeSignature('a slow waltz for piano'), [3, 4]);
  assert.deepEqual(detectTimeSignature('a track in 4/4 time'), [4, 4]);
  assert.equal(detectTimeSignature('a track in 6/8 time'), undefined); // honestly unsupported, not faked
  assert.equal(detectTimeSignature('a normal rock track'), undefined);
});

test('parsePrompt carries the detected time signature onto the spec', () => {
  assert.deepEqual(parsePrompt('a classical waltz at 90 bpm').timeSignature, [3, 4]);
  assert.equal(parsePrompt('a normal rock track').timeSignature, undefined);
});

test('buildSystemPrompt mentions no-drums/no-bass/waltz when present on the spec', () => {
  const spec = { ...parsePrompt('a classical waltz'), noDrums: true, noBass: true };
  const prompt = buildSystemPrompt(spec);
  assert.match(prompt, /no drums/i);
  assert.match(prompt, /no bass/i);
  assert.match(prompt, /3\/4 waltz/i);
});

test('parsePrompt maps rap onto the trap bucket and country/bluegrass onto the country bucket', () => {
  assert.equal(parsePrompt('a hard rap beat at 90 bpm').genre, 'trap');
  assert.equal(parsePrompt('a country ballad about a truck').genre, 'country');
  assert.equal(parsePrompt('a fast bluegrass tune').genre, 'country');
});

test('keyword matching is whole-word, so "rap" inside "wrapped"/"grape" does not hit the trap bucket', () => {
  assert.equal(parsePrompt('a song about wrapped presents').genre, 'ambient'); // default, not trap
  assert.equal(parsePrompt('a song about grape vines').genre, 'ambient');
  assert.equal(parsePrompt('a song about my housewife era').genre, 'ambient'); // not edm via "house"
});

test('multi-word keywords still match after the whole-word fix', () => {
  assert.equal(parsePrompt('a hip hop beat').genre, 'trap');
  assert.equal(parsePrompt('a film score cue for strings').genre, 'cinematic');
  assert.equal(parsePrompt('a lo-fi study beat').genre, 'lofi');
});
