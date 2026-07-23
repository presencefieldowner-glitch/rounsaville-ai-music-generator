'use strict';

const { createRng, hashStringToSeed } = require('../../001_FOUNDATION/Utilities');
const { createNote, createTrack, createComposition } = require('../../001_FOUNDATION/Types');

// Deterministic, dependency-free algorithmic composer. Given a
// GenerationSpec it produces a full Composition (melody + bass + drums).
// Determinism (same spec -> same output) makes this testable and makes
// "regenerate with the same seed" a real, reproducible feature.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

function keyToMidiRoot(key, octave = 4) {
  const idx = NOTE_NAMES.indexOf(key);
  const pitchClass = idx === -1 ? 0 : idx;
  return (octave + 1) * 12 + pitchClass;
}

function scaleDegreeToPitch(root, degreeIndex, mode) {
  const intervals = SCALE_INTERVALS[mode] ?? SCALE_INTERVALS.major;
  const octaveOffset = Math.floor(degreeIndex / intervals.length) * 12;
  const interval = intervals[((degreeIndex % intervals.length) + intervals.length) % intervals.length];
  return root + interval + octaveOffset;
}

function generateMelody(spec, rng) {
  const root = keyToMidiRoot(spec.key, 5);
  const stepsPerBar = 4;
  const totalSteps = spec.bars * stepsPerBar;
  let degree = 0;
  const notes = [];

  for (let step = 0; step < totalSteps; step += 1) {
    const move = Math.floor(rng() * 5) - 2; // -2..+2 scale-degree walk
    degree = Math.max(-4, Math.min(11, degree + move));
    const restProbability = spec.mood === 'calm' ? 0.35 : 0.15;
    if (rng() < restProbability) continue;
    notes.push(
      createNote({
        pitch: scaleDegreeToPitch(root, degree, spec.mode),
        start: step,
        duration: 1,
        velocity: 70 + Math.floor(rng() * 40),
      })
    );
  }

  return createTrack({ name: 'melody', instrument: 'lead', waveform: 'sine', notes, gain: 0.7 });
}

function generateBassline(spec, rng) {
  const root = keyToMidiRoot(spec.key, 3);
  const stepsPerBar = 4;
  const notes = [];

  for (let bar = 0; bar < spec.bars; bar += 1) {
    const degree = [0, 4, 5, 0][bar % 4]; // I-V-vi-I-ish walk over scale degrees
    notes.push(
      createNote({
        pitch: scaleDegreeToPitch(root, degree, spec.mode),
        start: bar * stepsPerBar,
        duration: stepsPerBar,
        velocity: 90 + Math.floor(rng() * 20),
      })
    );
  }

  return createTrack({ name: 'bass', instrument: 'bass', waveform: 'triangle', notes, gain: 0.6 });
}

// Percussion has no meaningful pitch; we encode kick/snare/hihat as fixed
// low MIDI numbers purely so they render as short, distinct clicks.
const DRUM_PITCHES = { kick: 36, snare: 38, hihat: 42 };

function generateDrumPattern(spec, rng) {
  const stepsPerBar = 8; // eighth notes
  const notes = [];

  for (let bar = 0; bar < spec.bars; bar += 1) {
    for (let step = 0; step < stepsPerBar; step += 1) {
      const start = bar * (stepsPerBar / 2) + step * 0.5;
      if (step % 4 === 0) {
        notes.push(createNote({ pitch: DRUM_PITCHES.kick, start, duration: 0.25, velocity: 110 }));
      }
      if (step % 4 === 2) {
        notes.push(createNote({ pitch: DRUM_PITCHES.snare, start, duration: 0.25, velocity: 100 }));
      }
      if (rng() > 0.3) {
        notes.push(createNote({ pitch: DRUM_PITCHES.hihat, start, duration: 0.1, velocity: 60 }));
      }
    }
  }

  return createTrack({ name: 'drums', instrument: 'percussion', waveform: 'square', notes, gain: 0.4 });
}

function generateComposition(spec, { seed } = {}) {
  const rngSeed = seed ?? hashStringToSeed(JSON.stringify(spec));
  const rng = createRng(rngSeed);

  const tracks = [generateMelody(spec, rng), generateBassline(spec, rng), generateDrumPattern(spec, rng)];

  return createComposition({
    title: `${spec.genre}-${spec.mood}-${spec.key}${spec.mode === 'minor' ? 'm' : ''}`,
    tempo: spec.tempo,
    key: spec.key,
    mode: spec.mode,
    bars: spec.bars,
    tracks,
  });
}

module.exports = {
  keyToMidiRoot,
  scaleDegreeToPitch,
  generateMelody,
  generateBassline,
  generateDrumPattern,
  generateComposition,
};
