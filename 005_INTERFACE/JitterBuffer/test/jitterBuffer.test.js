'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createJitterBuffer } = require('../index.js');
const { generateComposition } = require('../../../004_COMPOSITION_AGENT/TrackGenerator');
const { renderComposition } = require('../../../003_AUDIO_ENGINE/AudioRenderer');

test('pull returns null before the buffering window has elapsed', () => {
  const jb = createJitterBuffer({ targetDelayMs: 60 });
  jb.push(0, new Float32Array([1]), 1000);
  assert.equal(jb.pull(1000), null);
  assert.equal(jb.pull(1059), null);
});

test('out-of-order arrivals within the buffering window still play back in sequence', () => {
  const jb = createJitterBuffer({ targetDelayMs: 60 });
  // seq 2 arrives before seq 0 and seq 1 — real network reordering.
  jb.push(2, new Float32Array([2]), 1000);
  jb.push(0, new Float32Array([0]), 1005);
  jb.push(1, new Float32Array([1]), 1010);

  const results = [jb.pull(1061), jb.pull(1061), jb.pull(1061)];
  assert.deepEqual(results.map((r) => r.seq), [0, 1, 2]);
  assert.deepEqual(results.map((r) => r.payload[0]), [0, 1, 2]);
  assert.ok(results.every((r) => r.concealed === false));
});

test('a missing frame is concealed by fading the last good frame, not silence-cliffed or looped forever', () => {
  const jb = createJitterBuffer({ targetDelayMs: 60, maxConcealedFrames: 3 });
  jb.push(0, new Float32Array([1, 1, 1]), 1000);
  // seq 1 never arrives (lost packet).
  jb.push(2, new Float32Array([0.5, 0.5, 0.5]), 1010);

  const a = jb.pull(1061); // seq 0: real
  const b = jb.pull(1061); // seq 1: concealed (faded repeat of seq 0)
  const c = jb.pull(1061); // seq 2: real again

  assert.equal(a.concealed, false);
  assert.equal(b.concealed, true);
  assert.equal(b.silenced, undefined);
  assert.ok(b.payload[0] > 0 && b.payload[0] < 1, 'concealed frame should be a faded, not full-volume, repeat');
  assert.equal(c.concealed, false);
  assert.equal(c.payload[0], 0.5);
});

test('more than maxConcealedFrames of consecutive loss degrades to true silence', () => {
  const jb = createJitterBuffer({ targetDelayMs: 60, maxConcealedFrames: 2 });
  jb.push(0, new Float32Array([1, 1]), 1000);
  // seq 1, 2, 3, 4 all lost — well past maxConcealedFrames.

  jb.pull(1061); // seq 0: real
  const c1 = jb.pull(1061); // seq 1: concealed
  const c2 = jb.pull(1061); // seq 2: concealed
  const c3 = jb.pull(1061); // seq 3: exceeds maxConcealedFrames -> silence

  assert.equal(c1.concealed, true);
  assert.equal(c2.concealed, true);
  assert.equal(c3.silenced, true);
  assert.deepEqual([...c3.payload], [0, 0]);
});

test('a frame arriving after its playout slot has already passed is rejected as late', () => {
  const jb = createJitterBuffer({ targetDelayMs: 60 });
  jb.push(0, new Float32Array([1]), 1000);
  jb.pull(1061); // consumes seq 0, playoutSeq now at 1

  const result = jb.push(0, new Float32Array([9]), 1200); // a duplicate/very late seq 0
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'late');
  assert.equal(jb.stats().framesLate, 1);
});

test('stats track received/concealed/late/silenced counts', () => {
  const jb = createJitterBuffer({ targetDelayMs: 60, maxConcealedFrames: 1 });
  jb.push(0, new Float32Array([1]), 1000);
  jb.push(3, new Float32Array([1]), 1000);
  jb.pull(1061);
  jb.pull(1061); // concealed
  jb.pull(1061); // over maxConcealedFrames -> silenced
  jb.pull(1061); // seq 3: real

  const stats = jb.stats();
  assert.equal(stats.framesReceived, 2);
  assert.equal(stats.framesConcealed, 2);
  assert.equal(stats.framesSilenced, 1);
});

// Integration-style test against a real rendered composition, not just
// synthetic frames: split actual audio into fixed-size chunks, simulate
// reordering and one dropped frame over the network, and confirm the
// jitter buffer reconstructs it in the correct order with the loss
// concealed rather than a raw discontinuity.
test('reconstructs a real rendered composition through simulated reordering + one dropped frame', () => {
  const composition = generateComposition(
    { genre: 'ambient', mood: 'calm', tempo: 100, key: 'C', mode: 'major', bars: 2 },
    { seed: 1 }
  );
  const { left, sampleRate } = renderComposition(composition, { sampleRate: 8000 });

  const frameSamples = Math.round((sampleRate * 20) / 1000); // 20ms frames
  const frames = [];
  for (let i = 0; i * frameSamples < left.length; i += 1) {
    frames.push(left.subarray(i * frameSamples, (i + 1) * frameSamples));
  }
  assert.ok(frames.length > 10, 'expected a reasonably long real composition to chunk into frames');

  const droppedSeq = 5;
  const arrivalOrder = frames.map((_, seq) => seq).filter((seq) => seq !== droppedSeq);
  // Shuffle two adjacent arrivals to simulate reordering.
  [arrivalOrder[0], arrivalOrder[1]] = [arrivalOrder[1], arrivalOrder[0]];

  const jb = createJitterBuffer({ targetDelayMs: 60, maxConcealedFrames: 3 });
  let t = 1000;
  for (const seq of arrivalOrder) {
    jb.push(seq, frames[seq], t);
    t += 5;
  }

  const played = [];
  for (let i = 0; i < frames.length; i += 1) played.push(jb.pull(1200 + i * 20));

  assert.deepEqual(played.map((p) => p.seq), frames.map((_, i) => i)); // strictly in order
  played.forEach((p, seq) => {
    if (seq === droppedSeq) {
      assert.equal(p.concealed, true);
    } else {
      assert.equal(p.concealed, false);
      assert.deepEqual([...p.payload], [...frames[seq]]); // real frames pass through untouched
    }
  });
});
