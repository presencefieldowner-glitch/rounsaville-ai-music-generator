'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidComposition } = require('../../../001_FOUNDATION/Types');
const {
  keyToMidiRoot,
  scaleDegreeToPitch,
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
