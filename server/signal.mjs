// Сервер сигналізації Firefighters: лише знайомить гравців кімнати і пересилає опис WebRTC-з'єднань.
// Сама гра йде напряму між браузерами (DataChannel), через сервер вона не проходить.
//
// Клієнт → сервер:
//   {t:'join', room, id}          — вхід у кімнату (id генерує клієнт на кожне завантаження сторінки)
//   {t:'signal', to, d}           — offer/answer/ICE для іншого гравця кімнати
// Сервер → клієнт:
//   {t:'welcome', peers:[id], ice:[RTCIceServer]} — хто вже в кімнаті + тимчасові облікові дані TURN
//   {t:'joined', id} / {t:'left', id}             — хтось зайшов (або перепідключився) / вийшов
//   {t:'signal', from, d}
//   {t:'full'}                                    — кімната заповнена
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ID_RE = /^[A-Za-z0-9]{8,32}$/;

export function createSignalServer({
  maxRoom = 16,                 // гравців у кімнаті
  maxPerIp = 20,                // одночасних з'єднань з однієї IP
  rate = 30, burst = 300,       // повідомлень/с і запас (ICE-кандидати приходять пачками)
  heartbeatMs = 15000,          // ping; хто не відповів до наступного — від'єднується
  turnSecret = null,
  turnUrls = [],
  turnTtl = 24 * 3600,
  log = () => {},
} = {}) {
  const rooms = new Map();      // roomId -> Map(id -> client)
  const perIp = new Map();

  const send = (c, msg) => { try { c.ws.send(JSON.stringify(msg)); } catch {} };
  const broadcast = (room, msg, except) => {
    for (const c of room.values()) if (c !== except) send(c, msg);
  };

  // Облікові дані TURN за схемою TURN REST API (coturn use-auth-secret), як у turn.php
  function turnCreds() {
    if (!turnSecret || !turnUrls.length) return [];
    const username = `${Math.floor(Date.now() / 1000) + turnTtl}:${randomBytes(8).toString('hex')}`;
    const credential = createHmac('sha1', turnSecret).update(username).digest('base64');
    return [{ urls: turnUrls, username, credential }];
  }

  function leave(c) {
    if (!c.room) return;
    const room = rooms.get(c.room);
    if (room && room.get(c.id) === c) {
      room.delete(c.id);
      broadcast(room, { t: 'left', id: c.id });
      if (!room.size) rooms.delete(c.room);
    }
    c.room = null;
  }

  function onMessage(c, raw) {
    const now = Date.now();
    c.tokens = Math.min(burst, c.tokens + (now - c.tokensAt) / 1000 * rate);
    c.tokensAt = now;
    if (--c.tokens < 0) { log('rate limit', c.ip); return c.ws.close(4008, 'rate'); }
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'join') {
      if (c.room || !ROOM_RE.test(m.room || '') || !ID_RE.test(m.id || '')) return c.ws.close(4001, 'bad join');
      let room = rooms.get(m.room);
      if (!room) rooms.set(m.room, room = new Map());
      const old = room.get(m.id);
      if (!old && room.size >= maxRoom) { send(c, { t: 'full' }); return c.ws.close(4002, 'full'); }
      if (old) { old.room = null; room.delete(m.id); try { old.ws.close(4003, 'replaced'); } catch {} }  // перепідключення з тим самим id
      c.room = m.room;
      c.id = m.id;
      send(c, { t: 'welcome', peers: [...room.keys()], ice: turnCreds() });
      broadcast(room, { t: 'joined', id: c.id });
      room.set(c.id, c);
      return;
    }
    if (m.t === 'signal') {
      const room = c.room && rooms.get(c.room);
      const to = room && typeof m.to === 'string' && room.get(m.to);
      if (to && to !== c && m.d && typeof m.d === 'object') send(to, { t: 'signal', from: c.id, d: m.d });
    }
  }

  function handleConnection(ws, { ip = '?' } = {}) {
    const n = perIp.get(ip) || 0;
    if (n >= maxPerIp) { try { ws.close(4029, 'too many'); } catch {} return; }
    perIp.set(ip, n + 1);
    const c = { ws, ip, id: null, room: null, alive: true, tokens: burst, tokensAt: Date.now() };
    ws.on('message', (raw) => onMessage(c, raw));
    ws.on('pong', () => { c.alive = true; });
    ws.on('close', () => {
      leave(c);
      const k = (perIp.get(ip) || 1) - 1;
      if (k) perIp.set(ip, k); else perIp.delete(ip);
      clients.delete(c);
    });
    ws.on('error', () => {});
    clients.add(c);
  }

  const clients = new Set();
  const hb = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) { try { c.ws.terminate(); } catch {} continue; }
      c.alive = false;
      try { c.ws.ping(); } catch {}
    }
  }, heartbeatMs);

  return { handleConnection, rooms, stop: () => clearInterval(hb) };
}

// ---------- Запуск як служба ----------
async function main() {
  const env = process.env;
  const require = createRequire(import.meta.url);
  const { WebSocketServer } = require('ws');             // пакет node-ws з apt (або npm ws)
  let turnSecret = null;
  try { turnSecret = readFileSync(env.FF_TURN_SECRET_FILE || '/etc/ff-turn/secret', 'utf8').trim() || null; }
  catch (e) { console.error('TURN-секрет недоступний, працюємо без TURN:', e.message); }
  const origins = (env.FF_ORIGINS || 'https://iclimber.github.io').split(',').map(s => s.trim()).filter(Boolean);
  const server = createSignalServer({
    turnSecret,
    turnUrls: (env.FF_TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean),
    log: (...a) => console.log(...a),
  });
  const wss = new WebSocketServer({
    host: env.FF_HOST || '127.0.0.1',
    port: Number(env.FF_PORT || 8090),
    maxPayload: 16 * 1024,
    perMessageDeflate: false,
    verifyClient: ({ origin }) => origins.includes('*') || origins.includes(origin),
  });
  wss.on('connection', (ws, req) => {
    const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
    server.handleConnection(ws, { ip });
  });
  wss.on('listening', () => console.log(`ff-signal: ${env.FF_HOST || '127.0.0.1'}:${env.FF_PORT || 8090}, origins ${origins.join(' ')}`));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
