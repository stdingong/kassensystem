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
wss.on('connection', ws => { clients.add(ws); ws.on('close', () => clients.delete(ws)); });
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
  CREATE TABLE IF NOT EXISTS floors (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    emoji TEXT DEFAULT '🍺',
    color TEXT DEFAULT '#b45309',
    light TEXT DEFAULT '#fef3c7'
  );
  CREATE TABLE IF NOT EXISTS products (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    floor_id TEXT NOT NULL,
    name     TEXT NOT NULL,
    price    REAL NOT NULL,
    category TEXT NOT NULL,
    icon     TEXT DEFAULT '📦',
    active   INTEGER DEFAULT 1,
    FOREIGN KEY(floor_id) REFERENCES floors(id)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    floor_id   TEXT NOT NULL,
    total      REAL NOT NULL,
    method     TEXT NOT NULL,
    items_json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Seed defaults ─────────────────────────────────────────────
function getSetting(key, def) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : def;
}
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(key, value);
}

const floorCount = db.prepare('SELECT COUNT(*) as c FROM floors').get().c;
if (floorCount === 0) {
  const iFloor = db.prepare('INSERT INTO floors(id,name,emoji,color,light) VALUES(?,?,?,?,?)');
  const iProd  = db.prepare('INSERT INTO products(floor_id,name,price,category,icon) VALUES(?,?,?,?,?)');

  iFloor.run('keller','Kellerbar','🍺','#b45309','#fef3c7');
  [
    ['Bier 0,5L',3.0,'Bier','🍺'],['Bier 0,3L',2.0,'Bier','🍻'],['Radler',2.5,'Bier','🍋'],
    ['Shot Tequila',2.5,'Shots','🥃'],['Shot Vodka',2.5,'Shots','🔥'],
    ['Shot Rum',2.5,'Shots','💀'],['Jäger Shot',2.0,'Shots','🦌'],
  ].forEach(([n,p,c,i]) => iProd.run('keller',n,p,c,i));

  iFloor.run('erd','Erdgeschossbar','🥂','#6d28d9','#ede9fe');
  [
    ['Bier 0,5L',3.0,'Bier','🍺'],['Bier 0,3L',2.0,'Bier','🍻'],
    ['Sekt',4.0,'Sekt & Wein','🥂'],['Prosecco',3.5,'Sekt & Wein','🍾'],
    ['Matte',3.0,'Sekt & Wein','🧃'],['Äppler',2.5,'Sekt & Wein','🍏'],
    ['Wein rot',3.5,'Sekt & Wein','🍷'],['Wein weiß',3.5,'Sekt & Wein','🥃'],
    ['Shot Tequila',2.5,'Shots','🔥'],['Shot Vodka',2.5,'Shots','💀'],
    ['Cola',2.0,'Alkoholfrei','🥤'],['Wasser',1.5,'Alkoholfrei','💧'],
    ['Orangensaft',2.0,'Alkoholfrei','🍊'],['Apfelsaft',2.0,'Alkoholfrei','🍎'],
    ['Spezi',2.0,'Alkoholfrei','🧃'],
  ].forEach(([n,p,c,i]) => iProd.run('erd',n,p,c,i));
}

// ── Auth ──────────────────────────────────────────────────────
app.post('/api/auth/pin',      (req,res) => res.json({ ok: req.body.pin      === getSetting('kassierer_pin','1234') }));
app.post('/api/auth/admin',    (req,res) => res.json({ ok: req.body.password === getSetting('admin_password','admin123') }));

app.post('/api/auth/change-pin', (req,res) => {
  if (req.body.adminPassword !== getSetting('admin_password','admin123')) return res.status(403).json({ error:'Falsches Admin-Passwort' });
  if (!/^\d{4,8}$/.test(req.body.newPin)) return res.status(400).json({ error:'PIN muss 4–8 Ziffern haben' });
  setSetting('kassierer_pin', req.body.newPin);
  res.json({ ok:true });
});
app.post('/api/auth/change-password', (req,res) => {
  if (req.body.adminPassword !== getSetting('admin_password','admin123')) return res.status(403).json({ error:'Falsches Admin-Passwort' });
  if (!req.body.newPassword || req.body.newPassword.length < 4) return res.status(400).json({ error:'Passwort zu kurz' });
  setSetting('admin_password', req.body.newPassword);
  res.json({ ok:true });
});

// ── Floors ────────────────────────────────────────────────────
app.get('/api/floors', (req,res) => res.json(db.prepare('SELECT * FROM floors').all()));

app.post('/api/floors', (req,res) => {
  const { id, name, emoji, color, light, adminPassword } = req.body;
  if (adminPassword !== getSetting('admin_password','admin123')) return res.status(403).json({ error:'Nicht autorisiert' });
  if (!id || !name) return res.status(400).json({ error:'Fehlende Felder' });
  db.prepare('INSERT INTO floors(id,name,emoji,color,light) VALUES(?,?,?,?,?)').run(id, name, emoji||'🍺', color||'#b45309', light||'#fef3c7');
  broadcast('floors_changed', {});
  res.json(db.prepare('SELECT * FROM floors WHERE id=?').get(id));
});

