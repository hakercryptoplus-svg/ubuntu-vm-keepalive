/**
 * Ubuntu VM Keepalive Server
 * Runs on Render - maintains persistent connection to Replit + Ubuntu VM
 */

'use strict';

const express = require('express');
const { Client } = require('ssh2');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Configuration ──────────────────────────────────────────────────────────
const REPLIT_HOST   = process.env.REPLIT_HOST   || '4a52e65a88c1-00-19z61njhlnfbf.janeway.replit.dev';
const SSH_USER      = process.env.SSH_USER      || 'ubuntu';
const SSH_PASSWORD  = process.env.SSH_PASSWORD  || 'ubuntu123';
const PING_INTERVAL = parseInt(process.env.PING_INTERVAL || '30000');   // ms between HTTP pings
const SSH_RECONNECT = parseInt(process.env.SSH_RECONNECT  || '10000');  // ms before SSH reconnect

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  sshConnected:  false,
  sshLastSeen:   null,
  sshError:      null,
  pingLastOk:    null,
  pingLastFail:  null,
  pingCount:     0,
  pingFails:     0,
  sshReconnects: 0,
  startTime:     new Date(),
  sshShell:      null,
  output:        []          // last 200 lines of shell output
};

function addOutput(line) {
  state.output.push({ ts: new Date().toISOString(), line });
  if (state.output.length > 200) state.output.shift();
}

// ── HTTP Keep-alive pinger ─────────────────────────────────────────────────
async function pingReplit() {
  const url = `https://${REPLIT_HOST}/api/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    state.pingLastOk = new Date();
    state.pingCount++;
    console.log(`[PING] OK ${res.status} — ${url}`);
  } catch (err) {
    state.pingLastFail = new Date();
    state.pingFails++;
    console.error(`[PING] FAIL — ${err.message}`);
  }
}

setInterval(pingReplit, PING_INTERVAL);
pingReplit();

// ── WebSocket SSH proxy connection ─────────────────────────────────────────
// The Replit api-server exposes wss://<host>/api/ssh-proxy
// which tunnels TCP to localhost:2222 (Ubuntu VM)
class SshStream {
  constructor(ws) {
    this.ws = ws;
    this._listeners = {};
  }
  on(event, fn) {
    this._listeners[event] = this._listeners[event] || [];
    this._listeners[event].push(fn);
    if (event === 'data') {
      this.ws.on('message', (msg) => fn(msg));
    }
    if (event === 'close' || event === 'end') {
      this.ws.on('close', () => fn());
    }
    if (event === 'error') {
      this.ws.on('error', fn);
    }
    return this;
  }
  write(data) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }
  destroy() {
    try { this.ws.close(); } catch (_) {}
  }
}

function connectSSH() {
  const wsUrl = `wss://${REPLIT_HOST}/api/ssh-proxy`;
  console.log(`[SSH] Connecting via WebSocket proxy: ${wsUrl}`);

  const ws = new WebSocket(wsUrl, { handshakeTimeout: 15000 });

  ws.on('error', (err) => {
    console.error('[SSH] WebSocket error:', err.message);
    state.sshConnected = false;
    state.sshError = err.message;
    scheduleReconnect();
  });

  ws.on('open', () => {
    console.log('[SSH] WebSocket open — starting SSH handshake');
    const stream = new SshStream(ws);
    const conn = new Client();

    conn.on('ready', () => {
      console.log('[SSH] ✓ Authenticated as', SSH_USER);
      state.sshConnected = true;
      state.sshLastSeen  = new Date();
      state.sshError     = null;
      addOutput('=== SSH session started ===');

      // Open interactive shell
      conn.shell({ term: 'xterm-256color' }, (err, shellStream) => {
        if (err) {
          console.error('[SSH] Shell error:', err.message);
          conn.end();
          return;
        }

        state.sshShell = shellStream;

        shellStream.on('data', (data) => {
          state.sshLastSeen = new Date();
          addOutput(data.toString('utf8').replace(/\r?\n$/, ''));
        });

        shellStream.stderr.on('data', (data) => {
          addOutput('[STDERR] ' + data.toString('utf8').replace(/\r?\n$/, ''));
        });

        shellStream.on('close', () => {
          console.log('[SSH] Shell closed');
          state.sshConnected = false;
          state.sshShell = null;
          addOutput('=== SSH session closed ===');
          conn.end();
        });

        // Send keepalive commands every 60s to keep shell active
        const keepAliveCmd = setInterval(() => {
          if (state.sshConnected && shellStream.writable) {
            shellStream.write('echo "[keepalive] ' + new Date().toISOString() + '"\n');
          } else {
            clearInterval(keepAliveCmd);
          }
        }, 60000);

        // Initial greeting
        shellStream.write('echo "=== Render keepalive connected ==="\n');
        shellStream.write('uptime\n');
      });
    });

    conn.on('error', (err) => {
      console.error('[SSH] Client error:', err.message);
      state.sshConnected = false;
      state.sshError = err.message;
      addOutput('[ERROR] ' + err.message);
      scheduleReconnect();
    });

    conn.on('close', () => {
      console.log('[SSH] Connection closed');
      state.sshConnected = false;
      state.sshShell = null;
      scheduleReconnect();
    });

    conn.connect({
      sock:     stream,
      username: SSH_USER,
      password: SSH_PASSWORD,
      readyTimeout: 20000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 5
    });
  });

  ws.on('close', () => {
    if (!state.sshConnected) scheduleReconnect();
  });
}

