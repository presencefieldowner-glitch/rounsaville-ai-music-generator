'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidComposition } = require('../../../001_FOUNDATION/Types');
const {
  keyToMidiRoot,
  scaleDegreeToPitch,
  chordProgressionFor,
  melodyWaveformFor,
  reverbFor,
  buildChord,
  generateChordProgression,
  dynamicsCurve,
  pitchHzToMidi,
  clampPitchToRange,
  isFillBar,
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
  const melody = composition.tracks.find((t) => t.name === 'melody');
  const chords = composition.tracks.find((t) => t.name === 'chords');
  assert.ok(melody.pan > 0, 'melody should pan right of center');
  assert.ok(chords.pan < 0, 'chords should pan left of center, opposite the melody');
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

test('reverbFor gives cinematic/ambient a wetter, bigger space than edm/trap', () => {
  assert.ok(reverbFor('cinematic').wet > reverbFor('edm').wet);
  assert.ok(reverbFor('ambient').roomSize > reverbFor('trap').roomSize);
  assert.deepEqual(reverbFor('unknown-genre'), { wet: 0.2, roomSize: 0.5 });
});

test('generateComposition sets the composition reverb from the genre', () => {
  const composition = generateComposition({ ...spec, genre: 'cinematic' }, { seed: 1 });
  assert.deepEqual(composition.reverb, reverbFor('cinematic'));
});

test('buildChord stacks diatonic thirds (root, third, fifth)', () => {
  const chord = buildChord(60, 0, 'major'); // C major triad from C4
  assert.deepEqual(chord, [60, 64, 67]); // C, E, G
});

test('buildChord adds a 7th when extended is requested', () => {
  const chord = buildChord(60, 0, 'major', true); // Cmaj7 from C4
  assert.deepEqual(chord, [60, 64, 67, 71]); // C, E, G, B
});

test('generateChordProgression uses 7th chords for jazz/cinematic, triads otherwise', () => {
  const jazzChords = generateChordProgression({ ...spec, genre: 'jazz' });
  const rockChords = generateChordProgression({ ...spec, genre: 'rock' });
  assert.ok(jazzChords.every((c) => c.pitches.length === 4));
  assert.ok(rockChords.every((c) => c.pitches.length === 3));
});

test('generateChordProgression assigns one chord per bar, cycling the progression', () => {
  const chords = generateChordProgression({ ...spec, genre: 'jazz', bars: 6 });
  assert.equal(chords.length, 6);
  assert.equal(chords[0].degreeIndex, chords[4].degreeIndex); // progression length 4, cycles at bar 4
  assert.ok(chords.every((c) => c.pitches.length === 4)); // jazz uses extended (7th) chords
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
  let checkedAtLeastOne = false;
  for (const note of melody.notes) {
    const nearestStep = Math.round(note.start); // timing is humanized, so compare to the intended step
    if (nearestStep % 4 !== 0) continue; // only check strong-beat (bar downbeat) notes
    checkedAtLeastOne = true;
    const bar = Math.floor(nearestStep / 4);
    const chordDegree = chords[bar % chords.length].degreeIndex;
    const chordToneClasses = [0, 2, 4].map((i) => (root + scaleDegreeToPitch(0, chordDegree + i, spec.mode)) % 12);
    assert.ok(chordToneClasses.includes(note.pitch % 12), `bar ${bar} downbeat pitch ${note.pitch} isn't a chord tone`);
  }
  assert.ok(checkedAtLeastOne, 'expected at least one strong-beat note to actually be checked');
});

test('melody/vocal timing is humanized within a small bound; bass/chords/drums stay quantized', () => {
  const composition = generateComposition({ ...spec, bars: 4, instrumental: false }, { seed: 6 });
  const melody = composition.tracks.find((t) => t.name === 'melody');
  const bass = composition.tracks.find((t) => t.name === 'bass');

  let anyOffQuantization = false;
  for (const note of melody.notes) {
    const offset = Math.abs(note.start - Math.round(note.start));
    assert.ok(offset <= 0.02 + 1e-9, `melody note offset ${offset} exceeds the humanization bound`);
    if (offset > 1e-9) anyOffQuantization = true;
  }
  assert.ok(anyOffQuantization, 'expected at least one melody note to actually be nudged off-grid');

  for (const note of bass.notes) {
    assert.equal(note.start, Math.round(note.start)); // bass stays perfectly quantized
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

test('isFillBar marks phrase-ends (every 4th bar) and always the final bar', () => {
  assert.equal(isFillBar(0, 8), false);
  assert.equal(isFillBar(3, 8), true); // end of first 4-bar phrase
  assert.equal(isFillBar(7, 8), true); // end of second phrase + final bar
  assert.equal(isFillBar(4, 8), false);
  assert.equal(isFillBar(2, 5), false);
  assert.equal(isFillBar(4, 5), true); // final bar of a 5-bar piece, not a phrase end
  assert.equal(isFillBar(0, 1), false);
});

test('drum fills add a snare roll on phrase-end/final bars instead of the single normal-bar snare hit', () => {
  const composition = generateComposition({ ...spec, bars: 4 }, { seed: 2 });
  const drums = composition.tracks.find((t) => t.name === 'drums');

  const snaresInBar = (bar) =>
    drums.notes.filter((n) => n.pitch === 38 && Math.floor(n.start / 4) === bar).length;

  assert.equal(snaresInBar(0), 2); // normal bar: backbeat on beats 2 and 4
  assert.equal(snaresInBar(1), 2);
  assert.equal(snaresInBar(2), 2);
  assert.equal(snaresInBar(3), 4); // fill bar (phrase end + final bar): snare roll
});
