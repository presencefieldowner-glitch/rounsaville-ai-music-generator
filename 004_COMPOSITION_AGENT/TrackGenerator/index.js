'use strict';

const { createRng, hashStringToSeed } = require('../../001_FOUNDATION/Utilities');
const { createNote, createTrack, createComposition } = require('../../001_FOUNDATION/Types');

// Deterministic, dependency-free algorithmic composer. Given a
// GenerationSpec it produces a full Composition: a genre-driven chord
// progression that the bassline and melody are harmonically locked to, a
// chord pad, a drum pattern, dynamics (an intro/outro velocity curve), and
// genre-appropriate timbre selection. Determinism (same spec -> same
// output) makes this testable and makes "regenerate with the same seed" a
// real, reproducible feature. This is algorithmic composition, not a
// trained model.

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

// Scale-degree roots (0-indexed: I=0, ii=1, iii=2, IV=3, V=4, vi=5, vii=6)
// of a few well-known progressions, picked per genre. Falls back to the
// ubiquitous I-V-vi-IV ("four chord song") progression for anything else.
const CHORD_PROGRESSIONS = {
  lofi: [0, 3, 5, 4],
  jazz: [1, 4, 0, 0],
  ambient: [0, 5, 3, 4],
  cinematic: [0, 3, 5, 4],
  edm: [5, 3, 0, 4],
  trap: [5, 3, 0, 4],
  rock: [0, 4, 5, 3],
  classical: [0, 3, 4, 0],
};
const DEFAULT_PROGRESSION = [0, 4, 5, 3];

function chordProgressionFor(genre) {
  return CHORD_PROGRESSIONS[genre] ?? DEFAULT_PROGRESSION;
}

// Genre -> the melody's timbre. 'pluck' (Karplus-Strong) and 'pad'
// (detuned oscillator stack) are real, distinct synthesis techniques from
// 003_AUDIO_ENGINE/SynthEngine, not just different labels.
const MELODY_WAVEFORM_BY_GENRE = {
  lofi: 'pluck',
  jazz: 'pluck',
  classical: 'pluck',
  ambient: 'pad',
  cinematic: 'pad',
  edm: 'saw',
  trap: 'saw',
  rock: 'square',
};

function melodyWaveformFor(genre) {
  return MELODY_WAVEFORM_BY_GENRE[genre] ?? 'sine';
}

// Reverb space per genre: cinematic/ambient get a large, wet hall; edm/trap
// stay tight and dry so the low end doesn't get muddy.
const REVERB_BY_GENRE = {
  cinematic: { wet: 0.5, roomSize: 0.85 },
  ambient: { wet: 0.45, roomSize: 0.8 },
  classical: { wet: 0.4, roomSize: 0.7 },
  jazz: { wet: 0.3, roomSize: 0.6 },
  lofi: { wet: 0.35, roomSize: 0.5 },
  rock: { wet: 0.15, roomSize: 0.4 },
  edm: { wet: 0.12, roomSize: 0.3 },
  trap: { wet: 0.1, roomSize: 0.3 },
};
const DEFAULT_REVERB = { wet: 0.2, roomSize: 0.5 };

function reverbFor(genre) {
  return REVERB_BY_GENRE[genre] ?? DEFAULT_REVERB;
}

// Genres where a 7th chord (jazzier, more harmonically dense) fits better
// than a plain triad.
const EXTENDED_CHORD_GENRES = new Set(['jazz', 'cinematic']);

// A stacked-thirds chord (root, third, fifth, and optionally a 7th) built
// diatonically from the scale, so it's automatically major/minor-
// appropriate for each degree.
function buildChord(root, degreeIndex, mode, extended = false) {
  const intervals = extended ? [0, 2, 4, 6] : [0, 2, 4];
  return intervals.map((interval) => scaleDegreeToPitch(root, degreeIndex + interval, mode));
}

