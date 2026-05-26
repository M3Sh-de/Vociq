'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const mediasoup  = require('mediasoup');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');

const CONFIG = {
  httpPort     : process.env.PORT || 3000,
  rtcMinPort   : 40000,
  rtcMaxPort   : 49999,
  announcedIp  : process.env.ANNOUNCED_IP || null,
  adminPassword: process.env.ADMIN_PASSWORD || 'admin1234',
  serversFile  : path.join(__dirname, 'servers.json'),
  channelsFile : path.join(__dirname, 'channels.json'),
  mediaCodecs  : [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2, parameters: { 'sprop-stereo': 1 } }
  ]
};

// ── Server name ───────────────────────────────────────────────────────────────
let serverName = 'Vociq Server';
const serverNameFile = path.join(__dirname, 'servername.json');
function loadServerName() {
  try { if (fs.existsSync(serverNameFile)) serverName = JSON.parse(fs.readFileSync(serverNameFile,'utf8')).name || 'Vociq Server'; } catch {}
}
function saveServerName() { fs.writeFileSync(serverNameFile, JSON.stringify({name:serverName})); }
loadServerName();

// ── Server list ────────────────────────────────────────────────────────────────
let serverList = [];
function loadServerList() {
  try { if (fs.existsSync(CONFIG.serversFile)) serverList = JSON.parse(fs.readFileSync(CONFIG.serversFile, 'utf8')); } catch { serverList = []; }
}
function saveServerList() { fs.writeFileSync(CONFIG.serversFile, JSON.stringify(serverList, null, 2)); }
loadServerList();

// ── Permanent channels ─────────────────────────────────────────────────────────
let savedChannels = [];
function loadChannels() {
  try { if (fs.existsSync(CONFIG.channelsFile)) savedChannels = JSON.parse(fs.readFileSync(CONFIG.channelsFile, 'utf8')); } catch { savedChannels = []; }
}
function saveChannels() { fs.writeFileSync(CONFIG.channelsFile, JSON.stringify(savedChannels, null, 2)); }
loadChannels();

// ── State ──────────────────────────────────────────────────────────────────────
const rooms = new Map();
const peers = new Map();
let worker;

class Room {
  constructor(id, router, locked, password) {
    this.id = id; this.router = router;
    this.peers = new Map(); this.chat = [];
    this.locked = locked || false; this.password = password || null;
  }
  toJSON() {
    return { id: this.id, locked: this.locked, members: this.peers.size,
             users: [...this.peers.values()].map(p => p.publicInfo()) };
  }
}

class Peer {
  constructor(socketId, socket, ip) {
    this.id = socketId; this.socket = socket;
    this.name = 'Unbekannt'; this.roomId = null;
    this.muted = false; this._rtpCapabilities = null;
    this.transports = new Map(); this.producers = new Map(); this.consumers = new Map();
    this.ip = ip || 'unbekannt';
    this.connectedAt = Date.now();
    this.ping = 0;
    this.packetLoss = 0;
  }
  publicInfo() {
    return {
      id: this.id, name: this.name, muted: this.muted,
      ip: this.ip, ping: this.ping, packetLoss: this.packetLoss,
      connectedSince: this.connectedAt
    };
  }
  close() { this.transports.forEach(t => t.close()); }
}

// ── mediasoup ──────────────────────────────────────────────────────────────────
async function startWorker() {
  worker = await mediasoup.createWorker({ logLevel: 'warn', rtcMinPort: CONFIG.rtcMinPort, rtcMaxPort: CONFIG.rtcMaxPort });
  worker.on('died', () => { console.error('mediasoup worker died'); process.exit(1); });
}
async function getOrCreateRoom(roomId, locked, password) {
  if (rooms.has(roomId)) return rooms.get(roomId);
  const router = await worker.createRouter({ mediaCodecs: CONFIG.mediaCodecs });
  const room = new Room(roomId, router, locked, password);
  rooms.set(roomId, room);
  return room;
}

// ── Init permanent channels ────────────────────────────────────────────────────
async function initSavedChannels() {
  for (const ch of savedChannels) {
    await getOrCreateRoom(ch.id, ch.locked, ch.password);
  }
  console.log(`${savedChannels.length} gespeicherte Kanäle geladen`);
}

// ── Express ────────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

app.get('/api/rooms-info', adminAuth, (_, res) => {
  res.json([...rooms.values()].map(r => ({
    id: r.id, locked: r.locked, members: r.peers.size,
    users: [...r.peers.values()].map(p => p.publicInfo())
  })));
});

// Server name API
app.get('/api/servername', (_, res) => res.json({ name: serverName }));
app.post('/api/servername', adminAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name fehlt' });
  serverName = name.trim().slice(0, 50);
  saveServerName();
  io.emit('server-name', serverName);
  res.json({ ok: true, name: serverName });
});

app.get('/health', (_, res) => res.json({ ok: true, peers: peers.size, rooms: rooms.size, version: '2.1', name: serverName }));

function adminAuth(req, res, next) {
  const pw = req.headers['x-admin-password'] || req.body?.password;
  if (pw !== CONFIG.adminPassword) return res.status(401).json({ error: 'Falsches Passwort', code: 'WRONG_PASSWORD' });
  next();
}

app.get('/api/servers', (_, res) => res.json(serverList));

app.post('/api/servers', adminAuth, (req, res) => {
  const { name, ip, port, type, note } = req.body;
  if (!name || !ip) return res.status(400).json({ error: 'name und ip sind Pflicht' });
  const entry = { id: crypto.randomUUID(), name, ip, port: port || '', type: type || 'other', note: note || '' };
  serverList.push(entry); saveServerList();
  io.emit('server-list', serverList);
  res.json(entry);
});

