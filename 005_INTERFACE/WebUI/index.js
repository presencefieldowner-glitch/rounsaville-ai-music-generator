'use strict';

const http = require('node:http');

// Self-contained studio frontend for the ecosystem: prompt + style/BPM/
// bars/instrumental controls, a client-side track history (localStorage,
// since neither the local REST_API's stateless routes nor the Netlify
// functions keep server-side history), and a voice profile recorder.
// No build step, no framework. Talks to /api/generate and
// /api/voice-profile — same paths locally (005_INTERFACE/REST_API) and on
// Netlify (netlify.toml redirects /api/* to the functions directory).

const GENRES = ['lofi', 'ambient', 'cinematic', 'edm', 'jazz', 'rock', 'classical', 'trap', 'rap', 'country'];

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
<meta name="theme-color" content="#D6D9CF" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800;900&family=Hanken+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --chassis: #D6D9CF;
    --panel: #ECEEE7;
    --ink: #1A1C19;
    --muted: #555A52;
    --line: #B3B8AB;
    --screen: #121C19;
    --trace: #F2B84B;
    --blue: #2D49D6;
    --blue-dark: #2238A8;
    --rec: #CF3A2E;
    --display: "Big Shoulders Display", "Arial Narrow", Impact, sans-serif;
    --body: "Hanken Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif;
    --gutter: clamp(14px, 3.5vw, 40px);
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    background: var(--chassis);
    color: var(--ink);
    font: 400 1rem/1.5 var(--body);
  }
  :focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
  .page { max-width: 1180px; margin: 0 auto; padding: 0 var(--gutter) 64px; }

  /* masthead */
  .masthead { padding: clamp(22px, 4vw, 44px) 0 clamp(18px, 3vw, 30px); }
  h1 {
    font: 900 clamp(2.6rem, 8vw, 5.6rem)/0.86 var(--display);
    letter-spacing: -0.005em;
    margin: 0;
    text-transform: uppercase;
  }
  h1 span { display: block; font-weight: 700; font-size: 0.42em; letter-spacing: 0.02em; margin-top: 0.35em; color: var(--muted); }
  .subtitle { max-width: 36em; color: var(--muted); margin: 14px 0 0; }

  /* layout */
  .console { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr); gap: clamp(22px, 3vw, 44px); align-items: start; }
  .col-right { position: sticky; top: 14px; display: grid; gap: 22px; }
  .lower { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(22px, 3vw, 44px); margin-top: clamp(28px, 4vw, 52px); align-items: start; }
  @media (max-width: 900px) {
    .console, .lower { grid-template-columns: 1fr; }
    .col-right { position: static; }
  }

  h2 { font: 800 1.7rem/1 var(--display); text-transform: uppercase; letter-spacing: 0.01em; margin: 0 0 14px; }
  h3 { font: 700 1.05rem/1.2 var(--body); margin: 0; }
  .block { border-top: 3px solid var(--ink); padding-top: 14px; }
  .block + .block { margin-top: 26px; }

  /* form controls */
  label { display: block; font-size: 0.9rem; font-weight: 700; margin: 0 0 6px; }
  textarea, select {
    width: 100%; font: inherit; padding: 11px 12px;
    background: var(--panel); color: var(--ink);
    border: 1.5px solid var(--ink); border-radius: 3px;
  }
  textarea { height: 5.2rem; resize: vertical; }
  .field { margin-top: 16px; }
  .field:first-of-type { margin-top: 0; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 520px) { .grid2 { grid-template-columns: 1fr; } }
  .val { font-variant-numeric: tabular-nums; color: var(--blue-dark); }

  input[type="range"] { -webkit-appearance: none; appearance: none; width: 100%; height: 28px; background: transparent; margin: 0; }
  input[type="range"]::-webkit-slider-runnable-track { height: 4px; background: var(--ink); border-radius: 2px; }
  input[type="range"]::-moz-range-track { height: 4px; background: var(--ink); border-radius: 2px; }
  input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 26px; margin-top: -11px; background: var(--blue); border: 2px solid var(--panel); border-radius: 3px; box-shadow: 0 0 0 1.5px var(--ink); }
  input[type="range"]::-moz-range-thumb { width: 14px; height: 22px; background: var(--blue); border: 2px solid var(--panel); border-radius: 3px; box-shadow: 0 0 0 1.5px var(--ink); }

  .faders { display: flex; gap: 8px; justify-content: space-between; }
  .fader { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .fader label { margin: 0; text-align: center; font-size: 0.85rem; }
  .fader input[type="range"] { writing-mode: vertical-lr; direction: rtl; width: 28px; height: 130px; }
  .fader input[type="range"]::-webkit-slider-runnable-track { width: 4px; height: 100%; }
  .fader input[type="range"]::-webkit-slider-thumb { width: 26px; height: 18px; margin-top: 0; margin-left: -11px; }

  .checks { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; }
  @media (max-width: 520px) { .checks { grid-template-columns: 1fr; } }
  .toggle { display: flex; align-items: center; gap: 10px; min-height: 38px; }
  .toggle input { width: 20px; height: 20px; margin: 0; accent-color: var(--blue); flex: none; }
  .toggle label { margin: 0; font-weight: 500; }
  .toggle.wide { grid-column: 1 / -1; }

  .note { font-size: 0.86rem; color: var(--muted); margin: 10px 0 0; max-width: 46em; }
  .note strong { color: var(--ink); }

  details.group { border-top: 1px solid var(--line); margin-top: 18px; padding-top: 4px; }
  details.group > summary { list-style: none; cursor: pointer; display: flex; justify-content: space-between; align-items: center; min-height: 44px; font-weight: 700; }
  details.group > summary::-webkit-details-marker { display: none; }
  details.group > summary::after { content: "+"; font: 800 1.5rem/1 var(--display); color: var(--blue); }
  details.group[open] > summary::after { content: "\\2212"; }
  details.group > .inner { padding: 4px 0 6px; }

  /* buttons */
  button {
    font: 700 1rem/1 var(--body); cursor: pointer;
    padding: 14px 20px; min-height: 46px;
    background: var(--blue); color: #fff; border: 0; border-radius: 3px;
  }
  button:hover { background: var(--blue-dark); }
  button.secondary { background: transparent; color: var(--ink); border: 1.5px solid var(--ink); padding: 11px 16px; min-height: 42px; }
  button.secondary:hover { background: var(--ink); color: var(--panel); }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  button:disabled:hover { background: var(--blue); }
  button.secondary:disabled:hover { background: transparent; color: var(--ink); }
  button.record { background: var(--rec); }
  button.record:hover { background: #A92C22; }
  .actions-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
  #status { min-height: 1.4em; margin: 12px 0 0; color: var(--muted); }

  /* monitor */
  .bezel { background: var(--ink); padding: 12px; border-radius: 10px; }
  .screen { background: var(--screen); border-radius: 4px; padding: 12px 12px 10px; color: #E6EEE8; }
  .screen-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 8px; }
  #trackTitle { font: 800 1.5rem/1 var(--display); letter-spacing: 0.01em; text-transform: uppercase; color: var(--trace); overflow-wrap: anywhere; }
  .screen-head small { color: #9DB0A8; font-size: 0.82rem; white-space: nowrap; font-variant-numeric: tabular-nums; }
  #scope { display: block; width: 100%; height: 200px; border-radius: 2px; }
  audio { display: block; width: 100%; margin-top: 12px; }
  #playerActions { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; }
  #playerActions[hidden] { display: none; }
  #downloadLink { color: var(--blue-dark); font-weight: 700; }
  .seedline { font-size: 0.85rem; color: var(--muted); font-variant-numeric: tabular-nums; }

  /* history */
  .stats { display: flex; gap: 32px; margin: 0 0 12px; }
  .stats .label { display: block; font-size: 0.82rem; color: var(--muted); }
  .stats .value { display: block; font: 800 1.7rem/1.05 var(--display); text-transform: uppercase; }
  ul.history { list-style: none; padding: 0; margin: 0; }
  ul.history li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
  ul.history .meta { font-size: 0.82rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  ul.history .actions { display: flex; align-items: center; gap: 6px; flex: none; }
  .rate-btn { background: none; border: 0; padding: 6px; min-height: 38px; min-width: 38px; font-size: 1.05rem; cursor: pointer; opacity: 0.4; color: inherit; }
  .rate-btn:hover { background: none; opacity: 0.8; }
  .rate-btn.active { opacity: 1; }

  /* lyrics + voice */
  #lyricsStatus { margin-left: 10px; font-size: 0.9rem; color: var(--muted); }
  #lyricsTitle { font: 800 1.5rem/1.05 var(--display); text-transform: uppercase; margin: 16px 0 8px; }
  .phrase { border-top: 1px solid var(--line); padding: 12px 0; }
  .phrase .prompt { font-size: 0.9rem; color: var(--muted); margin: 4px 0 10px; }
  .phrase .said { font-style: italic; color: var(--ink); }
  .badge { font-size: 0.78rem; padding: 2px 9px; border-radius: 99px; background: #CFE3D2; color: #1D5A2C; font-weight: 700; }
  .badge.pending { background: #DDDFD6; color: var(--muted); }
  pre { background: var(--panel); border: 1.5px solid var(--ink); padding: 12px; overflow: auto; border-radius: 3px; font-size: 0.82rem; }
  code { background: var(--panel); padding: 1px 5px; border-radius: 3px; }
  #voiceStatus { color: var(--muted); }
</style>
</head>
<body>
<div class="page">

<header class="masthead">
  <h1>Rounsaville<span>AI Music Generator</span></h1>
  <p class="subtitle">Describe a track, generate it, and optionally shape the vocal line to your own voice.</p>
</header>

<div class="console">

  <section id="studio" class="block" aria-labelledby="studioHead">
    <h2 id="studioHead">Studio</h2>

    <div class="field">
      <label for="prompt">Prompt</label>
      <textarea id="prompt" placeholder="e.g. an energetic edm track in A minor at 128 bpm"></textarea>
    </div>

    <div class="field">
      <label for="style">Style</label>
      <select id="style" title="Each style is a real, distinct treatment: its own chord progression, timbre, reverb space, timing feel (rap/trap/edm are grid-tight, jazz/country are humanized), stereo width, and mastering profile (EQ curve + limiter threshold)">${GENRES.map((g) => `<option value="${g}">${g}</option>`).join('')}</select>
      <p class="note">Each style is a distinct treatment: its own chord progression, timbre, reverb space, timing feel, stereo width and mastering profile.</p>
    </div>

    <div class="grid2 field">
      <div>
        <label for="bpm">BPM <span class="val" id="bpmValue">120</span></label>
        <input type="range" id="bpm" min="40" max="220" value="120" />
      </div>
      <div>
        <label for="bars">Length in bars <span class="val" id="barsValue">8</span></label>
        <input type="range" id="bars" min="1" max="32" value="8" />
      </div>
    </div>

    <details class="group" open>
      <summary>Pitch and tempo</summary>
      <div class="inner">
        <div class="grid2">
          <div>
            <label for="pitchBend">Pitch bend, semitones <span class="val" id="pitchBendValue">0</span></label>
            <input type="range" id="pitchBend" min="-12" max="12" value="0" />
          </div>
          <div>
            <label for="tempoStretch">Tempo stretch <span class="val" id="tempoStretchValue">1.0x</span></label>
            <input type="range" id="tempoStretch" min="50" max="200" value="100" />
          </div>
        </div>
        <p class="note">
          Both are applied to the already-rendered mix with a real phase vocoder (STFT phase
          unwrapping + overlap-add resynthesis) &mdash; pitch bend changes pitch without changing
          length; tempo stretch changes length without changing pitch.
        </p>
      </div>
    </details>

    <details class="group" open>
      <summary>Tone</summary>
      <div class="inner">
        <div class="faders">
          <div class="fader">
            <input type="range" id="bassDb" min="-12" max="12" value="0" aria-labelledby="bassLabel" />
            <label id="bassLabel" for="bassDb">Bass <span class="val"><span id="bassDbValue">0</span> dB</span></label>
          </div>
          <div class="fader">
            <input type="range" id="midDb" min="-12" max="12" value="0" aria-labelledby="midLabel" />
            <label id="midLabel" for="midDb">Mid <span class="val"><span id="midDbValue">0</span> dB</span></label>
          </div>
          <div class="fader">
            <input type="range" id="trebleDb" min="-12" max="12" value="0" aria-labelledby="trebleLabel" />
            <label id="trebleLabel" for="trebleDb">Treble <span class="val"><span id="trebleDbValue">0</span> dB</span></label>
          </div>
        </div>
        <p class="note">
          A real 3-band EQ &mdash; second-order biquad filters using the standard Audio EQ Cookbook
          formulas (low-shelf/peaking/high-shelf), applied server-side before final loudness
          normalization, not a cosmetic per-band multiply.
        </p>
      </div>
    </details>

    <details class="group" open>
      <summary>Arrangement</summary>
      <div class="inner">
        <div class="checks">
          <div class="toggle">
            <input type="checkbox" id="instrumental" checked />
            <label for="instrumental">Instrumental (no vocal line)</label>
          </div>
          <div class="toggle">
            <input type="checkbox" id="noDrums" />
            <label for="noDrums">No drums</label>
          </div>
          <div class="toggle">
            <input type="checkbox" id="noBass" />
            <label for="noBass">No bass</label>
          </div>
          <div class="toggle">
            <input type="checkbox" id="waltz" />
            <label for="waltz">Waltz (3/4 time)</label>
          </div>
          <div class="toggle wide">
            <input type="checkbox" id="useVoiceProfile" disabled />
            <label for="useVoiceProfile">Use my recorded voice profile for the vocal range</label>
          </div>
        </div>
        <p class="note">
          Waltz genuinely changes the rhythm grid the composer generates on (3 beats per bar with a
          distinct "oom-pah-pah" drum pattern), not just a metadata label &mdash; see
          004_COMPOSITION_AGENT/TrackGenerator.
        </p>
      </div>
    </details>

    <div class="actions-row">
      <button id="generate">Generate Track</button>
      <button class="secondary" id="regenerate" disabled title="Regenerate the exact same track from its seed">Regenerate (same seed)</button>
    </div>
    <p id="status" role="status" aria-live="polite"></p>
  </section>

  <div class="col-right">
    <section id="monitor" aria-label="Playback monitor">
      <div class="bezel">
        <div class="screen">
          <div class="screen-head">
            <span id="trackTitle">No track yet</span>
            <small id="scopeInfo">Notes appear here</small>
          </div>
          <canvas id="scope" role="img" aria-label="Piano-roll view of the generated track's notes with a moving playhead"></canvas>
        </div>
      </div>
      <audio id="player" controls></audio>
      <div id="playerActions" hidden>
        <a id="downloadLink" download="track.wav">Download WAV</a>
        <span class="seedline">Seed <span id="seedValue"></span></span>
        <button class="secondary" id="playLive" title="Synthesize this composition live in the browser instead of playing the server-rendered file">Play Live (browser synth)</button>
        <button class="secondary" id="stopLive" hidden>Stop</button>
      </div>
      <p class="note">
        "Play Live" doesn't play the WAV above &mdash; it synthesizes the composition (notes, chords,
        timing) directly in your browser via the Web Audio API, in real time, at the moment you click
        play. The audio genuinely isn't fixed until then. Its <code>pluck</code> timbre is an
        approximation (a fast-decaying oscillator) of the server's real Karplus-Strong physical
        modeling, since that needs an AudioWorklet this page doesn't include.
      </p>
    </section>

    <section id="history" class="block" aria-labelledby="historyHead">
      <h2 id="historyHead">Track History</h2>
      <div class="stats">
        <div><span class="label">System status</span><span class="value" id="systemStatus">Idle</span></div>
        <div><span class="label">Total tracks</span><span class="value" id="totalTracks">0</span></div>
      </div>
      <ul class="history" id="historyList"></ul>
      <div style="margin-top:12px;">
        <button class="secondary" id="clearHistory">Clear history</button>
      </div>
    </section>
  </div>

</div>

<div class="lower">
  <section id="lyrics" class="block" aria-labelledby="lyricsHead">
    <h2 id="lyricsHead">Lyrics</h2>
    <button class="secondary" id="generateLyrics">Generate Lyrics</button>
    <span id="lyricsStatus" role="status" aria-live="polite"></span>
    <div id="lyricsOutput" hidden>
      <h3 id="lyricsTitle"></h3>
      <div id="lyricsSections"></div>
    </div>
    <p class="note">
      Real, algorithmically generated lyrics &mdash; template-filled lines drawn from mood-themed
      word banks, with true rhymes (grouped by actual sound, not spelling) closing every second
      line. This is <strong>not</strong> an LLM. These words are <strong>never sung</strong> by the
      generated audio: the "vocal" track is a wordless, pitch-matched melody line (see
      003_AUDIO_ENGINE), since this system has no text-to-singing-voice synthesis. The phrases
      below (under Voice Profile) are drawn directly from these lyrics so recording them measures
      your pitch on the actual generated words &mdash; but it still does not make the output audio
      pronounce them, and it does not clone your voice's timbre.
    </p>
  </section>

  <section id="voice" class="block" aria-labelledby="voiceHead">
    <h2 id="voiceHead">Voice Profile</h2>
    <div id="phrases"></div>
    <div class="actions-row" style="margin-top:12px;">
      <button id="analyzeVoice" disabled>Analyze Voice</button>
      <button class="secondary" id="clearVoice">Clear voice profile</button>
    </div>
    <p id="voiceStatus" role="status" aria-live="polite"></p>
    <pre id="voiceProfileOut" hidden></pre>
    <p class="note">
      Recording calibrates the synthesizer's vocal <em>pitch range</em> to your voice by measuring
      it directly from the audio (autocorrelation pitch detection). This is <strong>not</strong>
      neural voice cloning or text-to-speech in your voice &mdash; it does not reproduce your
      timbre, only the note range the vocal line stays within. Works best in Chrome/Edge. Once
      lyrics have been generated, the phrases above become the actual generated lyric lines
      &mdash; sing or say <em>those specific words</em> so the pitch measurement comes from your
      real delivery of them, though the words themselves still won't be sung by the output audio.
    </p>
  </section>
</div>

</div>
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
  var bassDbEl = document.getElementById('bassDb');
  var bassDbValueEl = document.getElementById('bassDbValue');
  var midDbEl = document.getElementById('midDb');
  var midDbValueEl = document.getElementById('midDbValue');
  var trebleDbEl = document.getElementById('trebleDb');
  var trebleDbValueEl = document.getElementById('trebleDbValue');
  var noDrumsEl = document.getElementById('noDrums');
  var noBassEl = document.getElementById('noBass');
  var waltzEl = document.getElementById('waltz');
  var regenerateEl = document.getElementById('regenerate');
  var playerActionsEl = document.getElementById('playerActions');
  var downloadLinkEl = document.getElementById('downloadLink');
  var seedValueEl = document.getElementById('seedValue');
  var lastSeed = null;
  var lastComposition = null;
  // Fallback phrases (generic hum/spoken-phrase calibration) used until
  // real lyrics have been generated; once they have, this is replaced
  // with deriveRecordingPhrases' output (actual generated lyric lines).
  var currentPhrases = VOICE_PHRASES.map(function (p) {
    return { id: p.id, label: p.label, instruction: p.prompt, text: null };
  });

  bpmEl.addEventListener('input', function () { bpmValueEl.textContent = bpmEl.value; });
  barsEl.addEventListener('input', function () { barsValueEl.textContent = barsEl.value; });
  pitchBendEl.addEventListener('input', function () { pitchBendValueEl.textContent = pitchBendEl.value; });
  tempoStretchEl.addEventListener('input', function () {
    tempoStretchValueEl.textContent = (tempoStretchEl.value / 100).toFixed(2) + 'x';
  });
  bassDbEl.addEventListener('input', function () { bassDbValueEl.textContent = bassDbEl.value; });
  midDbEl.addEventListener('input', function () { midDbValueEl.textContent = midDbEl.value; });
  trebleDbEl.addEventListener('input', function () { trebleDbValueEl.textContent = trebleDbEl.value; });

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
    document.getElementById('trackTitle').textContent = meta.title || 'Untitled';
    setScopeComposition(lastComposition);
    // On a single-column (phone) layout the monitor sits below the controls,
    // so bring it into view once a track is ready.
    if (window.innerWidth <= 900) {
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById('monitor').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
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
      fetchAndApplyLyrics(entry.payload.prompt, entry.seed);
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
        track.style + ', ' + track.bpm + ' bpm, ' + track.bars + ' bars, seed ' + track.seed + '</div>';

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

  function buildFullPrompt() {
    var prompt = document.getElementById('prompt').value.trim();
    var style = document.getElementById('style').value;
    var bpm = bpmEl.value;
    var bars = barsEl.value;
    var instrumental = instrumentalEl.checked;
    return (prompt || ('a track in the ' + style + ' style')) +
      ', ' + style + ' style, ' + bpm + ' bpm, ' + bars + ' bars' +
      (instrumental ? ', instrumental' : '') +
      (noDrumsEl.checked ? ', no drums' : '') +
      (noBassEl.checked ? ', no bass' : '') +
      (waltzEl.checked ? ', waltz, 3/4 time' : '');
  }

  async function runGeneration(seedOverride) {
    var style = document.getElementById('style').value;
    var instrumental = instrumentalEl.checked;
    var fullPrompt = buildFullPrompt();

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
      var bassDb = Number(bassDbEl.value);
      var midDb = Number(midDbEl.value);
      var trebleDb = Number(trebleDbEl.value);
      if (bassDb !== 0 || midDb !== 0 || trebleDb !== 0) {
        payload.eq = { bassDb: bassDb, midDb: midDb, trebleDb: trebleDb };
      }
      if (noDrumsEl.checked) payload.noDrums = true;
      if (noBassEl.checked) payload.noBass = true;
      if (waltzEl.checked) payload.timeSignature = [3, 4];
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
        payload: {
          prompt: fullPrompt,
          instrumental: instrumental,
          voiceProfile: payload.voiceProfile,
          eq: payload.eq,
          noDrums: payload.noDrums,
          noBass: payload.noBass,
          timeSignature: payload.timeSignature,
        },
        rating: null,
        createdAt: Date.now(),
      };
      var history = loadHistory();
      history.unshift(historyEntry);
      saveHistory(history.slice(0, MAX_HISTORY));
      renderHistory();

      statusEl.textContent = 'Done.';
      // Same prompt + same seed as the audio that was just rendered, so
      // these are the exact lyrics (and therefore recording phrases) tied
      // to this specific track, not a fresh unrelated draw.
      fetchAndApplyLyrics(fullPrompt, body.seed);
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

  // --- Lyrics (real template + rhyme-family generation, no audio) ---
  function renderLyrics(lyrics) {
    document.getElementById('lyricsTitle').textContent = lyrics.title || '';
    var sectionsEl = document.getElementById('lyricsSections');
    sectionsEl.innerHTML = '';
    lyrics.sections.forEach(function (section) {
      var div = document.createElement('div');
      div.style.marginBottom = '0.75rem';
      var heading = document.createElement('strong');
      heading.textContent = section.type === 'verse' ? 'Verse' : 'Chorus';
      div.appendChild(heading);
      var linesEl = document.createElement('div');
      linesEl.style.fontSize = '0.9rem';
      linesEl.style.marginTop = '0.25rem';
      linesEl.style.whiteSpace = 'pre-line';
      linesEl.textContent = section.lines.join('\\n');
      div.appendChild(linesEl);
      sectionsEl.appendChild(div);
    });
    document.getElementById('lyricsOutput').hidden = false;
  }

  function applyRecordingPhrases(recordingPhrases) {
    currentPhrases = recordingPhrases.map(function (p) {
      return { id: p.id, label: p.label, instruction: 'Sing or say this line naturally, in your comfortable range:', text: p.text };
    });
    recordings = {}; // the previous recordings were for different phrases/words
    refreshVoiceToggle();
    renderPhrases();
  }

  // Turns a bare HTTP status into something the person can act on.
  function describeApiFailure(what, status) {
    var hint = status === 404 ? 'the /api/' + what + ' endpoint was not found, so the site may need to be redeployed'
      : status === 429 ? 'too many requests, wait a few seconds and try again'
      : status === 502 || status === 503 ? 'the API server is unreachable or still starting'
      : 'unexpected server response';
    return what + ' request failed (' + status + '): ' + hint;
  }

  async function fetchAndApplyLyrics(promptText, seed) {
    var lyricsStatusEl = document.getElementById('lyricsStatus');
    lyricsStatusEl.textContent = 'Generating lyrics...';
    try {
      var payload = { prompt: promptText };
      if (seed != null) payload.seed = seed;
      var res = await fetch(apiBaseUrl + '/api/lyrics', { method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        throw new Error(errBody.error || describeApiFailure('lyrics', res.status));
      }
      var body = await res.json();
      renderLyrics(body.lyrics);
      applyRecordingPhrases(body.recordingPhrases);
      lyricsStatusEl.textContent = 'Done.';
      return body;
    } catch (err) {
      lyricsStatusEl.textContent = 'Error: ' + (err instanceof TypeError
        ? 'could not reach the server (is the API running and is this page served from the same site?)'
        : err.message);
    }
  }

  document.getElementById('generateLyrics').addEventListener('click', function () {
    fetchAndApplyLyrics(buildFullPrompt(), null);
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
    currentPhrases.forEach(function (phrase) {
      var div = document.createElement('div');
      div.className = 'phrase';
      var badge = recordings[phrase.id] ? '<span class="badge">recorded</span>' : '<span class="badge pending">not recorded</span>';
      var html = '<strong>' + phrase.label + '</strong> ' + badge +
        '<div class="prompt">' + phrase.instruction + '</div>';
      if (phrase.text) {
        html += '<div class="prompt said">\\u201c' + phrase.text + '\\u201d</div>';
      }
      div.innerHTML = html;
      var btn = document.createElement('button');
      btn.className = 'secondary record-btn';
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
    playerEl.pause();
    LiveSynth.play(lastComposition);
    startScope('live');
    document.getElementById('stopLive').hidden = false;
    statusEl.textContent = 'Playing live (browser synth).';
  });

  document.getElementById('stopLive').addEventListener('click', function () {
    LiveSynth.stop();
    stopScope();
    document.getElementById('stopLive').hidden = true;
  });

  // --- Piano-roll scope: draws the generated composition's real notes and
  // follows playback with a playhead (server WAV via the <audio> element,
  // or the live browser synth via elapsed time). ---
  var scopeEl = document.getElementById('scope');
  var scopeCtx = scopeEl.getContext('2d');
  var scopeLayer = null;
  var scopeComposition = null;
  var scopeTotalBeats = 0;
  var scopeMode = null;
  var scopeRaf = 0;
  var liveStartedAt = 0;
  var liveSeconds = 0;
  var TRACK_COLORS = ['#F2B84B', '#9FD3C7', '#8FA8FF', '#F08A7A', '#D9D9C3'];

  function sizeScope() {
    var dpr = window.devicePixelRatio || 1;
    var w = scopeEl.clientWidth;
    var h = scopeEl.clientHeight;
    if (!w || !h) return false;
    scopeEl.width = Math.round(w * dpr);
    scopeEl.height = Math.round(h * dpr);
    return true;
  }

  function buildScopeLayer() {
    var W = scopeEl.width, H = scopeEl.height;
    var dpr = window.devicePixelRatio || 1;
    var layer = document.createElement('canvas');
    layer.width = W; layer.height = H;
    var c = layer.getContext('2d');
    c.fillStyle = '#121C19';
    c.fillRect(0, 0, W, H);
    if (!scopeComposition || !scopeComposition.tracks) {
      c.fillStyle = '#6E847B';
      c.font = (14 * dpr) + 'px system-ui, sans-serif';
      c.textBaseline = 'middle';
      c.fillText('Generate a track to see its notes here.', 16 * dpr, H / 2);
      return layer;
    }
    var minP = 127, maxP = 0, maxEnd = 0;
    scopeComposition.tracks.forEach(function (t) {
      (t.notes || []).forEach(function (n) {
        if (n.pitch < minP) minP = n.pitch;
        if (n.pitch > maxP) maxP = n.pitch;
        if (n.start + n.duration > maxEnd) maxEnd = n.start + n.duration;
      });
    });
    if (maxEnd <= 0) maxEnd = 1;
    if (maxP < minP) { minP = 48; maxP = 72; }
    scopeTotalBeats = maxEnd;
    var bars = scopeComposition.bars || 8;
    for (var b = 0; b <= bars; b++) {
      var gx = Math.round(b / bars * (W - 1)) + 0.5;
      c.strokeStyle = b % 4 === 0 ? 'rgba(230,238,232,0.20)' : 'rgba(230,238,232,0.08)';
      c.lineWidth = dpr;
      c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx, H); c.stroke();
    }
    var pad = 10 * dpr;
    var range = Math.max(1, maxP - minP);
    var rowH = Math.max(2 * dpr, Math.min(9 * dpr, (H - 2 * pad) / (range + 1)));
    scopeComposition.tracks.forEach(function (t, i) {
      c.fillStyle = TRACK_COLORS[i % TRACK_COLORS.length];
      c.globalAlpha = 0.9;
      (t.notes || []).forEach(function (n) {
        var x = n.start / maxEnd * W;
        var w = Math.max(2 * dpr, n.duration / maxEnd * W - dpr);
        var y = H - pad - (n.pitch - minP) / range * (H - 2 * pad) - rowH / 2;
        c.fillRect(x, y, w, rowH);
      });
    });
    c.globalAlpha = 1;
    return layer;
  }

  function currentFraction() {
    if (scopeMode === 'wav') {
      var d = playerEl.duration;
      return d && isFinite(d) ? playerEl.currentTime / d : -1;
    }
    if (scopeMode === 'live' && liveSeconds > 0) {
      return (performance.now() - liveStartedAt) / 1000 / liveSeconds;
    }
    return -1;
  }

  function paintScope(fraction) {
    if (!scopeLayer) return;
    scopeCtx.drawImage(scopeLayer, 0, 0);
    if (fraction >= 0 && fraction <= 1) {
      var dpr = window.devicePixelRatio || 1;
      var x = Math.round(fraction * scopeEl.width);
      scopeCtx.fillStyle = 'rgba(242,184,75,0.16)';
      scopeCtx.fillRect(Math.max(0, x - 14 * dpr), 0, 14 * dpr, scopeEl.height);
      scopeCtx.fillStyle = '#F2B84B';
      scopeCtx.fillRect(x, 0, 2 * dpr, scopeEl.height);
    }
  }

  function scopeTick() {
    var f = currentFraction();
    paintScope(f);
    if (scopeMode && f <= 1) {
      scopeRaf = requestAnimationFrame(scopeTick);
    } else {
      scopeRaf = 0;
      if (scopeMode === 'live') document.getElementById('stopLive').hidden = true;
      scopeMode = null;
      paintScope(-1);
    }
  }

  function startScope(mode) {
    scopeMode = mode;
    if (mode === 'live') {
      liveStartedAt = performance.now() + 100; // synth starts 0.1s after the click
      liveSeconds = scopeTotalBeats * 60 / ((scopeComposition && scopeComposition.tempo) || 120);
    }
    if (!scopeRaf) scopeRaf = requestAnimationFrame(scopeTick);
  }

  function stopScope() {
    scopeMode = null;
    if (scopeRaf) { cancelAnimationFrame(scopeRaf); scopeRaf = 0; }
    paintScope(-1);
  }

  function redrawScope() {
    if (!sizeScope()) return;
    scopeLayer = buildScopeLayer();
    paintScope(currentFraction());
  }

  function setScopeComposition(composition) {
    scopeComposition = composition;
    var info = document.getElementById('scopeInfo');
    if (composition) {
      var n = 0;
      (composition.tracks || []).forEach(function (t) { n += (t.notes || []).length; });
      info.textContent = composition.tempo + ' bpm, ' + (composition.bars || '?') + ' bars, ' + n + ' notes';
    } else {
      info.textContent = 'Notes appear here';
    }
    redrawScope();
  }

  // Keep the phone layout short: shaping groups start collapsed there.
  if (window.innerWidth <= 900) {
    Array.prototype.forEach.call(document.querySelectorAll('details.group'), function (d) { d.removeAttribute('open'); });
  }

  playerEl.addEventListener('play', function () { startScope('wav'); });
  playerEl.addEventListener('pause', function () { if (scopeMode === 'wav') stopScope(); });
  playerEl.addEventListener('ended', function () { if (scopeMode === 'wav') stopScope(); });
  playerEl.addEventListener('seeked', function () { if (!scopeRaf) paintScope(currentFraction()); });
  window.addEventListener('resize', redrawScope);
  redrawScope();

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
