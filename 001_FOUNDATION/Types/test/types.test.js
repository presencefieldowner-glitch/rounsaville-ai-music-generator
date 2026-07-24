'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createNote,
  isValidNote,
  createTrack,
  createComposition,
  isValidComposition,
  createSession,
  createGenerationSpec,
} = require('../index.js');

test('createNote validates and defaults velocity', () => {
  const note = createNote({ pitch: 60, start: 0, duration: 1 });
  assert.equal(note.velocity, 100);
  assert.ok(isValidNote(note));
});

test('createNote rejects invalid duration', () => {
  assert.throws(() => createNote({ pitch: 60, start: 0, duration: 0 }));
});

test('createTrack rejects invalid notes', () => {
  assert.throws(() => createTrack({ name: 'lead', notes: [{ pitch: 60 }] }));
});

test('createTrack defaults pan to center and accepts a value in [-1, 1]', () => {
  assert.equal(createTrack({ name: 'lead' }).pan, 0);
  assert.equal(createTrack({ name: 'lead', pan: -1 }).pan, -1);
  assert.equal(createTrack({ name: 'lead', pan: 0.5 }).pan, 0.5);
});

test('createTrack rejects an out-of-range pan', () => {
  assert.throws(() => createTrack({ name: 'lead', pan: 2 }));
  assert.throws(() => createTrack({ name: 'lead', pan: -2 }));
});

test('createComposition + isValidComposition round-trip', () => {
  const track = createTrack({
    name: 'lead',
    notes: [createNote({ pitch: 64, start: 0, duration: 1 })],
  });
  const composition = createComposition({ tracks: [track] });
  assert.ok(isValidComposition(composition));
});

test('createComposition defaults and clamps the reverb field', () => {
  assert.deepEqual(createComposition({}).reverb, { wet: 0.2, roomSize: 0.5 });
  assert.deepEqual(createComposition({ reverb: { wet: 5, roomSize: -1 } }).reverb, { wet: 1, roomSize: 0 });
  assert.deepEqual(createComposition({ reverb: { wet: 0.4, roomSize: 0.7 } }).reverb, { wet: 0.4, roomSize: 0.7 });
});

test('createSession requires an id', () => {
  assert.throws(() => createSession({}));
  const session = createSession({ id: 'abc' });
  assert.equal(session.id, 'abc');
  assert.equal(session.updatedAt, session.createdAt);
});

test('createGenerationSpec applies sensible defaults', () => {
  const spec = createGenerationSpec({});
  assert.equal(spec.genre, 'ambient');
  assert.equal(spec.bars, 8);
});
