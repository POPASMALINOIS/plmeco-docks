import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';

/* ========= Config ========= */
const PORT = Number(process.env.PORT || 4000);
const TOKEN = (process.env.TOKEN || '').trim();
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

if (!TOKEN) {
  console.error('[FATAL] Debes definir TOKEN en backend/.env');
  process.exit(1);
}

/* ========= App/HTTP ========= */
const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.get('/', (_req, res) => res.type('text/plain').send('PLMECO Sync Backend OK'));

/* ========= Socket.IO ========= */
const httpServer = createServer(app);
const io = new Server(httpServer, {
  transports: ['websocket'],
  cors: { origin: CORS_ORIGIN }
});

/** Estado compartido en memoria (estructura libre, el frontend manda el shape) */
let STATE = {
  lados: {} // lo rellenará el primer cliente; luego se sincroniza entre todos
};

/** Fusión profunda simple (arrays se reemplazan) */
function deepMerge(base, delta) {
  if (Array.isArray(base) && Array.isArray(delta)) return delta.slice();
  if (base && typeof base === 'object' && !Array.isArray(base)
   && delta && typeof delta === 'object' && !Array.isArray(delta)) {
    const out = { ...base };
    for (const k of Object.keys(delta)) out[k] = deepMerge(base[k], delta[k]);
    return out;
  }
  return delta;
}

io.use((socket, next) => {
  try {
    const token = (socket.handshake.auth && socket.handshake.auth.token) ? String(socket.handshake.auth.token) : '';
    if (!token || token !== TOKEN) return next(new Error('UNAUTHORIZED'));
    return next();
  } catch (e) {
    return next(new Error('UNAUTHORIZED'));
  }
});

io.on('connection', (socket) => {
  // Enviamos el estado actual al cliente que entra
  socket.emit('state:init', STATE);

  // Cliente decide reemplazar todo el estado compartido
  socket.on('state:replace', (next) => {
    try {
      if (!next || typeof next !== 'object') return;
      STATE = next;
      socket.broadcast.emit('state:replace', STATE);
    } catch {}
  });

  // Cliente envía un "patch" — lo fusionamos y reenviamos a otros
  socket.on('state:patch', (delta) => {
    try {
      if (!delta || typeof delta !== 'object') return;
      STATE = deepMerge(STATE, delta);
      socket.broadcast.emit('state:patch', delta);
    } catch {}
  });
});

/* ========= Start ========= */
httpServer.listen(PORT, () => {
  console.log(`[PLMECO] Sync backend escuchando en :${PORT}`);
});
