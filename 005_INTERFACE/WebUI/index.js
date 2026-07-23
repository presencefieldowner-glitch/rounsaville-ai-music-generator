'use strict';

const http = require('node:http');

// Minimal static frontend for the ecosystem: a prompt box that talks to
// 005_INTERFACE/REST_API and plays back the returned WAV. No build step,
// no framework — a single self-contained HTML page.

function getIndexHtml({ apiBaseUrl = '' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Rounsaville AI Music Generator</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1rem; }
  textarea { width: 100%; height: 5rem; font: inherit; }
  button { padding: 0.5rem 1rem; font: inherit; cursor: pointer; }
  #status { color: #666; min-height: 1.2em; }
  audio { width: 100%; margin-top: 1rem; }
  pre { background: #f4f4f4; padding: 0.75rem; overflow: auto; }
</style>
</head>
<body>
<h1>Rounsaville AI Music Generator</h1>
<p>Describe what you want (genre, mood, key, tempo, bar count) and generate a track.</p>
<textarea id="prompt" placeholder="e.g. an energetic edm track in A minor at 128 bpm, 16 bars"></textarea>
<div>
  <button id="generate">Generate</button>
</div>
<p id="status"></p>
<audio id="player" controls></audio>
<pre id="details" hidden></pre>
<script>
(function () {
  var apiBaseUrl = ${JSON.stringify(apiBaseUrl)};
  var statusEl = document.getElementById('status');
  var playerEl = document.getElementById('player');
  var detailsEl = document.getElementById('details');
  var sessionId = null;

  async function ensureSession() {
    if (sessionId) return sessionId;
    var res = await fetch(apiBaseUrl + '/api/sessions', { method: 'POST', body: '{}' });
    var session = await res.json();
    sessionId = session.id;
    return sessionId;
  }

  document.getElementById('generate').addEventListener('click', async function () {
    var prompt = document.getElementById('prompt').value.trim();
    if (!prompt) return;
    statusEl.textContent = 'Generating...';
    try {
      var id = await ensureSession();
      var res = await fetch(apiBaseUrl + '/api/sessions/' + id + '/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt: prompt, format: 'wav' }),
      });
      if (!res.ok) throw new Error('generation failed: ' + res.status);
      var blob = await res.blob();
      playerEl.src = URL.createObjectURL(blob);
      statusEl.textContent = 'Done.';
    } catch (err) {
      statusEl.textContent = 'Error: ' + err.message;
    }
  });
})();
</script>
</body>
</html>`;
}

function createStaticServer({ apiBaseUrl = '' } = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = getIndexHtml({ apiBaseUrl });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
      return res.end(html);
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

module.exports = { getIndexHtml, createStaticServer, startWebUI };
