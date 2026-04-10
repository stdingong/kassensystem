const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

// Broadcast event to all connected clients
function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
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
`);

// Seed default products if empty
const count = db.prepare('SELECT COUNT(*) as c FROM products').get();
if (count.c === 0) {
  const insert = db.prepare('INSERT INTO products (name, price, category, icon) VALUES (?, ?, ?, ?)');
  const defaults = [
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
  ];
  defaults.forEach(d => insert.run(...d));
}

// ─── PRODUCTS API ────────────────────────────────────────────────

// GET all active products
app.get('/api/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY category, name').all();
  res.json(products);
});

// POST new product
app.post('/api/products', (req, res) => {
  const { name, price, category, icon } = req.body;
  if (!name || price == null || !category) return res.status(400).json({ error: 'Fehlende Felder' });
  const result = db.prepare('INSERT INTO products (name, price, category, icon) VALUES (?, ?, ?, ?)').run(name, price, category, icon || '📦');
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  broadcast('products_changed', {});
  res.json(product);
});

// DELETE product (soft delete)
app.delete('/api/products/:id', (req, res) => {
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  broadcast('products_changed', {});
  res.json({ ok: true });
});

// ─── TRANSACTIONS API ─────────────────────────────────────────────

// GET transactions (today by default, or ?all=1)
app.get('/api/transactions', (req, res) => {
  let rows;
  if (req.query.all) {
    rows = db.prepare('SELECT * FROM transactions ORDER BY created_at DESC').all();
  } else {
    rows = db.prepare("SELECT * FROM transactions WHERE date(created_at) = date('now','localtime') ORDER BY created_at DESC").all();
  }
  const result = rows.map(t => ({
    ...t,
    items: JSON.parse(t.items_json)
  }));
  res.json(result);
});

// POST new transaction (checkout)
app.post('/api/transactions', (req, res) => {
  const { total, method, items } = req.body;
  if (!total || !method || !items?.length) return res.status(400).json({ error: 'Fehlende Felder' });

  const insertTx = db.prepare('INSERT INTO transactions (total, method, items_json) VALUES (?, ?, ?)');
  const insertItem = db.prepare('INSERT INTO transaction_items (transaction_id, product_id, product_name, price, qty) VALUES (?, ?, ?, ?, ?)');

  const tx = db.transaction(() => {
    const result = insertTx.run(total, method, JSON.stringify(items));
    items.forEach(item => {
      insertItem.run(result.lastInsertRowid, item.id, item.name, item.price, item.qty);
    });
    return db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);
  });

  const saved = tx();
  broadcast('transaction', { ...saved, items });
  res.json({ ...saved, items });
});

// GET stats summary (today)
app.get('/api/stats', (req, res) => {
  const today = db.prepare(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(total), 0) as total,
      COALESCE(SUM(CASE WHEN method='Bargeld' THEN total ELSE 0 END), 0) as cash,
      COALESCE(SUM(CASE WHEN method='Karte' THEN total ELSE 0 END), 0) as card
    FROM transactions WHERE date(created_at) = date('now','localtime')
  `).get();
  res.json(today);
});

// DELETE all today's transactions (Tagesabschluss)
app.delete('/api/transactions/today', (req, res) => {
  db.prepare("DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE date(created_at) = date('now','localtime'))").run();
  db.prepare("DELETE FROM transactions WHERE date(created_at) = date('now','localtime')").run();
  broadcast('reset', {});
  res.json({ ok: true });
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Kassensystem läuft auf Port ${PORT}`);
});