app.put('/api/servers/:id', adminAuth, (req, res) => {
  const idx = serverList.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Nicht gefunden' });
  serverList[idx] = { ...serverList[idx], ...req.body }; saveServerList();
  io.emit('server-list', serverList);
  res.json(serverList[idx]);
});

app.delete('/api/servers/:id', adminAuth, (req, res) => {
  serverList = serverList.filter(s => s.id !== req.params.id); saveServerList();
  io.emit('server-list', serverList);
  res.json({ ok: true });
});

app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  res.json({ ok: password === CONFIG.adminPassword });
});

// Admin: channel management
app.post('/api/channels', adminAuth, async (req, res) => {
  const { roomId, password } = req.body;
  if (!roomId) return res.status(400).json({ error: 'roomId fehlt' });
  if (rooms.has(roomId)) return res.status(409).json({ error: 'Kanal existiert bereits', code: 'ROOM_EXISTS' });
  await getOrCreateRoom(roomId, !!password, password);
  if (!savedChannels.find(c => c.id === roomId)) {
    savedChannels.push({ id: roomId, locked: !!password, password: password || null });
    saveChannels();
  }
  io.emit('room-list', [...rooms.values()].map(r => r.toJSON()));
  res.json({ ok: true });
});

app.delete('/api/channels/:id', adminAuth, (req, res) => {
  const room = rooms.get(req.params.id);
  if (room) { room.router.close(); rooms.delete(req.params.id); }
  savedChannels = savedChannels.filter(c => c.id !== req.params.id); saveChannels();
  io.emit('room-list', [...rooms.values()].map(r => r.toJSON()));
  res.json({ ok: true });
});

// ── Socket.io ──────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || socket.handshake.address?.replace('::ffff:', '') || 'unbekannt';
  const peer = new Peer(socket.id, socket, ip);
  peers.set(socket.id, peer);
  console.log(`+ ${socket.id} (${ip})`);

  socket.emit('server-list', serverList);
  socket.emit('room-list', [...rooms.values()].map(r => r.toJSON()));
  socket.emit('server-name', serverName);

  // Ping measurement
  const pingInterval = setInterval(() => {
    const start = Date.now();
    socket.emit('ping-check', start, (sentAt) => {
      peer.ping = Date.now() - sentAt;
      const room = getRoom(peer);
      if (room) io.to(peer.roomId).emit('peer-stats', { id: peer.id, ping: peer.ping, packetLoss: peer.packetLoss });
    });
  }, 3000);

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
      room.peers.forEach(other => {
        if (other.id === peer.id) return;
        other.socket.emit('new-producer', { producerId: producer.id, producerPeer: peer.publicInfo() });
      });
      cb({ id: producer.id });
    } catch (e) { cb({ error: e.message, code: 'PRODUCE_ERROR' }); }
  });

  socket.on('consume', async ({ producerId, rtpCapabilities }, cb) => {
    try {
      const room = getRoom(peer);
      if (!room?.router.canConsume({ producerId, rtpCapabilities })) return cb({ error: 'Kann nicht konsumieren', code: 'CANNOT_CONSUME' });
      let recvTransport;
      peer.transports.forEach(t => { if (t.appData?.direction === 'recv') recvTransport = t; });
      if (!recvTransport) return cb({ error: 'Kein Recv-Transport', code: 'NO_RECV_TRANSPORT' });
      const consumer = await recvTransport.consume({ producerId, rtpCapabilities, paused: false });
      peer.consumers.set(consumer.id, consumer);
      consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
      consumer.on('producerclose', () => { peer.consumers.delete(consumer.id); socket.emit('consumer-closed', { consumerId: consumer.id }); });
      cb({ id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
    } catch (e) { cb({ error: e.message, code: 'CONSUME_ERROR' }); }
  });

  socket.on('store-rtp-caps', caps => { peer._rtpCapabilities = caps; });
  socket.on('set-mute', ({ muted }) => { peer.muted = muted; const r = getRoom(peer); if (r) io.to(peer.roomId).emit('peer-muted', { id: peer.id, muted }); });
  socket.on('chat', ({ text }) => {
    const room = getRoom(peer); if (!room || !text?.trim()) return;
    const msg = { id: Date.now(), from: peer.name, text: text.trim().slice(0, 500), ts: new Date().toISOString() };
    room.chat.push(msg); if (room.chat.length > 200) room.chat.shift();
    io.to(peer.roomId).emit('chat', msg);
  });

  socket.on('disconnect', reason => {
    clearInterval(pingInterval);
    console.log(`- ${socket.id} (${reason})`);
    leaveRoom(peer); peer.close(); peers.delete(socket.id); broadcastRoomList();
  });
});

function getRoom(peer) { return peer.roomId ? rooms.get(peer.roomId) : null; }
function leaveRoom(peer) {
  const room = getRoom(peer); if (!room) return;
  room.peers.delete(peer.id);
  peer.socket.to(peer.roomId).emit('peer-left', { id: peer.id });
  peer.socket.leave(peer.roomId); peer.roomId = null;
  // Don't delete room - channels are permanent
  broadcastRoomList();
}
function broadcastRoomList() { io.emit('room-list', [...rooms.values()].map(r => r.toJSON())); }

(async () => {
  await startWorker();
  await initSavedChannels();
  server.listen(CONFIG.httpPort, () => {
    console.log(`\n✅ Vociq Server läuft auf Port ${CONFIG.httpPort}`);
    console.log(`   Admin-Passwort: ${CONFIG.adminPassword}\n`);
  });
})();
