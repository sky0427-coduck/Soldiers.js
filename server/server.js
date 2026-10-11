import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, randomInt, timingSafeEqual } from 'crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'fs/promises';
import { createReadStream } from 'fs';
import { createGzip } from 'zlib';
import { pipeline } from 'stream';
import { attach as attachWar, getAdminStatus as getWarAdminStatus, resetWarMatch } from './war.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const rankPath = process.env.RANK_FILE || path.join(__dirname, 'rank.txt');
const rankVersionHeader = '# SOLDIERS_RANK_V2';
const clientDir = path.join(__dirname, '..', 'client');
const adminPin = process.env.ADMIN_PIN || String(randomInt(100000, 1000000));
const adminSessions = new Map();
const adminLoginAttempts = new Map();
const clientPresence = new Map();
const visitorQueue = [];
let queueEntryId = 0;
app.use(express.json({ limit: '4kb' }));
app.get('/admin', (req, res) => res.sendFile(path.join(clientDir, 'admin.html')));
app.use(express.static(clientDir));
app.get('/models/house_B.glb', (req, res, next) => {
  if (!req.acceptsEncodings('gzip')) return next();
  res.set({ 'Content-Type': 'model/gltf-binary', 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding', 'Cache-Control': 'public, max-age=3600' });
  pipeline(createReadStream(path.join(__dirname, '..', 'models', 'house_B.glb')), createGzip({ level: 1 }), res, error => { if (error) next(error); });
});
app.use('/models', express.static(path.join(__dirname, '..', 'models')));
app.use('/sound', express.static(path.join(__dirname, '..', 'sound')));
app.use('/ICONS', express.static(path.join(__dirname, '..', 'ICONS')));

const clean = (value, max = 30) => String(value ?? '').replace(/[|\r\n]/g, ' ').trim().slice(0, max);
const rankSessions = new Map();
let nextClientId = 1;
let rankOrder = 0;
let queueSequence = 0;
let rankQueue = [];
let rankQueueTimer = null;
let rankQueueBusy = false;

function makePlayer(name, order) {
  return { name, practiceScore: null, practiceLevel: null, cqbScore: null, order };
}
function playerKey(name) { return name.trim().toLocaleLowerCase('ko-KR'); }
function scoreValue(value) {
  if (value == null || value === '-' || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : null;
}
function rankPlayers(players) {
  return players
    .map(player => {
      const hasPractice = player.practiceScore !== null;
      const hasCQB = player.cqbScore !== null;
      const totalScore = (player.practiceScore || 0) + (player.cqbScore || 0);
      const mode = hasPractice && hasCQB ? 'PRACTICE + CQB' : hasPractice ? 'PRACTICE' : 'CQB';
      return { ...player, totalScore, mode };
    })
    .sort((a, b) => b.totalScore - a.totalScore || a.order - b.order)
    .map((player, index) => ({ ...player, rank: index + 1 }));
}
function parseV2(lines) {
  const players = [];
  for (const line of lines) {
    const [name, practice, cqb, , , , order, level] = line.split('|').map(part => part.trim());
    if (!name) continue;
    players.push({
      name,
      practiceScore: scoreValue(practice),
      practiceLevel: level && level !== '-' ? level : null,
      cqbScore: scoreValue(cqb),
      order: Number(order) || ++rankOrder,
    });
  }
  return players;
}
function parseLegacy(lines) {
  const playersByName = new Map();
  const attempts = lines.map((line, index) => {
    const [name, score, , level, mode, order] = line.split('|').map(part => part.trim());
    return { name, score: scoreValue(score), level, mode: (mode || '').toUpperCase(), order: Number(order) || index + 1 };
  }).filter(row => row.name && (row.mode === 'PRACTICE' || row.mode === 'CQB'))
    .sort((a, b) => a.order - b.order);
  for (const attempt of attempts) {
    const key = playerKey(attempt.name);
    let player = playersByName.get(key);
    if (!player) {
      player = makePlayer(attempt.name, attempt.order);
      playersByName.set(key, player);
    }
    if (attempt.mode === 'PRACTICE' && player.practiceScore === null) {
      player.practiceScore = attempt.score;
      player.practiceLevel = attempt.level && attempt.level !== '-' ? attempt.level : null;
    } else if (attempt.mode === 'CQB' && player.cqbScore === null) {
      player.cqbScore = attempt.score;
    }
  }
  return [...playersByName.values()];
}
async function readRankPlayers() {
  try {
    const content = await readFile(rankPath, 'utf8');
    const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) return { players: [], versioned: content.startsWith(rankVersionHeader) };
    if (lines[0] === rankVersionHeader) return { players: parseV2(lines.slice(1)), versioned: true };
    return { players: parseLegacy(lines), versioned: false };
  } catch (error) {
    if (error.code === 'ENOENT') return { players: [], versioned: true };
    throw error;
  }
}
async function writeRankPlayers(players) {
  const ordered = rankPlayers(players);
  const lines = ordered.map(player => [
    player.name,
    player.practiceScore ?? '-',
    player.cqbScore ?? '-',
    player.totalScore,
    player.mode,
    player.rank,
    player.order,
    player.practiceLevel ?? '-',
  ].join(' | '));
  await writeFile(rankPath, `${rankVersionHeader}\n${lines.join('\n')}${lines.length ? '\n' : ''}`, 'utf8');
  return ordered;
}
async function saveFirstModeScore(body) {
  const name = clean(body.name);
  const mode = clean(body.mode, 12).toUpperCase();
  const score = Math.max(0, Math.floor(Number(body.score) || 0));
  const level = Math.min(3, Math.max(0, Math.floor(Number(body.level) || 0))) || null;
  if (!name || !['PRACTICE', 'CQB'].includes(mode)) {
    const error = new Error('Invalid record');
    error.status = 400;
    throw error;
  }

  const { players, versioned } = await readRankPlayers();
  const key = playerKey(name);
  let player = players.find(item => playerKey(item.name) === key);
  let changed = false;
  if (!player) {
    player = makePlayer(name, Math.max(rankOrder, ...players.map(item => item.order), 0) + 1);
    rankOrder = player.order;
    players.push(player);
    changed = true;
  }
  const scoreField = mode === 'PRACTICE' ? 'practiceScore' : 'cqbScore';
  if (player[scoreField] === null) {
    player[scoreField] = score;
    if (mode === 'PRACTICE') player.practiceLevel = level;
    changed = true;
  }
  if (!versioned || changed) return writeRankPlayers(players);
  return rankPlayers(players);
}

function enqueueRankOperation(clientId, operation) {
  return new Promise((resolve, reject) => {
    rankQueue.push({ clientId, sequence: queueSequence++, operation, resolve, reject });
    if (!rankQueueTimer && !rankQueueBusy) {
      rankQueueTimer = setTimeout(drainRankQueue, 12);
    }
  });
}
async function drainRankQueue() {
  rankQueueTimer = null;
  if (rankQueueBusy || !rankQueue.length) return;
  rankQueue.sort((a, b) => a.clientId - b.clientId || a.sequence - b.sequence);
  const item = rankQueue.shift();
  rankQueueBusy = true;
  try { item.resolve(await item.operation()); }
  catch (error) { item.reject(error); }
  finally {
    rankQueueBusy = false;
    if (rankQueue.length) rankQueueTimer = setTimeout(drainRankQueue, 0);
  }
}
function requestClientId(req) {
  return rankSessions.get(req.get('x-soldiers-session')) ?? null;
}

function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token');
  const expiresAt = adminSessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    adminSessions.delete(token);
    return res.status(401).json({ error: '관리자 로그인이 필요합니다.' });
  }
  next();
}

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const attempt = adminLoginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 5 * 60_000 };
  if (attempt.resetAt < Date.now()) { attempt.count = 0; attempt.resetAt = Date.now() + 5 * 60_000; }
  if (attempt.count >= 8) return res.status(429).json({ error: '잠시 후 다시 시도해 주세요.' });
  const supplied = String(req.body?.pin ?? '');
  const valid = supplied.length === adminPin.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(adminPin));
  if (!valid) {
    attempt.count++;
    adminLoginAttempts.set(ip, attempt);
    return res.status(401).json({ error: 'PIN이 맞지 않습니다.' });
  }
  adminLoginAttempts.delete(ip);
  const token = randomUUID();
  adminSessions.set(token, Date.now() + 8 * 60 * 60_000);
  res.set('Cache-Control', 'no-store').json({ token });
});
app.post('/api/admin/logout', requireAdmin, (req, res) => {
  adminSessions.delete(req.get('x-admin-token'));
  res.json({ ok: true });
});

