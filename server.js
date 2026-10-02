// Qubik server: раздаёт игру (public/index.html) и ретранслирует мультиплеер по WebSocket.
// Хост-клиент хранит мир; сервер только маршрутизирует сообщения между игроками одной комнаты.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
const HTML = path.join(__dirname, 'public', 'index.html');

const server = http.createServer((req, res) => {
  if (req.url === '/health') return res.end('ok');
  fs.readFile(HTML, (e, d) => {
    if (e) { res.writeHead(404); return res.end('public/index.html не найден'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(d);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 32 * 1024 * 1024 });

const users = new Map();   // id -> {id, ws, n, room}
const rooms = new Map();   // hostId -> {id, name, size, members:Set<id>}
let seq = 0;
const newId = () => Math.random().toString(36).slice(2, 7) + (seq++).toString(36);
const send = (u, m) => { if (u && u.ws.readyState === 1) u.ws.send(JSON.stringify(m)); };

function uniqueNick(raw) {
  let n = String(raw || 'Player').replace(/[^\p{L}\p{N}_ -]/gu, '').trim().slice(0, 16) || 'Player';
  const taken = new Set([...users.values()].map(u => u.n.toLowerCase()));
  let t = n, i = 1;
  while (taken.has(t.toLowerCase())) t = n.slice(0, 12) + '#' + (++i);
  return t;
}
const roomList = () => [...rooms.values()].map(r => ({ id: r.id, name: r.name, host: users.get(r.id)?.n || '?', count: r.members.size, size: r.size }));
const pushRooms = () => { const list = roomList(); for (const u of users.values()) send(u, { t: 'rooms', list }); };
function toRoom(u, m) {
  const r = rooms.get(u.room); if (!r) return;
  for (const id of r.members) if (id !== u.id) send(users.get(id), m);
}
function leave(u) {
  const r = rooms.get(u.room);
  if (r) {
    if (r.id === u.id) {                                  // хост вышел — комната закрывается
      for (const id of r.members) if (id !== u.id) { const o = users.get(id); if (o) { o.room = null; send(o, { t: 'closed' }); } }
      rooms.delete(r.id);
    } else { r.members.delete(u.id); toRoom({ ...u, room: r.id }, { t: 'leave', from: u.id }); }
  }
  u.room = null; pushRooms();
}

wss.on('connection', ws => {
  const u = { id: newId(), ws, n: uniqueNick('Player'), room: null, alive: true };
  users.set(u.id, u);
  ws.on('pong', () => { u.alive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case 'hello': u.n = uniqueNick(m.n); send(u, { t: 'welcome', id: u.id, n: u.n }); pushRooms(); break;
      case 'nick': u.n = uniqueNick(m.n); send(u, { t: 'welcome', id: u.id, n: u.n }); break;
      case 'host':
        if (u.room) leave(u);
        rooms.set(u.id, { id: u.id, name: String(m.name || 'Мир').slice(0, 24), size: m.size | 0, members: new Set([u.id]) });
        u.room = u.id; pushRooms(); break;
      case 'join': {
        const r = rooms.get(m.host); if (!r) return send(u, { t: 'err', x: 'Мир закрыт или не найден' });
        if (u.room) leave(u);
        r.members.add(u.id); u.room = r.id;
        send(users.get(r.id), { t: 'join', from: u.id, host: r.id }); pushRooms(); break;
      }
      case 'world': { const r = rooms.get(u.room); if (r && r.id === u.id) send(users.get(m.to), { ...m, from: u.id }); break; }
      case 'pos': case 'set': case 'chat': {
        if (!u.room) break;
        if (m.t === 'chat') { m.x = String(m.x || '').slice(0, 120); m.n = u.n; }
        if (m.t === 'pos') m.n = u.n;
        toRoom(u, { ...m, from: u.id }); break;
      }
      case 'leave': if (u.room) leave(u); break;
      case 'find': {
        const q = String(m.nick || '').toLowerCase();
        const f = [...users.values()].find(o => o.n.toLowerCase() === q);
        send(u, { t: 'found', n: f ? f.n : String(m.nick || ''), online: !!f, w: f && rooms.get(f.room)?.name || '' }); break;
      }
      case 'watch': {
        const s = {};
        for (const n of (m.nicks || []).slice(0, 60)) {
          const f = [...users.values()].find(o => o.n.toLowerCase() === String(n).toLowerCase());
          if (f) s[n] = { room: f.room && rooms.get(f.room) ? f.room : null, w: rooms.get(f.room)?.name || '' };
        }
        send(u, { t: 'status', s }); break;
      }
    }
  });
  ws.on('close', () => { leave(u); users.delete(u.id); pushRooms(); });
  ws.on('error', () => {});
});

setInterval(() => {                                       // keep-alive: хостинги режут «молчащие» соединения
  for (const u of users.values()) { if (!u.alive) { u.ws.terminate(); continue; } u.alive = false; try { u.ws.ping(); } catch {} }
}, 25000);

server.listen(PORT, () => console.log('Qubik server on :' + PORT));
