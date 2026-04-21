const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// WebSocket
const wss = new WebSocketServer({ server });
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});
function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database
const db = new Database(process.env.DB_PATH || './kasse.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    category TEXT NOT NULL,
    icon TEXT DEFAULT '📦',
    active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total REAL NOT NULL,
    method TEXT NOT NULL,
    items_json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS transaction_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    price REAL NOT NULL,
    qty INTEGER NOT NULL,
    FOREIGN KEY(transaction_id) REFERENCES transactions(id)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Default PINs/passwords if not set
// Kassierer-PIN: 1234  |  Admin-Passwort: admin123
function getSetting(key, def) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : def;
}
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// Seed default products
const count = db.prepare('SELECT COUNT(*) as c FROM products').get();
if (count.c === 0) {
  const ins = db.prepare('INSERT INTO products (name, price, category, icon) VALUES (?, ?, ?, ?)');
  [
    ['Cola', 2.50, 'Getränke', '🥤'],
    ['Wasser', 1.50, 'Getränke', '💧'],
    ['Bier', 3.00, 'Getränke', '🍺'],
    ['Kaffee', 2.00, 'Getränke', '☕'],
    ['Bratwurst', 3.50, 'Essen', '🌭'],
    ['Burger', 5.00, 'Essen', '🍔'],
    ['Pommes', 2.50, 'Essen', '🍟'],
    ['Kuchen', 2.00, 'Essen', '🍰'],
    ['Lotterielos', 1.00, 'Sonstiges', '🎟️'],
    ['T-Shirt', 10.00, 'Sonstiges', '👕'],
  ].forEach(d => ins.run(...d));
}

// ── AUTH ─────────────────────────────────────────────────────────

// Verify kassierer PIN (protects stats, tagesabschluss)
app.post('/api/auth/pin', (req, res) => {
  const { pin } = req.body;
  const stored = getSetting('kassierer_pin', '1234');
  res.json({ ok: pin === stored });
});

// Verify admin password (protects products management)
app.post('/api/auth/admin', (req, res) => {
  const { password } = req.body;
  const stored = getSetting('admin_password', 'admin123');
  res.json({ ok: password === stored });
});

// Change PIN (admin only)
app.post('/api/auth/change-pin', (req, res) => {
  const { adminPassword, newPin } = req.body;
  const stored = getSetting('admin_password', 'admin123');
  if (adminPassword !== stored) return res.status(403).json({ error: 'Falsches Admin-Passwort' });
  if (!/^\d{4,8}$/.test(newPin)) return res.status(400).json({ error: 'PIN muss 4-8 Ziffern haben' });
  setSetting('kassierer_pin', newPin);
  res.json({ ok: true });
});

// Change admin password (admin only)
app.post('/api/auth/change-password', (req, res) => {
  const { adminPassword, newPassword } = req.body;
  const stored = getSetting('admin_password', 'admin123');
  if (adminPassword !== stored) return res.status(403).json({ error: 'Falsches Admin-Passwort' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'Passwort zu kurz' });
  setSetting('admin_password', newPassword);
  res.json({ ok: true });
});

// ── PRODUCTS ─────────────────────────────────────────────────────

app.get('/api/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY category, name').all());
});

app.post('/api/products', (req, res) => {
  const { name, price, category, icon, adminPassword } = req.body;
  if (adminPassword !== getSetting('admin_password', 'admin123'))
    return res.status(403).json({ error: 'Nicht autorisiert' });
  if (!name || price == null || !category) return res.status(400).json({ error: 'Fehlende Felder' });
  const result = db.prepare('INSERT INTO products (name, price, category, icon) VALUES (?, ?, ?, ?)').run(name, price, category, icon || '📦');
  broadcast('products_changed', {});
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid));
});

app.delete('/api/products/:id', (req, res) => {
  const { adminPassword } = req.body;
  if (adminPassword !== getSetting('admin_password', 'admin123'))
    return res.status(403).json({ error: 'Nicht autorisiert' });
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  broadcast('products_changed', {});
  res.json({ ok: true });
});

// ── TRANSACTIONS ─────────────────────────────────────────────────

app.get('/api/transactions', (req, res) => {
  const rows = req.query.all
    ? db.prepare('SELECT * FROM transactions ORDER BY created_at DESC').all()
    : db.prepare("SELECT * FROM transactions WHERE date(created_at) = date('now','localtime') ORDER BY created_at DESC").all();
  res.json(rows.map(t => ({ ...t, items: JSON.parse(t.items_json) })));
});

app.post('/api/transactions', (req, res) => {
  const { total, method, items } = req.body;
  if (!total || !method || !items?.length) return res.status(400).json({ error: 'Fehlende Felder' });
  const insertTx = db.prepare('INSERT INTO transactions (total, method, items_json) VALUES (?, ?, ?)');
  const insertItem = db.prepare('INSERT INTO transaction_items (transaction_id, product_id, product_name, price, qty) VALUES (?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    const r = insertTx.run(total, method, JSON.stringify(items));
    items.forEach(i => insertItem.run(r.lastInsertRowid, i.id, i.name, i.price, i.qty));
    return db.prepare('SELECT * FROM transactions WHERE id = ?').get(r.lastInsertRowid);
  });
  const saved = tx();
  broadcast('transaction', { ...saved, items });
  res.json({ ...saved, items });
});

app.get('/api/stats', (req, res) => {
  res.json(db.prepare(`
    SELECT COUNT(*) as count,
      COALESCE(SUM(total),0) as total,
      COALESCE(SUM(CASE WHEN method='Bargeld' THEN total ELSE 0 END),0) as cash,
      COALESCE(SUM(CASE WHEN method='Karte' THEN total ELSE 0 END),0) as card
    FROM transactions WHERE date(created_at) = date('now','localtime')
  `).get());
});

app.delete('/api/transactions/today', (req, res) => {
  const { pin } = req.body;
  if (pin !== getSetting('kassierer_pin', '1234'))
    return res.status(403).json({ error: 'Falscher PIN' });
  db.prepare("DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE date(created_at) = date('now','localtime'))").run();
  db.prepare("DELETE FROM transactions WHERE date(created_at) = date('now','localtime')").run();
  broadcast('reset', {});
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => console.log(`Kassensystem läuft auf Port ${PORT}`));