app.delete('/api/floors/:id', (req,res) => {
  const { adminPassword } = req.body;
  if (adminPassword !== getSetting('admin_password','admin123')) return res.status(403).json({ error:'Nicht autorisiert' });
  db.prepare('UPDATE products SET active=0 WHERE floor_id=?').run(req.params.id);
  db.prepare('DELETE FROM floors WHERE id=?').run(req.params.id);
  broadcast('floors_changed', {});
  res.json({ ok:true });
});

// ── Products ──────────────────────────────────────────────────
app.get('/api/products', (req,res) => {
  const where = req.query.floor ? 'AND floor_id=?' : '';
  const args  = req.query.floor ? [req.query.floor] : [];
  res.json(db.prepare(`SELECT * FROM products WHERE active=1 ${where} ORDER BY floor_id,category,name`).all(...args));
});

app.post('/api/products', (req,res) => {
  const { floor_id, name, price, category, icon, adminPassword } = req.body;
  if (adminPassword !== getSetting('admin_password','admin123')) return res.status(403).json({ error:'Nicht autorisiert' });
  if (!floor_id||!name||price==null||!category) return res.status(400).json({ error:'Fehlende Felder' });
  const r = db.prepare('INSERT INTO products(floor_id,name,price,category,icon) VALUES(?,?,?,?,?)').run(floor_id,name,price,category,icon||'📦');
  broadcast('products_changed', { floor_id });
  res.json(db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid));
});

app.delete('/api/products/:id', (req,res) => {
  const { adminPassword } = req.body;
  if (adminPassword !== getSetting('admin_password','admin123')) return res.status(403).json({ error:'Nicht autorisiert' });
  const p = db.prepare('SELECT floor_id FROM products WHERE id=?').get(req.params.id);
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(req.params.id);
  broadcast('products_changed', { floor_id: p?.floor_id });
  res.json({ ok:true });
});

// ── Transactions ──────────────────────────────────────────────
app.get('/api/transactions', (req,res) => {
  let sql = "SELECT * FROM transactions WHERE date(created_at)=date('now','localtime')";
  const args = [];
  if (req.query.floor) { sql += ' AND floor_id=?'; args.push(req.query.floor); }
  if (req.query.all)   sql = 'SELECT * FROM transactions';
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...args);
  res.json(rows.map(t => ({ ...t, items: JSON.parse(t.items_json) })));
});

app.post('/api/transactions', (req,res) => {
  const { floor_id, total, method, items } = req.body;
  if (!floor_id||!total||!method||!items?.length) return res.status(400).json({ error:'Fehlende Felder' });
  const r = db.prepare('INSERT INTO transactions(floor_id,total,method,items_json) VALUES(?,?,?,?)').run(floor_id,total,method,JSON.stringify(items));
  const saved = { ...db.prepare('SELECT * FROM transactions WHERE id=?').get(r.lastInsertRowid), items };
  broadcast('transaction', saved);
  res.json(saved);
});

app.get('/api/stats', (req,res) => {
  const where = req.query.floor ? "AND floor_id=?" : "";
  const args  = req.query.floor ? [req.query.floor] : [];
  const day = db.prepare(`
    SELECT COUNT(*) as count,
      COALESCE(SUM(total),0) as total,
      COALESCE(SUM(CASE WHEN method='Bargeld' THEN total ELSE 0 END),0) as cash,
      COALESCE(SUM(CASE WHEN method='PayPal'  THEN total ELSE 0 END),0) as paypal
    FROM transactions WHERE date(created_at)=date('now','localtime') ${where}
  `).get(...args);
  res.json(day);
});

// Per-product stats for today
app.get('/api/stats/products', (req,res) => {
  const rows = db.prepare(`SELECT items_json FROM transactions WHERE date(created_at)=date('now','localtime')`).all();
  const counts = {};
  rows.forEach(r => {
    JSON.parse(r.items_json).forEach(item => {
      if (!counts[item.id]) counts[item.id] = { id:item.id, name:item.name, icon:item.icon, qty:0, revenue:0 };
      counts[item.id].qty     += item.qty;
      counts[item.id].revenue += item.qty * item.price;
    });
  });
  res.json(Object.values(counts).sort((a,b)=>b.qty-a.qty));
});

app.delete('/api/transactions/today', (req,res) => {
  const { pin } = req.body;
  if (pin !== getSetting('kassierer_pin','1234')) return res.status(403).json({ error:'Falscher PIN' });
  db.prepare("DELETE FROM transactions WHERE date(created_at)=date('now','localtime')").run();
  broadcast('reset', {});
  res.json({ ok:true });
});

app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

server.listen(PORT, () => console.log(`🧾 Kassensystem läuft auf Port ${PORT}`));
