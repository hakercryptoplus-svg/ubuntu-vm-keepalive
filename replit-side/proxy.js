/**
 * SSH WebSocket Proxy — يشتغل داخل بيئة Replit الخاصة بك
 * يستمع على HTTP ويحول طلبات WebSocket إلى SSH على localhost:2222
 *
 * تشغيل: node proxy.js
 */

'use strict';

const http  = require('http');
const net   = require('net');
const { WebSocketServer, WebSocket } = require('ws');

const PORT     = process.env.PORT || 3000;
const SSH_PORT = 2222;
const SSH_HOST = '127.0.0.1';

const app = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'ssh-ws-proxy',
      target: `${SSH_HOST}:${SSH_PORT}`,
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ noServer: true });

app.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url === '/ssh-proxy' || url.startsWith('/ssh-proxy?') ||
      url === '/api/ssh-proxy' || url.startsWith('/api/ssh-proxy?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      console.log('[PROXY] New WebSocket connection — opening TCP to', SSH_HOST + ':' + SSH_PORT);
      const tcp = net.createConnection({ host: SSH_HOST, port: SSH_PORT });

      tcp.on('connect', () => console.log('[PROXY] TCP connected to Ubuntu VM'));
      tcp.on('error',   (e) => { console.error('[PROXY] TCP error:', e.message); ws.close(); });
      tcp.on('close',   ()  => { console.log('[PROXY] TCP closed'); ws.close(); });

      ws.on('message', (data) => { if (!tcp.destroyed) tcp.write(data); });
      ws.on('close',   ()     => { tcp.destroy(); console.log('[PROXY] WS closed'); });
      ws.on('error',   (e)    => { console.error('[PROXY] WS error:', e.message); tcp.destroy(); });

      tcp.on('data', (data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });
    });
  } else {
    socket.destroy();
  }
});

app.listen(PORT, () => {
  console.log('================================================');
  console.log(' SSH WebSocket Proxy شغّال');
  console.log(' PORT:', PORT);
  console.log(' Target: ssh ubuntu@' + SSH_HOST + ' -p ' + SSH_PORT);
  console.log(' Health: http://localhost:' + PORT + '/health');
  console.log('================================================');
});