app.post('/api/presence', (req, res) => {
  const token = clean(req.get('x-soldiers-session'), 80);
  const id = rankSessions.get(token);
  if (!id) return res.status(428).json({ error: 'Client session required' });
  const body = req.body || {};
  const prior = clientPresence.get(id) || {};
  const command = prior.command || null;
  clientPresence.set(id, {
    id, name: clean(body.name, 30) || `Station ${id}`,
    mode: clean(body.mode, 16).toUpperCase() || 'MENU',
    map: clean(body.map, 24) || '-', state: clean(body.state, 24) || 'MENU',
    visible: body.visible !== false, lastSeenAt: Date.now(), command: null,
  });
  res.set('Cache-Control', 'no-store').json({ command });
});

app.get('/api/admin/status', requireAdmin, (req, res) => {
  const now = Date.now();
  for (const [id, station] of clientPresence) if (now - station.lastSeenAt > 15_000) clientPresence.delete(id);
  res.set('Cache-Control', 'no-store').json({
    clients: [...clientPresence.values()].sort((a, b) => a.id - b.id).map(({ command, ...station }) => ({ ...station, lastSeenSeconds: Math.floor((now - station.lastSeenAt) / 1000) })),
    war: getWarAdminStatus(), queue: visitorQueue,
    server: { uptime: Math.floor(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024) },
  });
});
app.post('/api/admin/stations/:id/home', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const station = clientPresence.get(id);
  if (!station || Date.now() - station.lastSeenAt > 15_000) return res.status(404).json({ error: '접속 중인 PC를 찾을 수 없습니다.' });
  if (station.mode === 'WAR') {
    const closed = resetWarMatch();
    return res.json({ ok: true, warReset: true, closed });
  }
  station.command = 'home';
  res.json({ ok: true });
});
app.post('/api/admin/war/reset', requireAdmin, (req, res) => res.json({ ok: true, closed: resetWarMatch() }));
app.post('/api/admin/queue', requireAdmin, (req, res) => {
  const name = clean(req.body?.name, 30);
  if (!name) return res.status(400).json({ error: '이름을 입력해 주세요.' });
  const entry = { id: ++queueEntryId, name, addedAt: new Date().toISOString() };
  visitorQueue.push(entry);
  res.status(201).json(entry);
});
app.post('/api/admin/queue/next', requireAdmin, (req, res) => res.json({ entry: visitorQueue.shift() || null }));
app.delete('/api/admin/queue/:id', requireAdmin, (req, res) => {
  const index = visitorQueue.findIndex(entry => entry.id === Number(req.params.id));
  if (index < 0) return res.status(404).json({ error: '대기 항목을 찾을 수 없습니다.' });
  visitorQueue.splice(index, 1);
  res.json({ ok: true });
});

