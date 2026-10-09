import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readFile, writeFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const rankPath = path.join(__dirname, 'rank.txt');
app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use('/models', express.static(path.join(__dirname, '..', 'models')));
app.use('/sound', express.static(path.join(__dirname, '..', 'sound')));
app.use('/ICONS', express.static(path.join(__dirname, '..', 'ICONS')));
const clean = (value, max = 30) => String(value ?? '').replace(/[|\r\n]/g, ' ').trim().slice(0, max);
async function readRanks() { try { const content = await readFile(rankPath, 'utf8'); return content.trim().split('\n').filter(Boolean).map((line, index) => { const [name, score, rank, level, mode, order] = line.split('|').map(part => part.trim()); return { name, score: Number(score) || 0, rank: Number(rank) || 0, level: level || '-', mode: mode || 'PRACTICE', order: Number(order) || index + 1 }; }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
async function storeRanks(rows) { const grouped = new Map(); rows.forEach(row => { const bucket = grouped.get(row.mode) || []; bucket.push(row); grouped.set(row.mode, bucket); }); const ordered = []; for (const bucket of grouped.values()) { bucket.sort((a, b) => b.score - a.score || a.order - b.order); bucket.forEach((row, index) => { row.rank = index + 1; ordered.push(row); }); } const output = ordered.map(row => `${row.name} | ${row.score} | ${row.rank} | ${row.level} | ${row.mode} | ${row.order}`).join('\n'); await writeFile(rankPath, output ? `${output}\n` : '', 'utf8'); return ordered; }
app.get('/api/ranks', async (req, res, next) => { try { res.json(await readRanks()); } catch (error) { next(error); } });
app.post('/api/ranks', async (req, res, next) => { try { const name = clean(req.body.name); const mode = clean(req.body.mode, 12).toUpperCase(); const score = Math.max(0, Math.floor(Number(req.body.score) || 0)); const level = Math.min(3, Math.max(0, Math.floor(Number(req.body.level) || 0))) || '-'; if (!name || !['PRACTICE', 'CQB'].includes(mode)) return res.status(400).json({ error: 'Invalid record' }); const rows = await readRanks(); rows.push({ name, score, rank: 0, level: mode === 'PRACTICE' ? level : '-', mode, order: rows.reduce((max, row) => Math.max(max, row.order), 0) + 1 }); const saved = await storeRanks(rows); res.status(201).json(saved.filter(row => row.mode === mode).sort((a, b) => a.rank - b.rank)); } catch (error) { next(error); } });
app.use((error, req, res, next) => { console.error(error); res.status(500).json({ error: 'Rank storage failed' }); });
const server = app.listen(PORT, () => {
  console.log(`Soldiers : http://localhost:${PORT} (PID ${process.pid})`);
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
