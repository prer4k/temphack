import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createDb } from './db.js';
import { validateAndSanitizeSQL, getAllowedTables, setAllowedTables } from './safety.js';
import { promptToSQL, initSchema } from './nl2sql.js';

const app = express();
app.use(cors());
app.use(express.json());

let db;

// Demo schema and seed data
function initDemoDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      order_date TEXT NOT NULL,
      total REAL NOT NULL,
      status TEXT
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      category TEXT
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id),
      product_id INTEGER REFERENCES products(id),
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prompt_cache (
      prompt_hash TEXT PRIMARY KEY,
      prompt_text TEXT NOT NULL,
      generated_sql TEXT NOT NULL,
      hit_count INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS query_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT DEFAULT 'User',
      prompt TEXT NOT NULL,
      generated_sql TEXT,
      blocked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS allowed_tables (
      table_name TEXT PRIMARY KEY,
      allowed INTEGER DEFAULT 1
    );
  `);
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (count.c === 0) {
    db.exec(`
      INSERT INTO users (id, name, email, role) VALUES
        (1, 'Alice', 'alice@example.com', 'admin'),
        (2, 'Bob', 'bob@example.com', 'user'),
        (3, 'Carol', 'carol@example.com', 'user');
      INSERT INTO orders (id, user_id, order_date, total, status) VALUES
        (1, 1, '2025-01-15', 45000, 'completed'),
        (2, 2, '2025-01-20', 38000, 'completed'),
        (3, 1, '2025-02-01', 21000, 'completed'),
        (4, 3, '2025-02-10', 15000, 'pending');
      INSERT INTO products (id, name, price, category) VALUES
        (1, 'Product A', 375, 'Electronics'),
        (2, 'Product B', 388, 'Electronics'),
        (3, 'Product C', 420, 'Office');
      INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
        (1, 1, 120, 375),
        (2, 2, 98, 388),
        (3, 3, 50, 420);
      INSERT INTO allowed_tables (table_name, allowed) VALUES
        ('users', 1), ('orders', 1), ('products', 1), ('order_items', 1);
    `);
  }
}

async function start() {
  db = await createDb();
  initDemoDb();
  initSchema(db);
  db.save();
  listen();
}

// Simple hash for cache key (normalize prompt: lowercase, trim, collapse spaces)
function promptHash(text) {
  const normalized = String(text).toLowerCase().trim().replace(/\s+/g, ' ');
  let h = 0;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) - h) + normalized.charCodeAt(i) | 0;
  }
  return 'h_' + Math.abs(h).toString(36);
}

// Get or set allowed tables
app.get('/api/allowed-tables', (req, res) => {
  try {
    const allowed = getAllowedTables(db);
    res.json({ allowed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/allowed-tables', (req, res) => {
  try {
    const { tables } = req.body; // { tableName: boolean }
    setAllowedTables(db, tables);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NL2SQL: check cache first, then generate (Gemini or fallback)
app.post('/api/generate-sql', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  const hash = promptHash(prompt);
  const cached = db.prepare('SELECT generated_sql, hit_count FROM prompt_cache WHERE prompt_hash = ?').get(hash);
  if (cached) {
    db.prepare('UPDATE prompt_cache SET hit_count = hit_count + 1, updated_at = datetime(\'now\') WHERE prompt_hash = ?').run(hash);
    return res.json({ sql: cached.generated_sql, cached: true });
  }
  try {
    const sql = await promptToSQL(prompt, db);
    if (!sql) {
      return res.status(400).json({ error: 'Could not generate SQL for this prompt.' });
    }
    db.prepare(
      'INSERT INTO prompt_cache (prompt_hash, prompt_text, generated_sql) VALUES (?, ?, ?) ON CONFLICT(prompt_hash) DO UPDATE SET generated_sql = excluded.generated_sql, hit_count = hit_count + 1, updated_at = datetime(\'now\')'
    ).run(hash, prompt.trim(), sql);
    res.json({ sql, cached: false });
  } catch (e) {
    res.status(400).json({ error: e.message || 'NL2SQL failed' });
  }
});

// Execute query (read-only; safety enforced)
app.post('/api/execute', (req, res) => {
  const { sql, prompt } = req.body;
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'SQL is required' });
  }
  const promptText = typeof prompt === 'string' ? prompt : '';
  const validation = validateAndSanitizeSQL(sql, db);
  if (!validation.allowed) {
    db.prepare('INSERT INTO query_logs (prompt, generated_sql, blocked) VALUES (?, ?, 1)').run(promptText, sql);
    return res.status(400).json({
      error: 'Execution blocked',
      reason: validation.reason,
      blocked: true,
    });
  }
  try {
    const stmt = db.prepare(validation.sql);
    const rows = stmt.all();
    db.prepare('INSERT INTO query_logs (user_name, prompt, generated_sql, blocked) VALUES (?, ?, ?, 0)').run('User', promptText, sql);
    res.json({ rows, columns: rows.length ? Object.keys(rows[0]) : [] });
  } catch (e) {
    db.prepare('INSERT INTO query_logs (prompt, generated_sql, blocked) VALUES (?, ?, 1)').run(promptText, sql);
    res.status(400).json({ error: e.message, blocked: false });
  }
});

// Query logs
app.get('/api/query-logs', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const rows = db.prepare(
      'SELECT id, user_name AS user, prompt, generated_sql AS generatedSQL, blocked, created_at FROM query_logs ORDER BY id DESC LIMIT ?'
    ).all(limit);
    res.json({ logs: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Log a query (when we have prompt + sql from UI)
app.post('/api/query-logs', (req, res) => {
  const { user_name, prompt, generated_sql, blocked } = req.body;
  try {
    db.prepare(
      'INSERT INTO query_logs (user_name, prompt, generated_sql, blocked) VALUES (?, ?, ?, ?)'
    ).run(user_name || 'User', prompt || '', generated_sql || '', blocked ? 1 : 0);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = 3001;
const HOST = '127.0.0.1';
function listen() {
  app.listen(PORT, HOST, () => console.log(`Server http://${HOST}:${PORT}`));
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
