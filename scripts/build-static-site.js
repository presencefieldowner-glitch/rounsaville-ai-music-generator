'use strict';

// Generates public/index.html from 005_INTERFACE/WebUI so the local dev
// server and the Netlify static deploy share one source of truth instead
// of two hand-maintained copies. Run automatically by `netlify.toml`'s
// build command; safe to run manually too.

const fs = require('node:fs');
const path = require('node:path');
const { getIndexHtml } = require('../005_INTERFACE/WebUI');

const outputPath = path.join(__dirname, '..', 'public', 'index.html');
fs.writeFileSync(outputPath, getIndexHtml({ apiBaseUrl: '' }));
console.log(`wrote ${outputPath}`);
