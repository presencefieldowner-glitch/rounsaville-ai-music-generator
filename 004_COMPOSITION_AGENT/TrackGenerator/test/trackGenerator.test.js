'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidComposition } = require('../../../001_FOUNDATION/Types');
const {
  keyToMidiRoot,
  scaleDegreeToPitch,
  pitchHzToMidi,
  clampPitchToRange,
  generateComposition,
} = require('../index.js');

const spec = { genre: 'lofi', mood: 'calm', tempo: 90, key: 'C', mode: 'major', bars: 4 };

test('keyToMidiRoot maps C at octave 4 to MIDI 60', () => {
  assert.equal(keyToMidiRoot('C', 4), 60);
});

test('scaleDegreeToPitch stays within the major scale and wraps octaves', () => {
  assert.equal(scaleDegreeToPitch(60, 0, 'major'), 60);
  assert.equal(scaleDegreeToPitch(60, 7, 'major'), 72); // one octave up
});

test('generateComposition produces a valid Composition', () => {
  const composition = generateComposition(spec, { seed: 42 });
  assert.ok(isValidComposition(composition));
  assert.equal(composition.tracks.length, 3);
  assert.ok(composition.tracks.every((t) => t.notes.length > 0));
});

test('generateComposition is deterministic for the same seed', () => {
  const a = generateComposition(spec, { seed: 7 });
  const b = generateComposition(spec, { seed: 7 });
  assert.deepEqual(a, b);
});

test('generateComposition differs across seeds', () => {
  const a = generateComposition(spec, { seed: 1 });
  const b = generateComposition(spec, { seed: 2 });
  assert.notDeepEqual(a.tracks[0].notes, b.tracks[0].notes);
});

test('generateComposition respects the requested bar count via drum step count', () => {
  const composition = generateComposition({ ...spec, bars: 2 }, { seed: 5 });
  const kicks = composition.tracks
    .find((t) => t.name === 'drums')
    .notes.filter((n) => n.pitch === 36);
  assert.equal(kicks.length, 2 * 2); // 2 kicks per bar (steps 0 and 4 of 8)
});

test('pitchHzToMidi matches known reference pitches', () => {
  assert.ok(Math.abs(pitchHzToMidi(440) - 69) < 1e-9);
  assert.ok(Math.abs(pitchHzToMidi(261.6255653) - 60) < 1e-3);
});

test('clampPitchToRange octave-shifts a pitch into range', () => {
  assert.equal(clampPitchToRange(40, 55, 70), 64); // 40 -> +12 -> +12 -> 64
  assert.equal(clampPitchToRange(90, 55, 70), 66); // 90 -> -12 -> -12 -> 66
  assert.equal(clampPitchToRange(60, 55, 70), 60); // already in range
});

test('an untouched spec (no instrumental flag) keeps the original 3 tracks', () => {
  const composition = generateComposition(spec, { seed: 42 });
  assert.deepEqual(
    composition.tracks.map((t) => t.name),
    ['melody', 'bass', 'drums']
  );
});

test('instrumental: true explicitly still omits vocals', () => {
  const composition = generateComposition({ ...spec, instrumental: true }, { seed: 42 });
  assert.equal(composition.tracks.find((t) => t.name === 'vocal'), undefined);
});

test('instrumental: false adds a vocal track using the default range', () => {
  const composition = generateComposition({ ...spec, instrumental: false }, { seed: 42 });
  const vocal = composition.tracks.find((t) => t.name === 'vocal');
  assert.ok(vocal);
  assert.ok(vocal.notes.length > 0);
  for (const note of vocal.notes) {
    assert.ok(note.pitch >= 57 - 12 && note.pitch <= 74 + 12); // within an octave of the fallback range
  }
});

test('instrumental: false with a voice profile constrains notes to that pitch range', () => {
  const voiceProfile = { averagePitchHz: 200, minPitchHz: 150, maxPitchHz: 260 };
  const composition = generateComposition({ ...spec, instrumental: false, voiceProfile }, { seed: 3 });
  const vocal = composition.tracks.find((t) => t.name === 'vocal');
  const minMidi = Math.round(pitchHzToMidi(voiceProfile.minPitchHz));
  const maxMidi = Math.round(pitchHzToMidi(voiceProfile.maxPitchHz));
  for (const note of vocal.notes) {
    assert.ok(note.pitch >= minMidi && note.pitch <= maxMidi, `pitch ${note.pitch} outside [${minMidi}, ${maxMidi}]`);
  }
});
