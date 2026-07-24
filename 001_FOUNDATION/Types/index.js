'use strict';

// Shared data-model factories and validators used across every layer.
// Kept as plain-object factories (not classes) so payloads serialize
// cleanly across process/network boundaries (REST, WebSocket, Python).

function createNote({ pitch, start, duration, velocity = 100 }) {
  if (!Number.isFinite(pitch)) throw new TypeError('Note.pitch must be a MIDI number');
  if (!Number.isFinite(start) || start < 0) throw new TypeError('Note.start must be >= 0');
  if (!Number.isFinite(duration) || duration <= 0) throw new TypeError('Note.duration must be > 0');
  return {
    pitch,
    start,
    duration,
    velocity: Math.min(127, Math.max(1, velocity)),
  };
}

function isValidNote(note) {
  return (
    !!note &&
    Number.isFinite(note.pitch) &&
    Number.isFinite(note.start) &&
    Number.isFinite(note.duration) &&
    note.duration > 0
  );
}

function createTrack({ name, instrument = 'synth', waveform = 'sine', notes = [], gain = 0.8, pan = 0 }) {
  if (!name) throw new TypeError('Track.name is required');
  if (!notes.every(isValidNote)) throw new TypeError('Track.notes contains an invalid note');
  if (!Number.isFinite(pan) || pan < -1 || pan > 1) throw new TypeError('Track.pan must be a number in [-1, 1]');
  return { name, instrument, waveform, notes, gain, pan };
}

function createComposition({
  title = 'Untitled',
  tempo = 120,
  key = 'C',
  mode = 'major',
  timeSignature = [4, 4],
  bars = 8,
  tracks = [],
  reverb = { wet: 0.2, roomSize: 0.5 },
}) {
  if (!Number.isFinite(tempo) || tempo <= 0) throw new TypeError('Composition.tempo must be > 0');
  if (!Array.isArray(tracks)) throw new TypeError('Composition.tracks must be an array');
  const clamp01 = (v, fallback) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);
  return {
    title,
    tempo,
    key,
    mode,
    timeSignature,
    bars,
    tracks,
    reverb: { wet: clamp01(reverb?.wet, 0.2), roomSize: clamp01(reverb?.roomSize, 0.5) },
  };
}

function isValidComposition(composition) {
  return (
    !!composition &&
    Number.isFinite(composition.tempo) &&
    composition.tempo > 0 &&
    Array.isArray(composition.tracks) &&
    composition.tracks.every((t) => Array.isArray(t.notes) && t.notes.every(isValidNote))
  );
}

function createSession({ id, createdAt = Date.now(), meta = {} } = {}) {
  if (!id) throw new TypeError('Session.id is required');
  return { id, createdAt, updatedAt: createdAt, meta };
}

function createGenerationSpec({
  genre = 'ambient',
  mood = 'neutral',
  tempo = 100,
  key = 'C',
  mode = 'major',
  bars = 8,
}) {
  return { genre, mood, tempo, key, mode, bars };
}

module.exports = {
  createNote,
  isValidNote,
  createTrack,
  createComposition,
  isValidComposition,
  createSession,
  createGenerationSpec,
};
