const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// ── WebSocket ─────────────────────────────────────────────────
const wss = new WebSocketServer({ server });
const clients = new Set();
wss.on('connection', ws => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});
function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Database ──────────────────────────────────────────────────
const db = new Database(process.env.DB_PATH || './kasse.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    floor_id TEXT    NOT NULL DEFAULT 'keller',
    name     TEXT    NOT NULL,
    price    REAL    NOT NULL,
    category TEXT    NOT NULL,
    icon     TEXT    NOT NULL DEFAULT '📦',
    active   INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    floor_id   TEXT NOT NULL,
    total      REAL NOT NULL,
    method     TEXT NOT NULL,
    items_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Settings helpers ──────────────────────────────────────────
function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// ── Seed products ─────────────────────────────────────────────
if (db.prepare('SELECT COUNT(*) as c FROM products').get().c === 0) {
  const ins = db.prepare(
    'INSERT INTO products (floor_id, name, price, category, icon) VALUES (?, ?, ?, ?, ?)'
  );
  const seed = [
    // Kellerbar
    ['keller', 'Bier 0,5L',    3.00, 'Bier',        '🍺'],
    ['keller', 'Bier 0,3L',    2.00, 'Bier',        '🍻'],
    ['keller', 'Radler',       2.50, 'Bier',        '🍋'],
    ['keller', 'Shot Tequila', 2.50, 'Shots',       '🥃'],
    ['keller', 'Shot Vodka',   2.50, 'Shots',       '🔥'],
    ['keller', 'Shot Rum',     2.50, 'Shots',       '💀'],
    ['keller', 'Jäger Shot',   2.00, 'Shots',       '🦌'],
    // Erdgeschossbar
    ['erd', 'Bier 0,5L',    3.00, 'Bier',         '🍺'],
    ['erd', 'Bier 0,3L',    2.00, 'Bier',         '🍻'],
    ['erd', 'Sekt',         4.00, 'Sekt & Wein',  '🥂'],
    ['erd', 'Prosecco',     3.50, 'Sekt & Wein',  '🍾'],
    ['erd', 'Matte',        3.00, 'Sekt & Wein',  '🧃'],
    ['erd', 'Äppler',       2.50, 'Sekt & Wein',  '🍏'],
    ['erd', 'Wein rot',     3.50, 'Sekt & Wein',  '🍷'],
    ['erd', 'Wein weiß',    3.50, 'Sekt & Wein',  '🥃'],
    ['erd', 'Shot Tequila', 2.50, 'Shots',        '🔥'],
    ['erd', 'Shot Vodka',   2.50, 'Shots',        '💀'],
    ['erd', 'Cola',         2.00, 'Alkoholfrei',  '🥤'],
    ['erd', 'Wasser',       1.50, 'Alkoholfrei',  '💧'],
    ['erd', 'Orangensaft',  2.00, 'Alkoholfrei',  '🍊'],
    ['erd', 'Apfelsaft',    2.00, 'Alkoholfrei',  '🍎'],
    ['erd', 'Spezi',        2.00, 'Alkoholfrei',  '🧃'],
  ];
  seed.forEach(row => ins.run(...row));
}

// ── Auth ──────────────────────────────────────────────────────
app.post('/api/auth/pin', (req, res) => {
  res.json({ ok: req.body.pin === getSetting('kassierer_pin', '1234') });
});

app.post('/api/auth/admin', (req, res) => {
  res.json({ ok: req.body.password === getSetting('admin_password', 'admin123') });
});

app.post('/api/auth/change-pin', (req, res) => {
  if (req.body.adminPassword !== getSetting('admin_password', 'admin123'))
    return res.status(403).json({ error: 'Falsches Admin-Passwort' });
  if (!/^\d{4,8}$/.test(req.body.newPin))
    return res.status(400).json({ error: 'PIN muss 4–8 Ziffern haben' });
  setSetting('kassierer_pin', req.body.newPin);
  res.json({ ok: true });
});

app.post('/api/auth/change-password', (req, res) => {
  if (req.body.adminPassword !== getSetting('admin_password', 'admin123'))
    return res.status(403).json({ error: 'Falsches Admin-Passwort' });
  if (!req.body.newPassword || req.body.newPassword.length < 4)
    return res.status(400).json({ error: 'Passwort zu kurz' });
  setSetting('admin_password', req.body.newPassword);
  res.json({ ok: true });
});

// ── Products ──────────────────────────────────────────────────
app.get('/api/products', (req, res) => {
  const sql = req.query.floor
    ? 'SELECT * FROM products WHERE active=1 AND floor_id=? ORDER BY category, name'
    : 'SELECT * FROM products WHERE active=1 ORDER BY floor_id, category, name';
  const args = req.query.floor ? [req.query.floor] : [];
  res.json(db.prepare(sql).all(...args));
});

app.post('/api/products', (req, res) => {
  const { floor_id, name, price, category, icon, adminPassword } = req.body;
  if (adminPassword !== getSetting('admin_password', 'admin123'))
    return res.status(403).json({ error: 'Nicht autorisiert' });
  if (!floor_id || !name || price == null || !category)
    return res.status(400).json({ error: 'Fehlende Felder' });
  const r = db.prepare(
    'INSERT INTO products (floor_id, name, price, category, icon) VALUES (?, ?, ?, ?, ?)'
  ).run(floor_id, name, price, category, icon || '📦');
  broadcast('products_changed', { floor_id });
  res.json(db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid));
});

