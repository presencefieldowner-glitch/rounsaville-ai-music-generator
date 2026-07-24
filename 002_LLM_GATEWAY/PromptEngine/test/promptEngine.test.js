'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePrompt, buildSystemPrompt, detectInstrumental } = require('../index.js');

test('parsePrompt extracts genre, mood, tempo, bars, key', () => {
  const spec = parsePrompt('An energetic edm track in A minor at 128 bpm, 16 bars');
  assert.equal(spec.genre, 'edm');
  assert.equal(spec.mood, 'energetic');
  assert.equal(spec.tempo, 128);
  assert.equal(spec.bars, 16);
  assert.equal(spec.key, 'A');
  assert.equal(spec.mode, 'minor');
});

test('parsePrompt falls back to sensible defaults', () => {
  const spec = parsePrompt('something with no obvious keywords');
  assert.equal(spec.genre, 'ambient');
  assert.equal(spec.mood, 'neutral');
  assert.equal(spec.tempo, 100);
  assert.equal(spec.bars, 8);
});

test('parsePrompt rejects empty input', () => {
  assert.throws(() => parsePrompt(''));
});

test('buildSystemPrompt renders a readable instruction', () => {
  const spec = parsePrompt('calm lofi at 70 bpm');
  const prompt = buildSystemPrompt(spec);
  assert.match(prompt, /lofi/);
  assert.match(prompt, /70 BPM/);
});

test('parsePrompt resolves genre aliases onto the real genre buckets', () => {
  assert.equal(parsePrompt('a synthwave night drive').genre, 'edm');
  assert.equal(parsePrompt('orchestral film score for a trailer').genre, 'cinematic');
  assert.equal(parsePrompt('acoustic folk around a campfire').genre, 'classical');
  assert.equal(parsePrompt('hip hop beat with hard drums').genre, 'trap');
});

test('parsePrompt resolves mood aliases', () => {
  assert.equal(parsePrompt('an epic battle theme').mood, 'energetic');
  assert.equal(parsePrompt('a nostalgic piano piece').mood, 'sad');
  assert.equal(parsePrompt('a mysterious dungeon crawl').mood, 'dark');
});

test('detectInstrumental recognizes explicit instrumental requests', () => {
  assert.equal(detectInstrumental('an instrumental jazz track'), true);
  assert.equal(detectInstrumental('lofi beat, no vocals please'), true);
  assert.equal(detectInstrumental('a track without lyrics'), true);
});

test('detectInstrumental recognizes explicit vocal requests', () => {
  assert.equal(detectInstrumental('a pop song with vocals'), false);
  assert.equal(detectInstrumental('something with singing'), false);
});

test('detectInstrumental returns undefined when the text is silent on vocals', () => {
  assert.equal(detectInstrumental('an energetic edm track at 128 bpm'), undefined);
});

test('parsePrompt carries the detected instrumental flag onto the spec', () => {
  assert.equal(parsePrompt('an instrumental ambient piece').instrumental, true);
  assert.equal(parsePrompt('a ballad with vocals').instrumental, false);
  assert.equal(parsePrompt('an ambient piece').instrumental, undefined);
});

test('buildSystemPrompt mentions instrumental when explicitly requested', () => {
  const spec = parsePrompt('an instrumental cinematic piece at 90 bpm');
  assert.match(buildSystemPrompt(spec), /instrumental/i);
});