function generateChordProgression(spec) {
  const root = keyToMidiRoot(spec.key, 3);
  const progression = chordProgressionFor(spec.genre);
  const extended = EXTENDED_CHORD_GENRES.has(spec.genre);
  const chords = [];
  for (let bar = 0; bar < spec.bars; bar += 1) {
    const degreeIndex = progression[bar % progression.length];
    chords.push({ bar, degreeIndex, pitches: buildChord(root, degreeIndex, spec.mode, extended) });
  }
  return chords;
}

// A simple arrangement dynamics curve: a fade-in over the first ~15% of
// bars, full level through the middle, a fade-out over the last ~15% -
// so the piece doesn't sound like it starts and stops at identical volume
// on every bar.
function dynamicsCurve(barIndex, totalBars) {
  if (totalBars <= 2) return 1;
  const introBars = Math.max(1, Math.round(totalBars * 0.15));
  const outroBars = Math.max(1, Math.round(totalBars * 0.15));

  if (barIndex < introBars) return 0.6 + 0.4 * (barIndex / introBars);
  if (barIndex >= totalBars - outroBars) {
    const progress = (barIndex - (totalBars - outroBars)) / outroBars;
    return 1 - 0.4 * progress;
  }
  return 1;
}

// Nudges a note's start time by a small random amount (real music
// production practice: quantized bass/drums but a slightly "performed"
// feel on lead/vocal lines) without ever pushing it negative.
function humanizeTiming(start, rng, amountBeats = 0.02) {
  return Math.max(0, start + (rng() * 2 - 1) * amountBeats);
}

function beatsPerBarOf(spec) {
  const [beatsPerBar] = spec.timeSignature ?? [4, 4];
  return beatsPerBar === 3 ? 3 : 4; // only these two are actually supported (see Guardrails)
}

function generateMelody(spec, rng, chords) {
  const root = keyToMidiRoot(spec.key, 5);
  const stepsPerBar = beatsPerBarOf(spec);
  const totalSteps = spec.bars * stepsPerBar;
  let degree = 0;
  const notes = [];

  for (let step = 0; step < totalSteps; step += 1) {
    const bar = Math.floor(step / stepsPerBar);
    const stepInBar = step % stepsPerBar;
    const dynamics = dynamicsCurve(bar, spec.bars);

    if (stepInBar === 0 && chords.length > 0) {
      // Lock onto a chord tone on the strong (first) beat of each bar so
      // the melody actually outlines the harmony instead of wandering
      // independently of it.
      const chordDegree = chords[bar % chords.length].degreeIndex;
      const chordTones = [0, 2, 4].map((i) => chordDegree + i);
      degree = chordTones[Math.floor(rng() * chordTones.length)];
    } else {
      const move = Math.floor(rng() * 5) - 2; // -2..+2 scale-degree walk
      degree = Math.max(-4, Math.min(11, degree + move));
    }

    const restProbability = spec.mood === 'calm' ? 0.35 : 0.15;
    if (rng() < restProbability) continue;
    notes.push(
      createNote({
        pitch: scaleDegreeToPitch(root, degree, spec.mode),
        start: humanizeTiming(step, rng),
        duration: 1,
        velocity: Math.round((70 + Math.floor(rng() * 40)) * dynamics),
      })
    );
  }

  return createTrack({
    name: 'melody',
    instrument: 'lead',
    waveform: melodyWaveformFor(spec.genre),
    notes,
    gain: 0.7,
    pan: 0.2, // slightly right, so it doesn't sit on top of the chords
  });
}

function generateChordsTrack(spec, rng, chords) {
  const stepsPerBar = beatsPerBarOf(spec);
  const notes = [];

  for (const { bar, pitches } of chords) {
    const dynamics = dynamicsCurve(bar, spec.bars);
    for (const pitch of pitches) {
      notes.push(
        createNote({
          pitch,
          start: bar * stepsPerBar,
          duration: stepsPerBar,
          velocity: Math.round((55 + Math.floor(rng() * 15)) * dynamics),
        })
      );
    }
  }

  return createTrack({
    name: 'chords',
    instrument: 'pad',
    waveform: 'pad',
    notes,
    gain: 0.5,
    pan: -0.3, // slightly left, mirroring the melody's pan for separation
  });
}

