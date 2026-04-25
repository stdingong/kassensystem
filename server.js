const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const wss = new WebSocketServer({ server });
const clients = new Set();
wss.on('connection', ws => { clients.add(ws); ws.on('close', () => clients.delete(ws)); });
function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database(process.env.DB_PATH || './kasse.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    floor_id TEXT NOT NULL DEFAULT 'keller',
    name TEXT NOT NULL, price REAL NOT NULL,
    category TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '🍺',
    img_url TEXT DEFAULT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    floor_id TEXT NOT NULL, total REAL NOT NULL,
    method TEXT NOT NULL, items_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  );
`);

function getSetting(k, d) { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : d; }
function setSetting(k, v) { db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k, v); }

if (db.prepare('SELECT COUNT(*) as c FROM products').get().c === 0) {
  const ins = db.prepare('INSERT INTO products(floor_id,name,price,category,icon) VALUES(?,?,?,?,?)');
  [
    /* ── Kellerbar ── */
    ['keller','Helles',        2.50,'Bier',       '🍺'],
    ['keller','Radler',        2.50,'Bier',       '🍋'],
    ['keller','Äppler Becher', 3.00,'Bier',       '🍏'],
    ['keller','Spezi',         3.00,'Alkoholfrei','🥤'],
    ['keller','Limo',          3.00,'Alkoholfrei','🍋'],
    ['keller','Mate',          3.00,'Alkoholfrei','🧉'],
    ['keller','Sekt',          4.00,'Sekt & Wein','🥂'],
    ['keller','Weißwein',      4.00,'Sekt & Wein','🍾'],
    ['keller','Rotling',       4.00,'Sekt & Wein','🍷'],
    ['keller','Sekt Mate',     4.00,'Sekt & Wein','🧉'],
    ['keller','Vodka Mate',    4.00,'Shots',      '🍹'],
    ['keller','Vodka Bull',    3.00,'Shots',      '⚡'],
    ['keller','Shot',          1.00,'Shots',      '🥃'],
    ['keller','Blind Shot',    0.50,'Shots',      '🎲'],
    ['keller','Äppler Flasche',5.00,'Flaschen',   '🍏'],
    ['keller','Sekt Flasche', 10.00,'Flaschen',   '🍾'],
    ['keller','Pfeffi Flasche',15.00,'Flaschen',  '🌿'],
    ['keller','Bierpong',     12.00,'Specials',   '🏓'],
    /* ── Erdgeschossbar ── */
    ['erd','Helles',      2.50,'Bier',        '🍺'],
    ['erd','Radler',      2.50,'Bier',        '🍋'],
    ['erd','Äppler',      2.50,'Bier',        '🍏'],
    ['erd','Sekt',        4.00,'Sekt & Wein', '🥂'],
    ['erd','Prosecco',    3.50,'Sekt & Wein', '🍾'],
    ['erd','Wein rot',    3.50,'Sekt & Wein', '🍷'],
    ['erd','Matte',       3.00,'Alkoholfrei', '🧉'],
    ['erd','Cola',        2.00,'Alkoholfrei', '🥤'],
    ['erd','Orangensaft', 2.00,'Alkoholfrei', '🍊'],
    ['erd','Spezi',       2.00,'Alkoholfrei', '🥤'],
    ['erd','Wasser',      1.50,'Alkoholfrei', '💧'],
    ['erd','Shot',        2.50,'Shots',       '🥃'],
  ].forEach(r => ins.run(...r));
}

app.post('/api/auth/pin',      (q,r) => r.json({ ok: q.body.pin      === getSetting('kassierer_pin','1234') }));
app.post('/api/auth/admin',    (q,r) => r.json({ ok: q.body.password === getSetting('admin_password','admin123') }));
app.post('/api/auth/change-pin', (q,r) => {
  if (q.body.adminPassword !== getSetting('admin_password','admin123')) return r.status(403).json({ error:'Falsches Passwort' });
  if (!/^\d{4,8}$/.test(q.body.newPin)) return r.status(400).json({ error:'PIN 4–8 Ziffern' });
  setSetting('kassierer_pin', q.body.newPin); r.json({ ok:true });
});
app.post('/api/auth/change-password', (q,r) => {
  if (q.body.adminPassword !== getSetting('admin_password','admin123')) return r.status(403).json({ error:'Falsches Passwort' });
  if (!q.body.newPassword || q.body.newPassword.length < 4) return r.status(400).json({ error:'Zu kurz' });
  setSetting('admin_password', q.body.newPassword); r.json({ ok:true });
});

app.get('/api/products', (q,r) => {
  const sql = q.query.floor
    ? 'SELECT * FROM products WHERE active=1 AND floor_id=? ORDER BY category,name'
    : 'SELECT * FROM products WHERE active=1 ORDER BY floor_id,category,name';
  r.json(db.prepare(sql).all(...(q.query.floor ? [q.query.floor] : [])));
});
app.post('/api/products', (q,r) => {
  if (q.body.adminPassword !== getSetting('admin_password','admin123')) return r.status(403).json({ error:'Nicht autorisiert' });
  const { floor_id,name,price,category,icon } = q.body;
  if (!floor_id||!name||price==null||!category) return r.status(400).json({ error:'Fehlende Felder' });
  const res = db.prepare('INSERT INTO products(floor_id,name,price,category,icon) VALUES(?,?,?,?,?)').run(floor_id,name,price,category,icon||'📦');
  broadcast('products_changed', { floor_id });
  r.json(db.prepare('SELECT * FROM products WHERE id=?').get(res.lastInsertRowid));
});
app.delete('/api/products/:id', (q,r) => {
  if (q.body.adminPassword !== getSetting('admin_password','admin123')) return r.status(403).json({ error:'Nicht autorisiert' });
  const p = db.prepare('SELECT floor_id FROM products WHERE id=?').get(q.params.id);
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(q.params.id);
  broadcast('products_changed', { floor_id: p?.floor_id });
  r.json({ ok:true });
});

app.get('/api/transactions', (q,r) => {
  let sql = "SELECT * FROM transactions WHERE " + (q.query.all ? '1=1' : "date(created_at)=date('now','localtime')");
  if (q.query.floor) sql += ' AND floor_id=?';
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...(q.query.floor ? [q.query.floor] : []));
  r.json(rows.map(t => ({ ...t, items: JSON.parse(t.items_json) })));
});
app.post('/api/transactions', (q,r) => {
  const { floor_id,total,method,items } = q.body;
  if (!floor_id||total==null||!method||!items?.length) return r.status(400).json({ error:'Fehlende Felder' });
  const res = db.prepare('INSERT INTO transactions(floor_id,total,method,items_json) VALUES(?,?,?,?)').run(floor_id,total,method,JSON.stringify(items));
  const saved = { ...db.prepare('SELECT * FROM transactions WHERE id=?').get(res.lastInsertRowid), items };
  broadcast('transaction', saved);
  r.json(saved);
});
app.get('/api/stats', (q,r) => {
  const fc = q.query.floor ? 'AND floor_id=?' : '';
  const fa = q.query.floor ? [q.query.floor] : [];
  r.json(db.prepare(`SELECT COUNT(*) as count,
    COALESCE(SUM(total),0) as total,
    COALESCE(SUM(CASE WHEN method='Bargeld' THEN total ELSE 0 END),0) as cash,
    COALESCE(SUM(CASE WHEN method='PayPal'  THEN total ELSE 0 END),0) as paypal
    FROM transactions WHERE date(created_at)=date('now','localtime') ${fc}`).get(...fa));
});
app.get('/api/stats/products', (q,r) => {
  const rows = db.prepare("SELECT items_json FROM transactions WHERE date(created_at)=date('now','localtime')").all();
  const map = {};
  rows.forEach(row => JSON.parse(row.items_json).forEach(item => {
    if (!map[item.id]) map[item.id] = { id:item.id, name:item.name, icon:item.icon, qty:0, revenue:0 };
    map[item.id].qty += item.qty;
    map[item.id].revenue += item.qty * item.price;
  }));
  r.json(Object.values(map).sort((a,b) => b.qty - a.qty));
});
app.delete('/api/transactions/today', (q,r) => {
  if (q.body.pin !== getSetting('kassierer_pin','1234')) return r.status(403).json({ error:'Falscher PIN' });
  db.prepare("DELETE FROM transactions WHERE date(created_at)=date('now','localtime')").run();
  broadcast('reset', {}); r.json({ ok:true });
});

app.get('*', (q,r) => r.sendFile(path.join(__dirname,'public','index.html')));
server.listen(PORT, () => console.log(`🧾 Kasse läuft auf http://localhost:${PORT}`));
