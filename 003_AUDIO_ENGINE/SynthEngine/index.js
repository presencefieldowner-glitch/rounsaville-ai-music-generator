'use strict';

/**
 * SynthEngine — signal generation for the audio engine layer.
 *
 * Produces Float32Array sample buffers in [-1, 1]. It has no opinion about how
 * those samples are combined (MixMaster) or encoded (AudioRenderer), so each
 * stage of the pipeline stays independently testable.
 *
 * The JS counterpart of PythonRunner/synth.py; the two agree on sample rate,
 * tuning, and envelope shape.
 */

const SAMPLE_RATE = 44100;

const A4_MIDI = 69;
const A4_HZ = 440;
const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// --- oscillators ---------------------------------------------------------
// Each takes a phase in cycles (not radians) and returns a sample in [-1, 1].

const sine = (phase) => Math.sin(2 * Math.PI * phase);

const square = (phase) => (mod1(phase) < 0.5 ? 1 : -1);

const sawtooth = (phase) => 2 * mod1(phase) - 1;

const triangle = (phase) => {
  const p = mod1(phase);
  return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
};

/** Positive modulo 1 — JS `%` keeps the sign of the dividend. */
function mod1(value) {
  return ((value % 1) + 1) % 1;
}

const WAVEFORMS = { sine, square, sawtooth, triangle };

function oscillatorFor(waveform) {
  if (typeof waveform === 'function') return waveform;
  const osc = WAVEFORMS[waveform];
  if (!osc) {
    throw new Error(
      `unknown waveform "${waveform}"; expected one of ${Object.keys(WAVEFORMS).join(', ')}`
    );
  }
  return osc;
}

// --- pitch ---------------------------------------------------------------

/** Parse scientific pitch notation ("A4", "C#5", "Eb3") to a MIDI number. */
function noteToMidi(note) {
  if (typeof note !== 'string' || note.trim() === '') {
    throw new Error(`invalid note: ${JSON.stringify(note)}`);
  }
  const text = note.trim();

  const letter = text[0].toUpperCase();
  if (!(letter in SEMITONES)) {
    throw new Error(`invalid note letter: ${JSON.stringify(note)}`);
  }

  let semitone = SEMITONES[letter];
  let i = 1;
  while (i < text.length && '#b♯♭'.includes(text[i])) {
    semitone += text[i] === '#' || text[i] === '♯' ? 1 : -1;
    i += 1;
  }

  const octave = text.slice(i);
  if (!/^-?\d+$/.test(octave)) {
    throw new Error(`invalid octave in note: ${JSON.stringify(note)}`);
  }

  return (Number(octave) + 1) * 12 + semitone;
}

/** Twelve-tone equal temperament, A4 = 440 Hz. */
const midiToFreq = (midi) => A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);

const noteToFreq = (note) => midiToFreq(noteToMidi(note));

// --- envelope ------------------------------------------------------------

const DEFAULT_ADSR = { attack: 0.01, decay: 0.05, sustain: 0.7, release: 0.08 };

/**
 * Attack/decay/release in seconds, sustain as a level in [0, 1].
 * A note shorter than its own envelope keeps the segment proportions.
 */
function adsrEnvelope(totalSamples, adsr = DEFAULT_ADSR, sampleRate = SAMPLE_RATE) {
  const out = new Float32Array(Math.max(0, totalSamples));
  if (out.length === 0) return out;

  const { attack, decay, sustain, release } = { ...DEFAULT_ADSR, ...adsr };

  let a = Math.floor(attack * sampleRate);
  let d = Math.floor(decay * sampleRate);
  let r = Math.floor(release * sampleRate);

  const shaped = a + d + r;
  if (shaped > out.length) {
    const scale = out.length / shaped;
    a = Math.floor(a * scale);
    d = Math.floor(d * scale);
    r = Math.floor(r * scale);
  }

  const sustainSamples = out.length - a - d - r;
  let i = 0;

  for (let n = 0; n < a; n++, i++) out[i] = (n + 1) / a;
  for (let n = 0; n < d; n++, i++) out[i] = 1 + (sustain - 1) * ((n + 1) / d);
  for (let n = 0; n < sustainSamples; n++, i++) out[i] = sustain;
  for (let n = 0; n < r; n++, i++) out[i] = sustain * (1 - (n + 1) / r);

  // Integer truncation above can leave a sample or two unwritten; they stay 0.
  return out;
}

// --- rendering -----------------------------------------------------------

function renderNote(options = {}) {
  const {
    frequency,
    duration,
    waveform = 'sine',
    envelope = null,
    amplitude = 0.8,
    sampleRate = SAMPLE_RATE,
  } = options;

  if (!Number.isFinite(frequency) || frequency < 0) {
    throw new Error(`invalid frequency: ${frequency}`);
  }

  const total = Math.floor(duration * sampleRate);
  const osc = oscillatorFor(waveform);
  const env = envelope ? adsrEnvelope(total, envelope, sampleRate) : null;

  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const gain = env ? env[i] : 1;
    out[i] = amplitude * gain * osc((frequency * i) / sampleRate);
  }
  return out;
}

const renderRest = (duration, sampleRate = SAMPLE_RATE) =>
  new Float32Array(Math.floor(duration * sampleRate));

/**
 * Render notes end to end. Each entry is `{ pitch, duration, amplitude }`;
 * a null/absent pitch is a rest.
 */
function renderSequence(notes, options = {}) {
  const { waveform = 'sine', envelope = null, sampleRate = SAMPLE_RATE } = options;

  const parts = notes.map((note) =>
    note.pitch == null
      ? renderRest(note.duration, sampleRate)
      : renderNote({
          frequency: noteToFreq(note.pitch),
          duration: note.duration,
          waveform,
          envelope,
          amplitude: note.amplitude ?? 0.8,
          sampleRate,
        })
  );

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

module.exports = {
  SAMPLE_RATE,
  DEFAULT_ADSR,
  WAVEFORMS,
  sine,
  square,
  sawtooth,
  triangle,
  noteToMidi,
  midiToFreq,
  noteToFreq,
  adsrEnvelope,
  renderNote,
  renderRest,
  renderSequence,
};
