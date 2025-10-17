import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

const PORT = process.env.PORT || 4000;
const TOKEN = process.env.TOKEN || '';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS not allowed'), false);
  },
  credentials: true
}));

let appState = { lados: {} };

function checkAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const ok = auth.startsWith('Bearer ') && auth.slice(7) === TOKEN;
  if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/state', checkAuth, (req, res) => res.json(appState));
app.put('/state', checkAuth, (req, res) => {
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'invalid body' });
  appState = req.body;
  io.emit('state:replace', appState);
  res.json({ ok: true });
});

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: CORS_ORIGINS.length ? CORS_ORIGINS : true, credentials: true }
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (TOKEN && token !== TOKEN) return next(new Error('Unauthorized'));
  next();
});

io.on('connection', (socket) => {
  socket.emit('state:init', appState);
  socket.on('state:patch', (delta) => {
    if (!delta || typeof delta !== 'object') return;
    appState = deepMerge(appState, delta);
    socket.broadcast.emit('state:patch', delta);
  });
  socket.on('state:replace', (nextState) => {
    if (!nextState || typeof nextState !== 'object') return;
    appState = nextState;
    socket.broadcast.emit('state:replace', appState);
  });
});

function deepMerge(base, delta) {
  if (Array.isArray(base) && Array.isArray(delta)) return delta.slice();
  if (isObj(base) && isObj(delta)) {
    const out = { ...base };
    for (const k of Object.keys(delta)) out[k] = deepMerge(base[k], delta[k]);
    return out;
  }
  return delta;
}
function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }

httpServer.listen(PORT, () => console.log(`Backend realtime en :${PORT}`));