let reconnectTimer = null;
function scheduleReconnect() {
  if (reconnectTimer) return;
  state.sshReconnects++;
  console.log(`[SSH] Reconnecting in ${SSH_RECONNECT}ms (attempt #${state.sshReconnects})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSSH();
  }, SSH_RECONNECT);
}

// Start initial connection
connectSSH();

// ── Dashboard & API ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const uptime = Math.floor((Date.now() - state.startTime) / 1000);
  const hrs = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const secs = uptime % 60;
  const uptimeStr = `${hrs}h ${mins}m ${secs}s`;

  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ubuntu VM Keepalive</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; padding: 2rem; }
  h1 { font-size: 1.8rem; margin-bottom: 1.5rem; color: #38bdf8; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .card { background: #1e293b; border-radius: 12px; padding: 1.2rem; border: 1px solid #334155; }
  .card-title { font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em; }
  .card-value { font-size: 1.5rem; font-weight: 700; }
  .ok { color: #4ade80; }
  .fail { color: #f87171; }
  .warn { color: #fbbf24; }
  .output { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 1rem; font-family: monospace; font-size: 0.8rem; max-height: 400px; overflow-y: auto; }
  .output p { padding: 2px 0; border-bottom: 1px solid #1e293b; word-break: break-all; }
  .output p:last-child { border-bottom: none; }
  .ts { color: #475569; margin-left: 0.5rem; }
  .refresh { margin-top: 1rem; font-size: 0.85rem; color: #64748b; }
  a { color: #38bdf8; }
</style>
<meta http-equiv="refresh" content="10">
</head>
<body>
<h1>🖥️ Ubuntu VM Keepalive Dashboard</h1>
<div class="grid">
  <div class="card">
    <div class="card-title">SSH إلى Ubuntu VM</div>
    <div class="card-value ${state.sshConnected ? 'ok' : 'fail'}">${state.sshConnected ? '✓ متصل' : '✗ غير متصل'}</div>
    ${state.sshError ? `<div style="font-size:0.8rem;color:#f87171;margin-top:0.3rem">${state.sshError}</div>` : ''}
    ${state.sshLastSeen ? `<div style="font-size:0.75rem;color:#94a3b8;margin-top:0.3rem">آخر نشاط: ${state.sshLastSeen.toLocaleString()}</div>` : ''}
  </div>
  <div class="card">
    <div class="card-title">HTTP Ping إلى Replit</div>
    <div class="card-value ${state.pingLastOk ? 'ok' : 'warn'}">${state.pingCount} نجاح / ${state.pingFails} فشل</div>
    ${state.pingLastOk ? `<div style="font-size:0.75rem;color:#94a3b8;margin-top:0.3rem">آخر نجاح: ${state.pingLastOk.toLocaleString()}</div>` : ''}
  </div>
  <div class="card">
    <div class="card-title">Replit Host</div>
    <div style="font-size:0.9rem;word-break:break-all;color:#7dd3fc;margin-top:0.3rem">${REPLIT_HOST}</div>
  </div>
  <div class="card">
    <div class="card-title">وقت التشغيل</div>
    <div class="card-value ok">${uptimeStr}</div>
    <div style="font-size:0.75rem;color:#94a3b8;margin-top:0.3rem">إعادة اتصال SSH: ${state.sshReconnects} مرة</div>
  </div>
</div>
<h2 style="margin-bottom:0.8rem;font-size:1.1rem;color:#94a3b8">آخر مخرجات Shell</h2>
<div class="output">
  ${state.output.length === 0
    ? '<p style="color:#64748b">لا توجد مخرجات بعد...</p>'
    : state.output.slice(-50).reverse().map(o =>
        `<p><span class="ts">${o.ts}</span>${escapeHtml(o.line)}</p>`
      ).join('')
  }
</div>
<p class="refresh">يتجدد تلقائياً كل 10 ثواني · <a href="/api/status">JSON Status</a> · <a href="/api/exec">تنفيذ أمر</a></p>
</body>
</html>`);
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/status', (req, res) => {
  res.json({
    ssh: {
      connected: state.sshConnected,
      lastSeen:  state.sshLastSeen,
      error:     state.sshError,
      reconnects: state.sshReconnects
    },
    ping: {
      count:    state.pingCount,
      fails:    state.pingFails,
      lastOk:   state.pingLastOk,
      lastFail: state.pingLastFail
    },
    startTime: state.startTime,
    outputLines: state.output.length
  });
});

// Send a command to the Ubuntu VM shell
app.get('/api/exec', express.urlencoded({ extended: false }), (req, res) => {
  const cmd = req.query.cmd || '';
  if (!cmd) {
    return res.send(`
      <form method="get" action="/api/exec">
        <input name="cmd" style="width:400px;padding:8px;font-family:monospace" placeholder="أدخل الأمر...">
        <button type="submit">تنفيذ</button>
      </form>
      <p>مثال: <a href="/api/exec?cmd=whoami">/api/exec?cmd=whoami</a></p>
    `);
  }
  if (!state.sshConnected || !state.sshShell) {
    return res.json({ error: 'SSH not connected' });
  }
  state.sshShell.write(cmd + '\n');
  res.json({ sent: cmd, note: 'Check dashboard for output' });
});

app.listen(PORT, () => {
  console.log(`[SERVER] Keepalive server running on port ${PORT}`);
  console.log(`[SERVER] Target: ${REPLIT_HOST}`);
});
