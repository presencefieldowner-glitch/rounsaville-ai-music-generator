'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  SAMPLE_RATE,
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
} = require('./index');

/** Estimate frequency by counting zero crossings. */
function measuredFrequency(samples, sampleRate = SAMPLE_RATE) {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] < 0 !== samples[i] < 0) crossings++;
  }
  return crossings / (2 * (samples.length / sampleRate));
}

test('A4 is the 440 Hz reference pitch', () => {
  assert.ok(Math.abs(noteToFreq('A4') - 440) < 1e-9);
  assert.strictEqual(noteToMidi('A4'), 69);
});

test('middle C is MIDI 60', () => {
  assert.strictEqual(noteToMidi('C4'), 60);
  assert.ok(Math.abs(noteToFreq('C4') - 261.6255653) < 1e-5);
});

test('an octave doubles frequency', () => {
  assert.ok(Math.abs(noteToFreq('A5') - 2 * noteToFreq('A4')) < 1e-9);
  assert.ok(Math.abs(noteToFreq('A3') - noteToFreq('A4') / 2) < 1e-9);
});

test('sharps and flats are enharmonic', () => {
  assert.strictEqual(noteToMidi('A#4'), noteToMidi('Bb4'));
  assert.ok(Math.abs(noteToFreq('A#4') - 466.1637615) < 1e-5);
});

test('a semitone is the twelfth root of two', () => {
  assert.ok(Math.abs(noteToFreq('C#4') / noteToFreq('C4') - Math.pow(2, 1 / 12)) < 1e-12);
});

test('negative octaves parse', () => {
  assert.strictEqual(noteToMidi('C-1'), 0);
  assert.ok(Math.abs(midiToFreq(69) - 440) < 1e-9);
});

test('malformed notes throw', () => {
  for (const bad of ['', 'H4', 'C', 'Cx4', null, 42]) {
    assert.throws(() => noteToMidi(bad), `expected ${JSON.stringify(bad)} to throw`);
  }
});

test('every waveform stays within [-1, 1]', () => {
  for (const osc of [sine, square, sawtooth, triangle]) {
    for (let i = 0; i < 500; i++) {
      const value = osc(i / 97);
      assert.ok(value >= -1 && value <= 1, `${osc.name} produced ${value}`);
    }
  }
});

test('waveforms are periodic, including at negative phase', () => {
  for (const osc of [sine, square, sawtooth, triangle]) {
    for (const phase of [0.1, 0.37, 0.62, 0.94]) {
      assert.ok(Math.abs(osc(phase) - osc(phase + 3)) < 1e-9, osc.name);
      assert.ok(Math.abs(osc(phase) - osc(phase - 3)) < 1e-9, `${osc.name} at negative phase`);
    }
  }
});

test('triangle traces the expected corners', () => {
  assert.ok(Math.abs(triangle(0) - -1) < 1e-9);
  assert.ok(Math.abs(triangle(0.25) - 0) < 1e-9);
  assert.ok(Math.abs(triangle(0.5) - 1) < 1e-9);
  assert.ok(Math.abs(triangle(0.75) - 0) < 1e-9);
});

test('an unknown waveform is rejected', () => {
  assert.throws(() => renderNote({ frequency: 440, duration: 0.1, waveform: 'bagpipe' }));
});

test('sample count matches the requested duration', () => {
  assert.strictEqual(renderNote({ frequency: 440, duration: 0.5 }).length, SAMPLE_RATE / 2);
});

test('rendered tones hit their target frequency', () => {
  for (const pitch of ['A4', 'C4', 'E5']) {
    const samples = renderNote({ frequency: noteToFreq(pitch), duration: 1 });
    assert.ok(
      Math.abs(measuredFrequency(samples) - noteToFreq(pitch)) < 1,
      `${pitch} measured ${measuredFrequency(samples)}`
    );
  }
});

test('amplitude bounds the output', () => {
  const samples = renderNote({ frequency: 440, duration: 0.2, amplitude: 0.5 });
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak <= 0.5 + 1e-6 && peak > 0.49, `peak was ${peak}`);
});

test('a negative frequency is rejected', () => {
  assert.throws(() => renderNote({ frequency: -1, duration: 0.1 }));
});

test('a rest is silent', () => {
  assert.ok(renderRest(0.1).every((s) => s === 0));
});

test('envelope length always matches the request', () => {
  assert.strictEqual(adsrEnvelope(1000).length, 1000);
  assert.strictEqual(adsrEnvelope(0).length, 0);
});

test('envelope peaks at unity then returns to silence', () => {
  const env = adsrEnvelope(SAMPLE_RATE, {
    attack: 0.1,
    decay: 0.1,
    sustain: 0.5,
    release: 0.1,
  });
  assert.ok(Math.abs(env[Math.floor(0.1 * SAMPLE_RATE) - 1] - 1) < 1e-3);
  assert.ok(Math.abs(env[SAMPLE_RATE / 2] - 0.5) < 1e-6);
  assert.ok(Math.abs(env[env.length - 1]) < 1e-6);
});

test('envelope never leaves [0, 1]', () => {
  for (const value of adsrEnvelope(5000)) {
    assert.ok(value >= 0 && value <= 1, `envelope produced ${value}`);
  }
});

test('a note shorter than its envelope still fits', () => {
  const env = adsrEnvelope(100, { attack: 0.5, decay: 0.5, sustain: 0.5, release: 0.5 });
  assert.strictEqual(env.length, 100);
  for (const value of env) assert.ok(value >= 0 && value <= 1);
});

test('sequence length is the sum of its notes', () => {
  const notes = [
    { pitch: 'C4', duration: 0.2 },
    { pitch: null, duration: 0.1 },
    { pitch: 'G4', duration: 0.3 },
  ];
  const expected = notes.reduce((sum, n) => sum + Math.floor(n.duration * SAMPLE_RATE), 0);
  assert.strictEqual(renderSequence(notes).length, expected);
});

test('a sequence places its rest as actual silence', () => {
  const samples = renderSequence([
    { pitch: 'C4', duration: 0.1 },
    { pitch: null, duration: 0.1 },
  ]);
  const restStart = Math.floor(0.1 * SAMPLE_RATE);
  for (let i = restStart; i < samples.length; i++) {
    assert.strictEqual(samples[i], 0);
  }
});
