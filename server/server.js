'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const mediasoup  = require('mediasoup');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');

// ─── Config ────────────────────────────────────────────────────────────────
const CONFIG = {
  httpPort   : process.env.PORT || 3000,
  rtcMinPort : 40000,
  rtcMaxPort : 49999,
  announcedIp: process.env.ANNOUNCED_IP || null,
  adminPassword: process.env.ADMIN_PASSWORD || 'admin1234',
  serversFile: path.join(__dirname, 'servers.json'),
  mediaCodecs: [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2, parameters: { 'sprop-stereo': 1 } }
  ]
};

// ─── Server list (persisted to servers.json) ───────────────────────────────
let serverList = [];
function loadServerList() {
  try {
    if (fs.existsSync(CONFIG.serversFile))
      serverList = JSON.parse(fs.readFileSync(CONFIG.serversFile, 'utf8'));
  } catch { serverList = []; }
}
function saveServerList() {
  fs.writeFileSync(CONFIG.serversFile, JSON.stringify(serverList, null, 2));
}
loadServerList();

// ─── State ─────────────────────────────────────────────────────────────────
const rooms = new Map();
const peers = new Map();
let worker;

// ─── Room / Peer classes ────────────────────────────────────────────────────
class Room {
  constructor(id, router) {
    this.id = id; this.router = router;
    this.peers = new Map(); this.chat = []; this.locked = false; this.password = null;
  }
  toJSON() {
    return { id: this.id, locked: this.locked, members: this.peers.size,
             users: [...this.peers.values()].map(p => p.publicInfo()) };
  }
}
class Peer {
  constructor(socketId, socket) {
    this.id = socketId; this.socket = socket; this.name = 'Unbekannt';
    this.roomId = null; this.muted = false; this._rtpCapabilities = null;
    this.transports = new Map(); this.producers = new Map(); this.consumers = new Map();
  }
  publicInfo() { return { id: this.id, name: this.name, muted: this.muted }; }
  close() { this.transports.forEach(t => t.close()); }
}

// ─── mediasoup ─────────────────────────────────────────────────────────────
async function startWorker() {
  worker = await mediasoup.createWorker({ logLevel: 'warn', rtcMinPort: CONFIG.rtcMinPort, rtcMaxPort: CONFIG.rtcMaxPort });
  worker.on('died', () => { console.error('mediasoup worker died'); process.exit(1); });
  console.log(`mediasoup worker PID ${worker.pid}`);
}
async function getOrCreateRoom(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId);
  const router = await worker.createRouter({ mediaCodecs: CONFIG.mediaCodecs });
  const room = new Room(roomId, router);
  rooms.set(roomId, room);
  return room;
}

// ─── Express ────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true, peers: peers.size, rooms: rooms.size, version: '2.0' }));

// ── Admin auth middleware
function adminAuth(req, res, next) {
  const pw = req.headers['x-admin-password'] || req.query.pw;
  if (pw !== CONFIG.adminPassword) return res.status(401).json({ error: 'Falsches Admin-Passwort', code: 'WRONG_PASSWORD' });
  next();
}

// ── Server list API (read = public, write = admin only)
app.get('/api/servers', (_, res) => res.json(serverList));

app.post('/api/servers', adminAuth, (req, res) => {
  const { name, ip, port, type, note } = req.body;
  if (!name || !ip) return res.status(400).json({ error: 'name und ip sind Pflicht' });
  const entry = { id: crypto.randomUUID(), name, ip, port: port || '', type: type || 'other', note: note || '' };
  serverList.push(entry);
  saveServerList();
  io.emit('server-list', serverList);
  res.json(entry);
});

app.put('/api/servers/:id', adminAuth, (req, res) => {
  const idx = serverList.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Nicht gefunden' });
  serverList[idx] = { ...serverList[idx], ...req.body };
  saveServerList();
  io.emit('server-list', serverList);
  res.json(serverList[idx]);
});

app.delete('/api/servers/:id', adminAuth, (req, res) => {
  serverList = serverList.filter(s => s.id !== req.params.id);
  saveServerList();
  io.emit('server-list', serverList);
  res.json({ ok: true });
});

// ── Admin password verify
app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  res.json({ ok: password === CONFIG.adminPassword });
});

