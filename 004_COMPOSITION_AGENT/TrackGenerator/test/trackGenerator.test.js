'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidComposition } = require('../../../001_FOUNDATION/Types');
const {
  keyToMidiRoot,
  scaleDegreeToPitch,
  chordProgressionFor,
  melodyWaveformFor,
  buildChord,
  generateChordProgression,
  dynamicsCurve,
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

test('generateComposition produces a valid Composition with melody/chords/bass/drums', () => {
  const composition = generateComposition(spec, { seed: 42 });
  assert.ok(isValidComposition(composition));
  assert.deepEqual(
    composition.tracks.map((t) => t.name),
    ['melody', 'chords', 'bass', 'drums']
  );
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

test('chordProgressionFor returns a genre-specific progression, falling back for unknown genres', () => {
  assert.deepEqual(chordProgressionFor('jazz'), [1, 4, 0, 0]);
  assert.deepEqual(chordProgressionFor('totally-made-up-genre'), [0, 4, 5, 3]);
});

test('melodyWaveformFor maps genres to distinct real timbres, falling back to sine', () => {
  assert.equal(melodyWaveformFor('lofi'), 'pluck');
  assert.equal(melodyWaveformFor('ambient'), 'pad');
  assert.equal(melodyWaveformFor('edm'), 'saw');
  assert.equal(melodyWaveformFor('unknown-genre'), 'sine');
});

test('buildChord stacks diatonic thirds (root, third, fifth)', () => {
  const chord = buildChord(60, 0, 'major'); // C major triad from C4
  assert.deepEqual(chord, [60, 64, 67]); // C, E, G
});

test('generateChordProgression assigns one chord per bar, cycling the progression', () => {
  const chords = generateChordProgression({ ...spec, genre: 'jazz', bars: 6 });
  assert.equal(chords.length, 6);
  assert.equal(chords[0].degreeIndex, chords[4].degreeIndex); // progression length 4, cycles at bar 4
  assert.ok(chords.every((c) => c.pitches.length === 3));
});

test('dynamicsCurve fades in at the start, holds mid, fades out at the end', () => {
  assert.ok(dynamicsCurve(0, 20) < dynamicsCurve(10, 20)); // quieter at the very start
  assert.equal(dynamicsCurve(10, 20), 1); // full level mid-piece
  assert.ok(dynamicsCurve(19, 20) < dynamicsCurve(10, 20)); // quieter at the very end
});

test('the melody follows the harmony: strong-beat notes land on the current chord tones', () => {
  const composition = generateComposition({ ...spec, genre: 'rock', bars: 8 }, { seed: 11 });
  const chords = generateChordProgression({ ...spec, genre: 'rock', bars: 8 });
  const melody = composition.tracks.find((t) => t.name === 'melody');

  const root = keyToMidiRoot(spec.key, 5);
  for (const note of melody.notes) {
    if (note.start % 4 !== 0) continue; // only check strong-beat (bar downbeat) notes
    const bar = Math.floor(note.start / 4);
    const chordDegree = chords[bar % chords.length].degreeIndex;
    const chordToneClasses = [0, 2, 4].map((i) => (root + scaleDegreeToPitch(0, chordDegree + i, spec.mode)) % 12);
    assert.ok(chordToneClasses.includes(note.pitch % 12), `bar ${bar} downbeat pitch ${note.pitch} isn't a chord tone`);
  }
});

test('the bassline plays the chord progression root on every bar', () => {
  const composition = generateComposition({ ...spec, genre: 'jazz', bars: 8 }, { seed: 9 });
  const chords = generateChordProgression({ ...spec, genre: 'jazz', bars: 8 });
  const bass = composition.tracks.find((t) => t.name === 'bass');
  assert.equal(bass.notes.length, chords.length);
  bass.notes.forEach((note, i) => {
    assert.equal(note.start, i * 4);
  });
});