app.post('/api/session', (req, res) => {
  const requestedToken = clean(req.get('x-soldiers-session'), 80);
  let token = requestedToken;
  let id = rankSessions.get(token);
  if (!id) {
    token = randomUUID();
    id = nextClientId++;
    rankSessions.set(token, id);
  }
  res.set('Cache-Control', 'no-store');
  res.json({ id, token });
});

app.get('/api/ranks', async (req, res, next) => {
  const clientId = requestClientId(req);
  if (clientId === null) return res.status(428).json({ error: 'Client session required' });
  try {
    const rows = await enqueueRankOperation(clientId, async () => rankPlayers((await readRankPlayers()).players));
    res.json(rows);
  } catch (error) { next(error); }
});
app.post('/api/ranks', async (req, res, next) => {
  const clientId = requestClientId(req);
  if (clientId === null) return res.status(428).json({ error: 'Client session required' });
  try {
    const rows = await enqueueRankOperation(clientId, () => saveFirstModeScore(req.body || {}));
    res.status(201).json(rows);
  } catch (error) { next(error); }
});
app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Rank storage failed' });
});

const server = createServer(app);
attachWar(server);
server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`Soldiers : http://localhost:${PORT} (PID ${process.pid})`);
  console.log(`Operator panel: http://localhost:${PORT}/admin`);
  if (!process.env.ADMIN_PIN) console.log(`Admin PIN (this server run): ${adminPin}`);
});
server.on('error', error => {
  console.error(`Server failed to listen on port ${PORT}:`, error);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`Received ${signal}; stopping Soldiers server.`);
    server.close(() => process.exit(0));
  });
}