app.delete('/api/products/:id', (req, res) => {
  if (req.body.adminPassword !== getSetting('admin_password', 'admin123'))
    return res.status(403).json({ error: 'Nicht autorisiert' });
  const p = db.prepare('SELECT floor_id FROM products WHERE id=?').get(req.params.id);
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(req.params.id);
  broadcast('products_changed', { floor_id: p?.floor_id });
  res.json({ ok: true });
});

// ── Transactions ──────────────────────────────────────────────
app.get('/api/transactions', (req, res) => {
  const today = "date(created_at) = date('now','localtime')";
  let sql = `SELECT * FROM transactions WHERE ${req.query.all ? '1=1' : today}`;
  if (req.query.floor) sql += ' AND floor_id = ?';
  sql += ' ORDER BY created_at DESC';
  const args = req.query.floor ? [req.query.floor] : [];
  const rows = db.prepare(sql).all(...args);
  res.json(rows.map(t => ({ ...t, items: JSON.parse(t.items_json) })));
});

app.post('/api/transactions', (req, res) => {
  const { floor_id, total, method, items } = req.body;
  if (!floor_id || !total || !method || !items?.length)
    return res.status(400).json({ error: 'Fehlende Felder' });
  const r = db.prepare(
    'INSERT INTO transactions (floor_id, total, method, items_json) VALUES (?, ?, ?, ?)'
  ).run(floor_id, total, method, JSON.stringify(items));
  const saved = { ...db.prepare('SELECT * FROM transactions WHERE id=?').get(r.lastInsertRowid), items };
  broadcast('transaction', saved);
  res.json(saved);
});

// Stats: totals for today
app.get('/api/stats', (req, res) => {
  const args = req.query.floor ? [req.query.floor] : [];
  const floorClause = req.query.floor ? 'AND floor_id=?' : '';
  const row = db.prepare(`
    SELECT
      COUNT(*)  AS count,
      COALESCE(SUM(total), 0) AS total,
      COALESCE(SUM(CASE WHEN method='Bargeld' THEN total ELSE 0 END), 0) AS cash,
      COALESCE(SUM(CASE WHEN method='PayPal'  THEN total ELSE 0 END), 0) AS paypal
    FROM transactions
    WHERE date(created_at) = date('now','localtime') ${floorClause}
  `).get(...args);
  res.json(row);
});

// Stats: per-product quantities today
app.get('/api/stats/products', (req, res) => {
  const rows = db.prepare(
    "SELECT items_json FROM transactions WHERE date(created_at) = date('now','localtime')"
  ).all();
  const map = {};
  rows.forEach(r => {
    JSON.parse(r.items_json).forEach(item => {
      if (!map[item.id]) map[item.id] = { id: item.id, name: item.name, icon: item.icon, qty: 0, revenue: 0 };
      map[item.id].qty     += item.qty;
      map[item.id].revenue += item.qty * item.price;
    });
  });
  res.json(Object.values(map).sort((a, b) => b.qty - a.qty));
});

// Tagesabschluss
app.delete('/api/transactions/today', (req, res) => {
  if (req.body.pin !== getSetting('kassierer_pin', '1234'))
    return res.status(403).json({ error: 'Falscher PIN' });
  db.prepare("DELETE FROM transactions WHERE date(created_at) = date('now','localtime')").run();
  broadcast('reset', {});
  res.json({ ok: true });
});

app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

server.listen(PORT, () => console.log(`🧾 Kasse läuft auf http://localhost:${PORT}`));