function generateBassline(spec, rng, chords) {
  const root = keyToMidiRoot(spec.key, 2);
  const stepsPerBar = beatsPerBarOf(spec);
  const notes = [];

  for (const { bar, degreeIndex } of chords) {
    const dynamics = dynamicsCurve(bar, spec.bars);
    notes.push(
      createNote({
        pitch: scaleDegreeToPitch(root, degreeIndex, spec.mode),
        start: bar * stepsPerBar,
        duration: stepsPerBar,
        velocity: Math.round((90 + Math.floor(rng() * 20)) * dynamics),
      })
    );
  }

  return createTrack({ name: 'bass', instrument: 'bass', waveform: 'triangle', notes, gain: 0.6 });
}

// Percussion has no meaningful pitch; we encode kick/snare/hihat as fixed
// low MIDI numbers purely so they render as short, distinct clicks.
const DRUM_PITCHES = { kick: 36, snare: 38, hihat: 42 };

// The last bar of every 4-bar phrase (and always the final bar of the
// piece) gets a fill instead of the steady pattern — a real, common
// drumming arrangement technique that signals a section is about to turn
// over.
function isFillBar(bar, totalBars) {
  if (totalBars <= 1) return false;
  const isPhraseEnd = (bar + 1) % 4 === 0;
  const isLastBar = bar === totalBars - 1;
  return isPhraseEnd || isLastBar;
}

// A real, distinct 3/4 "oom-pah-pah" waltz feel: a kick on the strong
// downbeat and hi-hats (a snare on fill bars) marking the two weaker
// beats — rhythmically different from the 4/4 backbeat pattern below, not
// the same pattern just truncated to fewer steps.
function generateWaltzDrumPattern(spec, rng) {
  const notes = [];
  for (let bar = 0; bar < spec.bars; bar += 1) {
    const fill = isFillBar(bar, spec.bars);
    const barStart = bar * 3;
    notes.push(createNote({ pitch: DRUM_PITCHES.kick, start: barStart, duration: 0.4, velocity: 110 }));
    if (rng() > 0.4) {
      notes.push(createNote({ pitch: DRUM_PITCHES.hihat, start: barStart, duration: 0.15, velocity: 50 }));
    }
    for (let beat = 1; beat < 3; beat += 1) {
      if (fill) {
        notes.push(
          createNote({
            pitch: DRUM_PITCHES.snare,
            start: barStart + beat,
            duration: 0.3,
            velocity: 75 + Math.floor(rng() * 20),
          })
        );
      } else {
        notes.push(
          createNote({
            pitch: DRUM_PITCHES.hihat,
            start: barStart + beat,
            duration: 0.2,
            velocity: 55 + Math.floor(rng() * 15),
          })
        );
      }
    }
  }
  return createTrack({ name: 'drums', instrument: 'percussion', waveform: 'square', notes, gain: 0.4 });
}

function generateDrumPattern(spec, rng) {
  if (beatsPerBarOf(spec) === 3) return generateWaltzDrumPattern(spec, rng);

  const stepsPerBar = 8; // eighth notes, 2 per beat over a 4-beat bar
  const notes = [];

  for (let bar = 0; bar < spec.bars; bar += 1) {
    const fill = isFillBar(bar, spec.bars);
    for (let step = 0; step < stepsPerBar; step += 1) {
      const start = bar * (stepsPerBar / 2) + step * 0.5;
      if (step % 4 === 0) {
        notes.push(createNote({ pitch: DRUM_PITCHES.kick, start, duration: 0.25, velocity: 110 }));
      }
      if (fill && step >= 4) {
        // Snare roll across the back half of the bar.
        notes.push(createNote({ pitch: DRUM_PITCHES.snare, start, duration: 0.2, velocity: 80 + Math.floor(rng() * 20) }));
      } else if (!fill && step % 4 === 2) {
        notes.push(createNote({ pitch: DRUM_PITCHES.snare, start, duration: 0.25, velocity: 100 }));
      }
      if (rng() > 0.3) {
        notes.push(createNote({ pitch: DRUM_PITCHES.hihat, start, duration: 0.1, velocity: 60 }));
      }
    }
  }

  return createTrack({ name: 'drums', instrument: 'percussion', waveform: 'square', notes, gain: 0.4 });
}

function pitchHzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

function clampPitchToRange(pitch, minMidi, maxMidi) {
  let clamped = pitch;
  let guard = 0;
  while (clamped < minMidi && guard < 20) {
    clamped += 12;
    guard += 1;
  }
  while (clamped > maxMidi && guard < 20) {
    clamped -= 12;
    guard += 1;
  }
  return clamped;
}

// Shapes a vocal-range melody. When a VoiceProfiler voice profile is
// supplied, the range comes from the speaker's actual measured pitch
// (see 003_AUDIO_ENGINE/VoiceProfiler) rather than a fixed default —
// this calibrates the synth's vocal pitch range to the voice, it does
// not clone its timbre.
function generateVocalLine(spec, rng, voiceProfile) {
  const root = keyToMidiRoot(spec.key, 4);
  const stepsPerBar = beatsPerBarOf(spec);
  const totalSteps = spec.bars * stepsPerBar;

  let minMidi = 57; // A3 fallback
  let maxMidi = 74; // D5 fallback
  if (voiceProfile?.minPitchHz && voiceProfile?.maxPitchHz) {
    minMidi = Math.round(pitchHzToMidi(voiceProfile.minPitchHz));
    maxMidi = Math.round(pitchHzToMidi(voiceProfile.maxPitchHz));
    if (minMidi > maxMidi) [minMidi, maxMidi] = [maxMidi, minMidi];
    if (maxMidi - minMidi < 4) maxMidi = minMidi + 4; // guarantee a singable range
  }

  let degree = 0;
  const notes = [];
  for (let step = 0; step < totalSteps; step += 1) {
    const move = Math.floor(rng() * 5) - 2;
    degree = Math.max(-4, Math.min(11, degree + move));
    if (rng() < 0.2) continue; // rest for breath
    const pitch = clampPitchToRange(scaleDegreeToPitch(root, degree, spec.mode), minMidi, maxMidi);
    notes.push(
      createNote({ pitch, start: humanizeTiming(step, rng), duration: 1, velocity: 80 + Math.floor(rng() * 30) })
    );
  }

  return createTrack({ name: 'vocal', instrument: 'vocal', waveform: 'triangle', notes, gain: 0.65 });
}

function generateComposition(spec, { seed } = {}) {
  const rngSeed = seed ?? hashStringToSeed(JSON.stringify(spec));
  const rng = createRng(rngSeed);

  const chords = generateChordProgression(spec);
  const tracks = [generateMelody(spec, rng, chords), generateChordsTrack(spec, rng, chords)];

  // noDrums/noBass default to false (see Guardrails.validateSpec), so
  // callers that never mention them keep the original full-band output.
  if (spec.noBass !== true) tracks.push(generateBassline(spec, rng, chords));
  if (spec.noDrums !== true) tracks.push(generateDrumPattern(spec, rng));

  // instrumental must be explicitly false to opt into a vocal line, so
  // callers that never mention it (existing specs/tests) keep the
  // original instrumental-only output.
  if (spec.instrumental === false) {
    tracks.push(generateVocalLine(spec, rng, spec.voiceProfile));
  }

  return createComposition({
    title: `${spec.genre}-${spec.mood}-${spec.key}${spec.mode === 'minor' ? 'm' : ''}`,
    tempo: spec.tempo,
    key: spec.key,
    mode: spec.mode,
    timeSignature: spec.timeSignature ?? [4, 4],
    bars: spec.bars,
    tracks,
    reverb: reverbFor(spec.genre),
  });
}

module.exports = {
  keyToMidiRoot,
  scaleDegreeToPitch,
  chordProgressionFor,
  melodyWaveformFor,
  reverbFor,
  buildChord,
  generateChordProgression,
  dynamicsCurve,
  beatsPerBarOf,
  pitchHzToMidi,
  clampPitchToRange,
  generateMelody,
  generateChordsTrack,
  generateBassline,
  isFillBar,
  generateDrumPattern,
  generateWaltzDrumPattern,
  generateVocalLine,
  generateComposition,
};