// ─── Socket.io ──────────────────────────────────────────────────────────────
io.on('connection', socket => {
  const peer = new Peer(socket.id, socket);
  peers.set(socket.id, peer);
  console.log(`+ ${socket.id} verbunden`);

  // Send server list immediately on connect
  socket.emit('server-list', serverList);

  socket.on('join', async ({ roomId, name, password }, cb) => {
    try {
      const room = await getOrCreateRoom(roomId);
      if (room.locked && room.password !== password) return cb({ error: 'Falsches Passwort', code: 'WRONG_PASSWORD' });
      if (peer.roomId) leaveRoom(peer);
      peer.name = name || 'Nutzer'; peer.roomId = roomId;
      room.peers.set(peer.id, peer);
      socket.join(roomId);
      socket.to(roomId).emit('peer-joined', peer.publicInfo());
      cb({ rtpCapabilities: room.router.rtpCapabilities,
           peers: [...room.peers.values()].filter(p => p.id !== peer.id).map(p => p.publicInfo()),
           chat: room.chat.slice(-50) });
      broadcastRoomList();
    } catch (e) { cb({ error: e.message, code: 'JOIN_ERROR' }); }
  });

  socket.on('get-rooms', (_, cb) => cb([...rooms.values()].map(r => r.toJSON())));

  socket.on('create-room', async ({ roomId, password }, cb) => {
    try {
      if (rooms.has(roomId)) return cb({ error: 'Raum existiert bereits', code: 'ROOM_EXISTS' });
      const room = await getOrCreateRoom(roomId);
      if (password) { room.locked = true; room.password = password; }
      cb({ ok: true });
      broadcastRoomList();
    } catch (e) { cb({ error: e.message, code: 'CREATE_ERROR' }); }
  });

  socket.on('create-transport', async ({ direction }, cb) => {
    try {
      const room = getRoom(peer);
      if (!room) return cb({ error: 'Kein Raum', code: 'NO_ROOM' });
      const transport = await room.router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: CONFIG.announcedIp }],
        enableUdp: true, enableTcp: true, preferUdp: true,
        initialAvailableOutgoingBitrate: 600000
      });
      transport.on('dtlsstatechange', s => { if (s === 'closed') transport.close(); });
      peer.transports.set(transport.id, transport);
      cb({ id: transport.id, iceParameters: transport.iceParameters,
           iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters });
    } catch (e) { cb({ error: e.message, code: 'TRANSPORT_ERROR' }); }
  });

  socket.on('connect-transport', async ({ transportId, dtlsParameters }, cb) => {
    try {
      const t = peer.transports.get(transportId);
      if (!t) return cb({ error: 'Transport nicht gefunden', code: 'NO_TRANSPORT' });
      await t.connect({ dtlsParameters }); cb({ ok: true });
    } catch (e) { cb({ error: e.message, code: 'CONNECT_TRANSPORT_ERROR' }); }
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters }, cb) => {
    try {
      const t = peer.transports.get(transportId);
      if (!t) return cb({ error: 'Transport nicht gefunden', code: 'NO_TRANSPORT' });
      const producer = await t.produce({ kind, rtpParameters });
      peer.producers.set(producer.id, producer);
      producer.on('transportclose', () => peer.producers.delete(producer.id));
      const room = getRoom(peer);
      room.peers.forEach(async other => {
        if (other.id === peer.id) return;
        other.socket.emit('new-producer', { producerId: producer.id, producerPeer: peer.publicInfo() });
      });
      cb({ id: producer.id });
    } catch (e) { cb({ error: e.message, code: 'PRODUCE_ERROR' }); }
  });

  socket.on('consume', async ({ producerId, rtpCapabilities }, cb) => {
    try {
      const room = getRoom(peer);
      if (!room?.router.canConsume({ producerId, rtpCapabilities }))
        return cb({ error: 'Kann nicht konsumieren', code: 'CANNOT_CONSUME' });
      let recvTransport;
      peer.transports.forEach(t => { if (t.appData?.direction === 'recv') recvTransport = t; });
      if (!recvTransport) return cb({ error: 'Kein Recv-Transport', code: 'NO_RECV_TRANSPORT' });
      const consumer = await recvTransport.consume({ producerId, rtpCapabilities, paused: false });
      peer.consumers.set(consumer.id, consumer);
      consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
      consumer.on('producerclose', () => {
        peer.consumers.delete(consumer.id);
        socket.emit('consumer-closed', { consumerId: consumer.id });
      });
      cb({ id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
    } catch (e) { cb({ error: e.message, code: 'CONSUME_ERROR' }); }
  });

  socket.on('store-rtp-caps', caps => { peer._rtpCapabilities = caps; });
  socket.on('set-mute', ({ muted }) => { peer.muted = muted; const r = getRoom(peer); if (r) io.to(peer.roomId).emit('peer-muted', { id: peer.id, muted }); });

  socket.on('chat', ({ text }) => {
    const room = getRoom(peer);
    if (!room || !text?.trim()) return;
    const msg = { id: Date.now(), from: peer.name, text: text.trim().slice(0, 500), ts: new Date().toISOString() };
    room.chat.push(msg); if (room.chat.length > 200) room.chat.shift();
    io.to(peer.roomId).emit('chat', msg);
  });

  socket.on('disconnect', reason => {
    console.log(`- ${socket.id} getrennt (${reason})`);
    leaveRoom(peer); peer.close(); peers.delete(socket.id); broadcastRoomList();
  });
});

function getRoom(peer) { return peer.roomId ? rooms.get(peer.roomId) : null; }
function leaveRoom(peer) {
  const room = getRoom(peer); if (!room) return;
  room.peers.delete(peer.id);
  peer.socket.to(peer.roomId).emit('peer-left', { id: peer.id });
  peer.socket.leave(peer.roomId); peer.roomId = null;
  if (room.peers.size === 0) { room.router.close(); rooms.delete(room.id); }
  broadcastRoomList();
}
function broadcastRoomList() { io.emit('room-list', [...rooms.values()].map(r => r.toJSON())); }

(async () => {
  await startWorker();
  server.listen(CONFIG.httpPort, () => {
    console.log(`\n✅ Voice Dashboard Server läuft auf Port ${CONFIG.httpPort}`);
    console.log(`   Admin-Passwort: ${CONFIG.adminPassword}`);
    console.log(`   Zum Ändern: ADMIN_PASSWORD=geheim node server.js\n`);
  });
})();
