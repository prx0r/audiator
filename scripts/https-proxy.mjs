/**
 * HTTPS proxy for local development.
 * Required for microphone access in browsers (getUserMedia requires HTTPS
 * or localhost). Run alongside `npm run dev`.
 *
 * Usage: node scripts/https-proxy.mjs
 * Then open https://localhost:3443
 */

import http from 'http';
import https from 'https';
import httpProxy from 'http-proxy';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = process.env.PROXY_TARGET || 'http://127.0.0.1:3001';
const PORT = parseInt(process.env.PROXY_PORT || '3443', 10);

const certPath = path.join(__dirname, '..', 'certs');
const keyPath = path.join(certPath, 'server.key');
const crtPath = path.join(certPath, 'server.crt');

function generateCert() {
  console.log('Generating self-signed certificate...');
  const { execSync } = require('child_process');
  fs.mkdirSync(certPath, { recursive: true });
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${crtPath}" -days 365 -nodes -subj "/CN=localhost"`,
    { stdio: 'inherit' }
  );
}

if (!fs.existsSync(keyPath) || !fs.existsSync(crtPath)) {
  try {
    generateCert();
  } catch {
    console.error('Failed to generate certificate. Install openssl or create certs manually.');
    process.exit(1);
  }
}

const proxy = httpProxy.createProxyServer({
  target: TARGET,
  ws: true,
});

proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err.message);
  if (res.writeHead) res.writeHead(502, { 'Content-Type': 'text/plain' });
  res?.end?.('Bad gateway');
});

const server = https.createServer({
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(crtPath),
}, (req, res) => {
  proxy.web(req, res);
});

server.on('upgrade', (req, socket, head) => {
  proxy.ws(req, socket, head);
});

server.listen(PORT, () => {
  console.log(`\nHTTPS proxy listening on https://localhost:${PORT}`);
  console.log(`Forwarding to ${TARGET}`);
  console.log('Open https://localhost:' + PORT + ' in your browser to access the app with mic support.\n');
});
