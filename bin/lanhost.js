#!/usr/bin/env node

'use strict';

const http = require('http');
const httpProxy = require('http-proxy');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Config ──────────────────────────────────────────────────────────────────

function loadConfig(targetPort) {
  const configPath = path.join(process.cwd(), '.lanhost');
  const projectName = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).name;
    } catch {
      return path.basename(process.cwd());
    }
  })();

  const defaults = {
    port: targetPort,
    proxyPort: null,         // defaults to targetPort + 1 below
    password: null,
    sessionExpiry: '8h',
    name: projectName,
  };

  if (!fs.existsSync(configPath)) return defaults;

  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
  } catch {
    console.error('Failed to parse .lanhost — must be valid JSON.');
    process.exit(1);
  }
}

function parseExpiry(value) {
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(\d+)(h|m|s)?$/);
  if (!match) return 8 * 3600 * 1000;
  const n = parseInt(match[1], 10);
  return n * ({ h: 3600000, m: 60000, s: 1000 }[match[2] || 'h']);
}

// ─── Network ─────────────────────────────────────────────────────────────────

function getLanIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function isPrivateIP(ip) {
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);
}

// ─── Sessions ────────────────────────────────────────────────────────────────

const sessions = new Map();

function createSession(expiryMs) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + expiryMs);
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(token); return false; }
  return true;
}

function getSessionToken(req) {
  const match = (req.headers.cookie || '').match(/lanhost_session=([a-f0-9]{64})/);
  return match ? match[1] : null;
}

// ─── Request body ────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(new URLSearchParams(body)));
    req.on('error', reject);
  });
}

// ─── Login page ──────────────────────────────────────────────────────────────

function loginHTML(error = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LanHost</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #f5f5f5;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .card {
      background: #141414;
      border: 1px solid #242424;
      border-radius: 16px;
      padding: 2rem;
      width: 100%;
      max-width: 340px;
    }
    .logo {
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #666;
      margin-bottom: 0.5rem;
    }
    h1 { font-size: 1.375rem; font-weight: 600; margin-bottom: 0.375rem; }
    .sub { color: #888; font-size: 0.875rem; margin-bottom: 1.75rem; line-height: 1.4; }
    label { display: block; font-size: 0.8125rem; color: #aaa; margin-bottom: 0.375rem; }
    input[type="password"] {
      width: 100%;
      padding: 0.75rem 1rem;
      background: #0a0a0a;
      border: 1px solid #2e2e2e;
      border-radius: 10px;
      color: #f5f5f5;
      font-size: 1rem;
      margin-bottom: 0.75rem;
      transition: border-color 0.15s;
    }
    input[type="password"]:focus {
      outline: none;
      border-color: #555;
    }
    .error {
      background: #2a1010;
      border: 1px solid #5c1f1f;
      color: #f87171;
      font-size: 0.8125rem;
      padding: 0.625rem 0.875rem;
      border-radius: 8px;
      margin-bottom: 0.75rem;
    }
    button {
      width: 100%;
      padding: 0.75rem;
      background: #f5f5f5;
      color: #0a0a0a;
      border: none;
      border-radius: 10px;
      font-size: 0.9375rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:active { background: #d0d0d0; }
  </style>
</head>
<body>
  <div class="card">
    <p class="logo">LanHost</p>
    <h1>Dev access</h1>
    <p class="sub">Enter the password to view this dev server.</p>
    ${error ? '<div class="error">Incorrect password — try again.</div>' : ''}
    <form method="POST" action="/__lanhost_auth">
      <label for="pw">Password</label>
      <input id="pw" type="password" name="password" autofocus autocomplete="current-password" placeholder="••••••••">
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;
}

// ─── Gitignore ────────────────────────────────────────────────────────────────

function ensureGitignored() {
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  try {
    const existing = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, 'utf8')
      : '';
    if (!existing.split('\n').some(l => l.trim() === '.lanhost')) {
      fs.writeFileSync(gitignorePath, existing + (existing.endsWith('\n') ? '' : '\n') + '.lanhost\n');
      console.log('  Added .lanhost to .gitignore');
    }
  } catch {
    console.warn('  Could not update .gitignore — add .lanhost manually.');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const targetPort = parseInt(process.argv[2], 10);

  if (!targetPort || isNaN(targetPort) || targetPort < 1 || targetPort > 65535) {
    console.error('Usage: lanhost <port>\nExample: lanhost 3000');
    process.exit(1);
  }

  const config = loadConfig(targetPort);
  const expiryMs = parseExpiry(config.sessionExpiry);
  const proxyPort = config.proxyPort ?? targetPort + 1;
  const lanIP = getLanIP();

  ensureGitignored();

  if (!config.password) {
    console.warn('\n  No password set in .lanhost — running without auth.\n  Create .lanhost with { "password": "..." } to protect access.\n');
  }

  if (!isPrivateIP(lanIP)) {
    console.warn('\n  Warning: not on a private network. Your dev server is publicly reachable.\n');
  }

  // Proxy
  const proxy = httpProxy.createProxyServer({
    target: `http://localhost:${targetPort}`,
    ws: true,
    changeOrigin: true,
  });

  proxy.on('error', (_err, _req, res) => {
    if (res.writeHead) {
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<p style="font-family:sans-serif;padding:2rem">Dev server unreachable — is it running on port ${targetPort}?</p>`);
    }
  });

  const server = http.createServer(async (req, res) => {
    if (!config.password) {
      return proxy.web(req, res);
    }

    // Handle auth POST
    if (req.method === 'POST' && req.url === '/__lanhost_auth') {
      let body;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Bad request');
      }
      const submitted = body.get('password') ?? '';
      const expected = config.password;
      const match = submitted.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));
      if (match) {
        const token = createSession(expiryMs);
        res.writeHead(302, {
          Location: '/',
          'Set-Cookie': `lanhost_session=${token}; HttpOnly; SameSite=Strict; Path=/`,
        });
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(loginHTML(true));
    }

    // Guard all other routes
    if (!isValidSession(getSessionToken(req))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(loginHTML(false));
    }

    proxy.web(req, res);
  });

  // Proxy WebSocket (HMR)
  server.on('upgrade', (req, socket, head) => {
    if (config.password && !isValidSession(getSessionToken(req))) {
      socket.destroy();
      return;
    }
    proxy.ws(req, socket, head);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${proxyPort} is already in use.\n  Set a different proxy port in .lanhost: { "proxyPort": ${proxyPort + 1} }\n`);
    } else {
      console.error(err.message);
    }
    process.exit(1);
  });

  server.listen(proxyPort, '0.0.0.0', () => {
    const url = `http://${lanIP}:${proxyPort}`;

    // mDNS — optional, don't crash if unavailable
    try {
      const { Bonjour } = require('bonjour-service');
      new Bonjour().publish({ name: config.name, type: 'http', port: proxyPort });
    } catch (err) {
      console.debug('  mDNS unavailable:', err.message);
    }

    // QR code
    const qrcode = require('qrcode-terminal');

    console.log(`\n  lanhost\n`);
    console.log(`  Target  : http://localhost:${targetPort}`);
    console.log(`  Network : ${url}`);
    if (config.name) console.log(`  mDNS    : http://${config.name}.local:${proxyPort}`);
    console.log(`  Auth    : ${config.password ? 'password protected' : 'none'}`);
    console.log('\n  Scan on mobile:\n');
    qrcode.generate(url, { small: true });
    console.log(`\n  ${url}\n`);
  });
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
