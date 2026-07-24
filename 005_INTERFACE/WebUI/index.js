'use strict';

const http = require('node:http');

// Self-contained studio frontend for the ecosystem: prompt + style/BPM/
// bars/instrumental controls, a client-side track history (localStorage,
// since neither the local REST_API's stateless routes nor the Netlify
// functions keep server-side history), and a voice profile recorder.
// No build step, no framework. Talks to /api/generate and
// /api/voice-profile — same paths locally (005_INTERFACE/REST_API) and on
// Netlify (netlify.toml redirects /api/* to the functions directory).

const GENRES = ['lofi', 'ambient', 'cinematic', 'edm', 'jazz', 'rock', 'classical', 'trap'];

const VOICE_PHRASES = [
  { id: 'low', label: 'Low hum', prompt: 'Hum a comfortable low note for 2-3 seconds.' },
  { id: 'mid', label: 'Spoken phrase', prompt: 'Say "the quick brown fox jumps over the lazy dog" naturally.' },
  { id: 'high', label: 'High hum', prompt: 'Hum a comfortable high note for 2-3 seconds.' },
];

function getIndexHtml({ apiBaseUrl = '' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Rounsaville AI Music Generator</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, sans-serif;
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1rem 4rem;
    background: #0b0d12;
    color: #e8e8ec;
  }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  .subtitle { color: #9a9aa5; margin-top: 0; }
  section {
    background: #14161d;
    border: 1px solid #23262f;
    border-radius: 12px;
    padding: 1.25rem;
    margin: 1.25rem 0;
  }
  section h2 { font-size: 1rem; margin-top: 0; }
  .disclaimer { font-size: 0.85rem; color: #9a9aa5; border-left: 3px solid #3a3f4d; padding-left: 0.75rem; }
  label { display: block; font-size: 0.85rem; color: #b6b6c0; margin: 0.75rem 0 0.25rem; }
  textarea, select, input[type="text"] {
    width: 100%; font: inherit; padding: 0.5rem;
    background: #1c1f28; color: inherit; border: 1px solid #2c303c; border-radius: 8px;
  }
  textarea { height: 4.5rem; resize: vertical; }
  .row { display: flex; gap: 1rem; align-items: center; }
  .row > * { flex: 1; }
  input[type="range"] { width: 100%; }
  .toggle { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.75rem; }
  .toggle input { width: auto; }
  button {
    padding: 0.6rem 1.1rem; font: inherit; cursor: pointer;
    background: #3b5bdb; color: white; border: none; border-radius: 8px;
  }
  button.secondary { background: #262a35; color: #e8e8ec; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button + button { margin-left: 0.5rem; }
  #status { color: #9a9aa5; min-height: 1.2em; margin-top: 0.5rem; }
  audio { width: 100%; margin-top: 0.75rem; }
  .stats { display: flex; gap: 2rem; margin: 0.5rem 0 1rem; }
  .stats div span { display: block; }
  .stats .label { font-size: 0.75rem; color: #9a9aa5; text-transform: uppercase; }
  .stats .value { font-size: 1.1rem; font-weight: 600; }
  ul.history { list-style: none; padding: 0; margin: 0; }
  ul.history li {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.5rem 0; border-top: 1px solid #23262f;
  }
  ul.history li:first-child { border-top: none; }
  ul.history .meta { font-size: 0.8rem; color: #9a9aa5; }
  ul.history .actions { display: flex; align-items: center; gap: 0.4rem; }
  .rate-btn { background: none; border: none; padding: 0.2rem; font-size: 1rem; cursor: pointer; opacity: 0.4; }
  .rate-btn.active { opacity: 1; }
  #downloadLink { color: #8aa4ff; }
  .phrase { border-top: 1px solid #23262f; padding: 0.75rem 0; }
  .phrase:first-child { border-top: none; }
  .phrase .prompt { font-size: 0.85rem; color: #b6b6c0; margin: 0.25rem 0 0.5rem; }
  .badge { font-size: 0.75rem; padding: 0.1rem 0.5rem; border-radius: 999px; background: #1f3d2b; color: #7fd99a; }
  .badge.pending { background: #2a2d38; color: #9a9aa5; }
  pre { background: #1c1f28; padding: 0.75rem; overflow: auto; border-radius: 8px; font-size: 0.8rem; }
</style>
</head>
<body>
<h1>Rounsaville AI Music Generator</h1>
<p class="subtitle">Describe a track, generate it, and optionally shape the vocal line to your own voice.</p>

<section id="studio">
  <h2>Studio</h2>
  <label for="prompt">Prompt</label>
  <textarea id="prompt" placeholder="e.g. an energetic edm track in A minor at 128 bpm"></textarea>

  <div class="row">
    <div>
      <label for="style">Style</label>
      <select id="style">${GENRES.map((g) => `<option value="${g}">${g}</option>`).join('')}</select>
    </div>
    <div>
      <label for="bpm">BPM: <span id="bpmValue">120</span></label>
      <input type="range" id="bpm" min="40" max="220" value="120" />
    </div>
    <div>
      <label for="bars">Length (bars): <span id="barsValue">8</span></label>
      <input type="range" id="bars" min="1" max="32" value="8" />
    </div>
  </div>

  <div class="row">
    <div>
      <label for="pitchBend">Pitch bend (semitones): <span id="pitchBendValue">0</span></label>
      <input type="range" id="pitchBend" min="-12" max="12" value="0" />
    </div>
    <div>
      <label for="tempoStretch">Tempo stretch: <span id="tempoStretchValue">1.0x</span></label>
      <input type="range" id="tempoStretch" min="50" max="200" value="100" />
    </div>
  </div>
  <p class="disclaimer" style="margin-top:0.5rem;">
    Both are applied to the already-rendered mix with a real phase vocoder (STFT phase
    unwrapping + overlap-add resynthesis) &mdash; pitch bend changes pitch without changing
    length; tempo stretch changes length without changing pitch.
  </p>

  <div class="toggle">
    <input type="checkbox" id="instrumental" checked />
    <label for="instrumental" style="margin:0;">Instrumental (no vocal line)</label>
  </div>
  <div class="toggle">
    <input type="checkbox" id="useVoiceProfile" disabled />
    <label for="useVoiceProfile" style="margin:0;">Use my recorded voice profile for the vocal range</label>
  </div>

  <div style="margin-top:1rem;">
    <button id="generate">Generate Track</button>
    <button class="secondary" id="regenerate" disabled title="Regenerate the exact same track from its seed">Regenerate (same seed)</button>
  </div>
  <p id="status"></p>
  <audio id="player" controls></audio>
  <div id="playerActions" hidden style="margin-top:0.5rem;">
    <a id="downloadLink" download="track.wav">Download WAV</a>
    <span style="margin-left:1rem; font-size:0.8rem; color:#9a9aa5;">Seed: <span id="seedValue"></span></span>
    <button class="secondary" id="playLive" style="margin-left:1rem;" title="Synthesize this composition live in the browser instead of playing the server-rendered file">Play Live (browser synth)</button>
    <button class="secondary" id="stopLive" hidden>Stop</button>
  </div>
  <p class="disclaimer" style="margin-top:0.75rem;">
    "Play Live" doesn't play the WAV above &mdash; it synthesizes the composition (notes, chords,
    timing) directly in your browser via the Web Audio API, in real time, at the moment you click
    play. The audio genuinely isn't fixed until then. Its <code>pluck</code> timbre is an
    approximation (a fast-decaying oscillator) of the server's real Karplus-Strong physical
    modeling, since that needs an AudioWorklet this page doesn't include.
  </p>
</section>

<section id="history">
  <h2>Track History</h2>
  <div class="stats">
    <div><span class="label">System status</span><span class="value" id="systemStatus">Idle</span></div>
    <div><span class="label">Total tracks</span><span class="value" id="totalTracks">0</span></div>
  </div>
  <ul class="history" id="historyList"></ul>
  <div style="margin-top:0.75rem;">
    <button class="secondary" id="clearHistory">Clear history</button>
  </div>
</section>

<section id="voice">
  <h2>Voice Profile</h2>
  <p class="disclaimer">
    Recording calibrates the synthesizer's vocal <em>pitch range</em> to your voice by measuring
    it directly from the audio (autocorrelation pitch detection). This is <strong>not</strong>
    neural voice cloning or text-to-speech in your voice &mdash; it does not reproduce your
    timbre, only the note range the vocal line stays within. Works best in Chrome/Edge.
  </p>
  <div id="phrases"></div>
  <div style="margin-top:0.75rem;">
    <button id="analyzeVoice" disabled>Analyze Voice</button>
    <button class="secondary" id="clearVoice">Clear voice profile</button>
  </div>
  <p id="voiceStatus"></p>
  <pre id="voiceProfileOut" hidden></pre>
</section>

<script>
(function () {
  var apiBaseUrl = ${JSON.stringify(apiBaseUrl)};
  var VOICE_PHRASES = ${JSON.stringify(VOICE_PHRASES)};
  var HISTORY_KEY = 'rounsaville-music:history';
  var VOICE_KEY = 'rounsaville-music:voiceProfile';
  var MAX_HISTORY = 20; // history entries are now small metadata (no audio), so this can be generous

  var statusEl = document.getElementById('status');
  var playerEl = document.getElementById('player');
  var systemStatusEl = document.getElementById('systemStatus');
  var totalTracksEl = document.getElementById('totalTracks');
  var historyListEl = document.getElementById('historyList');
  var useVoiceProfileEl = document.getElementById('useVoiceProfile');
  var instrumentalEl = document.getElementById('instrumental');
  var bpmEl = document.getElementById('bpm');
  var bpmValueEl = document.getElementById('bpmValue');
  var barsEl = document.getElementById('bars');
  var barsValueEl = document.getElementById('barsValue');
  var pitchBendEl = document.getElementById('pitchBend');
  var pitchBendValueEl = document.getElementById('pitchBendValue');
  var tempoStretchEl = document.getElementById('tempoStretch');
  var tempoStretchValueEl = document.getElementById('tempoStretchValue');
  var regenerateEl = document.getElementById('regenerate');
  var playerActionsEl = document.getElementById('playerActions');
  var downloadLinkEl = document.getElementById('downloadLink');
  var seedValueEl = document.getElementById('seedValue');
  var lastSeed = null;
  var lastComposition = null;

  bpmEl.addEventListener('input', function () { bpmValueEl.textContent = bpmEl.value; });
  barsEl.addEventListener('input', function () { barsValueEl.textContent = barsEl.value; });
  pitchBendEl.addEventListener('input', function () { pitchBendValueEl.textContent = pitchBendEl.value; });
  tempoStretchEl.addEventListener('input', function () {
    tempoStretchValueEl.textContent = (tempoStretchEl.value / 100).toFixed(2) + 'x';
  });

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch (e) { return []; }
  }
  function saveHistory(list) { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); }

  function loadVoiceProfile() {
    try { return JSON.parse(localStorage.getItem(VOICE_KEY)) || null; } catch (e) { return null; }
  }
  function saveVoiceProfile(profile) { localStorage.setItem(VOICE_KEY, JSON.stringify(profile)); }

  // Generation is deterministic given the same request + seed, so history
  // only needs to remember the *recipe* (prompt/instrumental/voiceProfile
  // + seed), not the rendered audio — storing every track's full WAV
  // blew the localStorage quota after just a couple of tracks once the
  // renderer went stereo. Re-fetching on Play costs a network round trip
  // but reproduces the exact same audio.
  function playAudioBase64(base64Wav, meta) {
    LiveSynth.stop();
    playerEl.src = 'data:audio/wav;base64,' + base64Wav;
    playerEl.play();
    lastSeed = meta.seed;
    lastComposition = meta.composition || null;
    playerActionsEl.hidden = false;
    downloadLinkEl.href = 'data:audio/wav;base64,' + base64Wav;
    downloadLinkEl.download = meta.title + '.wav';
    seedValueEl.textContent = String(meta.seed);
    regenerateEl.disabled = false;
    document.getElementById('playLive').disabled = !lastComposition;
  }

  async function playFromHistory(entry) {
    statusEl.textContent = 'Loading...';
    try {
      var res = await fetch(apiBaseUrl + '/api/generate', {
        method: 'POST',
        body: JSON.stringify(Object.assign({}, entry.payload, { seed: entry.seed, format: 'json' })),
      });
      if (!res.ok) throw new Error('failed to regenerate track (status ' + res.status + ')');
      var body = await res.json();
      playAudioBase64(body.audio.base64Wav, { title: entry.title, seed: entry.seed, composition: body.composition });
      statusEl.textContent = 'Done.';
    } catch (err) {
      statusEl.textContent = 'Error: ' + err.message;
    }
  }

  function setRating(trackId, rating) {
    var history = loadHistory();
    history.forEach(function (t) {
      if (t.id === trackId) t.rating = t.rating === rating ? null : rating; // click again to clear
    });
    saveHistory(history);
    renderHistory();
  }

  function renderHistory() {
    var history = loadHistory();
    totalTracksEl.textContent = String(history.length);
    historyListEl.innerHTML = '';
    history.forEach(function (track) {
      var li = document.createElement('li');
      var left = document.createElement('div');
      left.innerHTML = '<strong>' + track.title + '</strong><div class="meta">' +
        track.style + ' \\u00b7 ' + track.bpm + ' bpm \\u00b7 ' + track.bars + ' bars \\u00b7 seed ' + track.seed + '</div>';

      var actions = document.createElement('div');
      actions.className = 'actions';

      var upBtn = document.createElement('button');
      upBtn.className = 'rate-btn' + (track.rating === 'up' ? ' active' : '');
      upBtn.textContent = '\\ud83d\\udc4d';
      upBtn.title = 'Good track';
      upBtn.addEventListener('click', function () { setRating(track.id, 'up'); });

      var downBtn = document.createElement('button');
      downBtn.className = 'rate-btn' + (track.rating === 'down' ? ' active' : '');
      downBtn.textContent = '\\ud83d\\udc4e';
      downBtn.title = 'Not great';
      downBtn.addEventListener('click', function () { setRating(track.id, 'down'); });

      var playBtn = document.createElement('button');
      playBtn.textContent = 'Play';
      playBtn.className = 'secondary';
      playBtn.addEventListener('click', function () { playFromHistory(track); });

      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      actions.appendChild(playBtn);
      li.appendChild(left);
      li.appendChild(actions);
      historyListEl.appendChild(li);
    });
  }

  function refreshVoiceToggle() {
    var profile = loadVoiceProfile();
    useVoiceProfileEl.disabled = !profile;
    if (!profile) useVoiceProfileEl.checked = false;
  }

  document.getElementById('clearHistory').addEventListener('click', function () {
    saveHistory([]);
    renderHistory();
  });

  async function runGeneration(seedOverride) {
    var prompt = document.getElementById('prompt').value.trim();
    var style = document.getElementById('style').value;
    var bpm = bpmEl.value;
    var bars = barsEl.value;
    var instrumental = instrumentalEl.checked;
    var fullPrompt = (prompt || ('a track in the ' + style + ' style')) +
      ', ' + style + ' style, ' + bpm + ' bpm, ' + bars + ' bars' +
      (instrumental ? ', instrumental' : '');

    statusEl.textContent = seedOverride != null ? 'Regenerating...' : 'Generating...';
    systemStatusEl.textContent = 'Synthesizing...';
    try {
      var payload = { prompt: fullPrompt, instrumental: instrumental, format: 'json' };
      if (seedOverride != null) payload.seed = seedOverride;
      if (!instrumental && useVoiceProfileEl.checked) {
        var profile = loadVoiceProfile();
        if (profile) payload.voiceProfile = profile;
      }
      var pitchSemitones = Number(pitchBendEl.value);
      if (pitchSemitones !== 0) payload.pitchSemitones = pitchSemitones;
      var tempoStretch = Number(tempoStretchEl.value) / 100;
      if (tempoStretch !== 1) payload.tempoStretch = tempoStretch;
      var res = await fetch(apiBaseUrl + '/api/generate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        throw new Error(errBody.error || ('generation failed: ' + res.status));
      }
      var body = await res.json();
      playAudioBase64(body.audio.base64Wav, { title: body.composition.title, seed: body.seed, composition: body.composition });

      var historyEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        title: body.composition.title,
        style: style,
        bpm: body.composition.tempo,
        bars: body.composition.bars,
        seed: body.seed,
        payload: { prompt: fullPrompt, instrumental: instrumental, voiceProfile: payload.voiceProfile },
        rating: null,
        createdAt: Date.now(),
      };
      var history = loadHistory();
      history.unshift(historyEntry);
      saveHistory(history.slice(0, MAX_HISTORY));
      renderHistory();

      statusEl.textContent = 'Done.';
    } catch (err) {
      statusEl.textContent = 'Error: ' + err.message;
    } finally {
      systemStatusEl.textContent = 'Idle';
    }
  }

  document.getElementById('generate').addEventListener('click', function () { runGeneration(null); });
  regenerateEl.addEventListener('click', function () {
    if (lastSeed != null) runGeneration(lastSeed);
  });

  // --- Voice profile recording ---
  var recordings = {}; // phraseId -> base64 WAV

  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    var chunkSize = 0x8000;
    for (var i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function encodeWavFromAudioBuffer(audioBuffer) {
    var samples = audioBuffer.getChannelData(0);
    var sampleRate = audioBuffer.sampleRate;
    var pcm = new Int16Array(samples.length);
    for (var i = 0; i < samples.length; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    var dataSize = pcm.length * 2;
    var buffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(buffer);
    function writeString(offset, str) {
      for (var j = 0; j < str.length; j++) view.setUint8(offset + j, str.charCodeAt(j));
    }
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    for (var k = 0; k < pcm.length; k++) view.setInt16(44 + k * 2, pcm[k], true);
    return arrayBufferToBase64(buffer);
  }

  function renderPhrases() {
    var container = document.getElementById('phrases');
    container.innerHTML = '';
    VOICE_PHRASES.forEach(function (phrase) {
      var div = document.createElement('div');
      div.className = 'phrase';
      var badge = recordings[phrase.id] ? '<span class="badge">recorded</span>' : '<span class="badge pending">not recorded</span>';
      div.innerHTML = '<strong>' + phrase.label + '</strong> ' + badge +
        '<div class="prompt">' + phrase.prompt + '</div>';
      var btn = document.createElement('button');
      btn.className = 'secondary';
      btn.textContent = 'Record';
      btn.addEventListener('click', function () { recordPhrase(phrase.id, btn); });
      div.appendChild(btn);
      container.appendChild(div);
    });
    document.getElementById('analyzeVoice').disabled = Object.keys(recordings).length === 0;
  }

  async function recordPhrase(phraseId, btn) {
    var voiceStatusEl = document.getElementById('voiceStatus');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      voiceStatusEl.textContent = 'Microphone recording is not supported in this browser.';
      return;
    }
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      var recorder = new MediaRecorder(stream);
      var chunks = [];
      recorder.addEventListener('dataavailable', function (e) { if (e.data.size > 0) chunks.push(e.data); });

      var stopped = new Promise(function (resolve) {
        recorder.addEventListener('stop', resolve, { once: true });
      });

      btn.textContent = 'Recording... (3s)';
      btn.disabled = true;
      recorder.start();
      await new Promise(function (resolve) { setTimeout(resolve, 3000); });
      recorder.stop();
      await stopped;
      stream.getTracks().forEach(function (t) { t.stop(); });

      var blob = new Blob(chunks, { type: recorder.mimeType });
      var arrayBuffer = await blob.arrayBuffer();
      var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      recordings[phraseId] = encodeWavFromAudioBuffer(audioBuffer);
      audioCtx.close();

      btn.textContent = 'Re-record';
      btn.disabled = false;
      renderPhrases();
    } catch (err) {
      voiceStatusEl.textContent = 'Recording failed: ' + err.message;
      btn.textContent = 'Record';
      btn.disabled = false;
    }
  }

  document.getElementById('analyzeVoice').addEventListener('click', async function () {
    var voiceStatusEl = document.getElementById('voiceStatus');
    var outEl = document.getElementById('voiceProfileOut');
    var samples = Object.keys(recordings).map(function (id) { return recordings[id]; });
    if (samples.length === 0) return;

    voiceStatusEl.textContent = 'Analyzing...';
    try {
      var res = await fetch(apiBaseUrl + '/api/voice-profile', {
        method: 'POST',
        body: JSON.stringify({ samples: samples }),
      });
      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        throw new Error(errBody.error || ('analysis failed: ' + res.status));
      }
      var body = await res.json();
      saveVoiceProfile(body.voiceProfile);
      refreshVoiceToggle();
      outEl.hidden = false;
      outEl.textContent = JSON.stringify(body.voiceProfile, null, 2);
      voiceStatusEl.textContent = 'Voice profile saved.';
    } catch (err) {
      voiceStatusEl.textContent = 'Error: ' + err.message;
    }
  });

  document.getElementById('clearVoice').addEventListener('click', function () {
    recordings = {};
    localStorage.removeItem(VOICE_KEY);
    refreshVoiceToggle();
    renderPhrases();
    document.getElementById('voiceProfileOut').hidden = true;
    document.getElementById('voiceStatus').textContent = 'Voice profile cleared.';
  });

  // --- Deferred/parametric client-side rendering ---
  // Instead of playing the server-rendered WAV, synthesizes the
  // composition (notes/chords/timing) live in the browser via the Web
  // Audio API, using native oscillators/gain-automation/delay nodes that
  // mirror 003_AUDIO_ENGINE/SynthEngine's real waveforms and ADSR shape.
  // The audio genuinely doesn't exist as fixed samples until this runs.
  var LiveSynth = (function () {
    var audioCtx = null;
    var activeNodes = [];

    function midiToFrequency(midi) {
      return 440 * Math.pow(2, (midi - 69) / 12);
    }

    function scheduleNote(ctx, trackGain, waveform, note, beatSeconds, startTime) {
      var frequency = midiToFrequency(note.pitch);
      var duration = Math.max(0.02, note.duration * beatSeconds);
      var amplitude = (note.velocity || 100) / 127;
      var noteStart = startTime + note.start * beatSeconds;
      var noteEnd = noteStart + duration;

      var envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0, noteStart);
      envelope.connect(trackGain);

      var oscillators = [];

      if (waveform === 'pad') {
        [-7, 0, 7].forEach(function (cents) {
          var osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(frequency * Math.pow(2, cents / 1200), noteStart);
          osc.connect(envelope);
          oscillators.push(osc);
        });
        var padPeak = amplitude / 3;
        var padSustain = padPeak * 0.85;
        envelope.gain.linearRampToValueAtTime(padPeak, noteStart + 0.15);
        envelope.gain.linearRampToValueAtTime(padSustain, noteStart + 0.25);
        envelope.gain.setValueAtTime(padSustain, Math.max(noteStart + 0.25, noteEnd - 0.3));
        envelope.gain.linearRampToValueAtTime(0.0001, noteEnd);
      } else if (waveform === 'pluck') {
        // Approximation of the server's Karplus-Strong physical modeling:
        // a fast-decaying sawtooth. Real-time physical modeling would
        // need an AudioWorklet, which this page doesn't include.
        var pluckOsc = ctx.createOscillator();
        pluckOsc.type = 'sawtooth';
        pluckOsc.frequency.setValueAtTime(frequency, noteStart);
        pluckOsc.connect(envelope);
        oscillators.push(pluckOsc);
        envelope.gain.setValueAtTime(amplitude, noteStart);
        envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, amplitude * 0.01), noteEnd);
      } else {
        var oscType = waveform === 'saw' ? 'sawtooth' : ['sine', 'square', 'triangle'].indexOf(waveform) >= 0 ? waveform : 'sine';
        var osc = ctx.createOscillator();
        osc.type = oscType;
        osc.frequency.setValueAtTime(frequency, noteStart);
        osc.connect(envelope);
        oscillators.push(osc);
        var sustain = amplitude * 0.8;
        envelope.gain.linearRampToValueAtTime(amplitude, noteStart + 0.01);
        envelope.gain.linearRampToValueAtTime(sustain, noteStart + 0.06);
        envelope.gain.setValueAtTime(sustain, Math.max(noteStart + 0.06, noteEnd - 0.08));
        envelope.gain.linearRampToValueAtTime(0.0001, noteEnd);
      }

      oscillators.forEach(function (osc) {
        osc.start(noteStart);
        osc.stop(noteEnd + 0.05);
        activeNodes.push(osc);
      });
      activeNodes.push(envelope);
    }

    function play(composition) {
      stop();
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtx = ctx;
      var beatSeconds = 60 / composition.tempo;
      var startTime = ctx.currentTime + 0.1;

      var master = ctx.createGain();
      master.gain.value = 0.9;
      var compressor = ctx.createDynamicsCompressor(); // native real limiter/compressor
      master.connect(compressor);
      compressor.connect(ctx.destination);

      // A simple native feedback-delay reverb bus (two delay lines with
      // feedback) — a lighter, real-time-friendly cousin of the server's
      // comb/allpass Schroeder reverb, not the same algorithm, but the
      // same idea: pure delay-line feedback, no impulse-response sample.
      var roomSize = (composition.reverb && composition.reverb.roomSize) || 0.5;
      var wet = (composition.reverb && composition.reverb.wet) || 0.2;
      var reverbSend = ctx.createGain();
      reverbSend.gain.value = wet;
      [0.035, 0.061].forEach(function (baseDelay) {
        var delay = ctx.createDelay(1);
        delay.delayTime.value = baseDelay + roomSize * 0.05;
        var feedback = ctx.createGain();
        feedback.gain.value = 0.25 + roomSize * 0.4;
        reverbSend.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(master);
        activeNodes.push(delay, feedback);
      });
      activeNodes.push(master, compressor, reverbSend);

      composition.tracks.forEach(function (track) {
        var trackGain = ctx.createGain();
        trackGain.gain.value = track.gain != null ? track.gain : 0.8;
        if (ctx.createStereoPanner) {
          var panner = ctx.createStereoPanner();
          panner.pan.value = track.pan || 0;
          trackGain.connect(panner);
          panner.connect(master);
          panner.connect(reverbSend);
          activeNodes.push(panner);
        } else {
          trackGain.connect(master);
          trackGain.connect(reverbSend);
        }
        activeNodes.push(trackGain);

        track.notes.forEach(function (note) {
          scheduleNote(ctx, trackGain, track.waveform, note, beatSeconds, startTime);
        });
      });
    }

    function stop() {
      activeNodes.forEach(function (node) {
        try { if (node.stop) node.stop(0); } catch (e) { /* already stopped */ }
        try { node.disconnect(); } catch (e) { /* already disconnected */ }
      });
      activeNodes = [];
      if (audioCtx) {
        try { audioCtx.close(); } catch (e) { /* already closed */ }
        audioCtx = null;
      }
    }

    return { play: play, stop: stop };
  })();

  document.getElementById('playLive').addEventListener('click', function () {
    if (!lastComposition) return;
    LiveSynth.play(lastComposition);
    document.getElementById('stopLive').hidden = false;
    statusEl.textContent = 'Playing live (browser synth).';
  });

  document.getElementById('stopLive').addEventListener('click', function () {
    LiveSynth.stop();
    document.getElementById('stopLive').hidden = true;
  });

  renderHistory();
  refreshVoiceToggle();
  renderPhrases();
})();
</script>
</body>
</html>`;
}

// In production this page is served from the same origin as /api/* — on
// Netlify via netlify.toml's redirect, and in principle behind any reverse
// proxy that unifies the two. For plain local dev, where WebUI and
// REST_API are two separate http.Server instances on two separate ports,
// the page's own relative /api/* fetches would otherwise 404 against this
// server. apiProxyTarget (e.g. "http://127.0.0.1:4000") makes this server
// forward /api/* requests to a real REST_API instance so `npm start`-style
// local usage works without any extra setup.
function proxyApiRequest(req, res, target) {
  const targetUrl = new URL(req.url, target);
  const proxyReq = http.request(
    targetUrl,
    { method: req.method, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream API unreachable' }));
  });
  req.pipe(proxyReq);
}

function createStaticServer({ apiBaseUrl = '', apiProxyTarget = null } = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (apiProxyTarget && url.pathname.startsWith('/api/')) {
      return proxyApiRequest(req, res, apiProxyTarget);
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = getIndexHtml({ apiBaseUrl });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
}

function startWebUI(port = 0, options = {}) {
  const server = createStaticServer(options);
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

module.exports = { getIndexHtml, createStaticServer, startWebUI, GENRES, VOICE_PHRASES };
