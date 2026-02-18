/**
 * Query safety: only allow SELECT. Block DML/DDL and restrict to allowed tables.
 */

const FORBIDDEN_VERBS = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|GRANT|REVOKE)\b/i;
const FORBIDDEN_INTO_SET = /\b(INTO|SET)\s+[\w.]+\s*(?=\)|=)/i;

export function getAllowedTables(db) {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('prompt_cache', 'query_logs', 'allowed_tables') ORDER BY name"
  ).all();
  const allowedMap = {};
  try {
    const settings = db.prepare('SELECT table_name, allowed FROM allowed_tables').all();
    settings.forEach(({ table_name, allowed }) => { allowedMap[table_name] = !!allowed; });
  } catch (_) {}
  return rows.map(({ name }) => ({ name, allowed: allowedMap[name] !== false }));
}

export function setAllowedTables(db, tableFlags) {
  if (!tableFlags || typeof tableFlags !== 'object') return;
  const stmt = db.prepare(
    'INSERT INTO allowed_tables (table_name, allowed) VALUES (?, ?) ON CONFLICT(table_name) DO UPDATE SET allowed = excluded.allowed'
  );
  for (const [tableName, allowed] of Object.entries(tableFlags)) {
    if (typeof tableName === 'string' && tableName.trim()) {
      stmt.run(tableName.trim(), allowed ? 1 : 0);
    }
  }
}

function getAllowList(db) {
  try {
    const rows = db.prepare('SELECT table_name FROM allowed_tables WHERE allowed = 1').all();
    return new Set(rows.map(r => r.table_name.toLowerCase()));
  } catch (_) {
    return new Set();
  }
}

/** Returns { allowed: boolean, reason?: string, sql?: string } */
export function validateAndSanitizeSQL(sql, db) {
  const trimmed = String(sql).trim();
  if (!trimmed) {
    return { allowed: false, reason: 'Empty query.' };
  }
  const upper = trimmed.toUpperCase();
  if (!upper.startsWith('SELECT')) {
    return { allowed: false, reason: 'Only SELECT queries allowed.' };
  }
  if (FORBIDDEN_VERBS.test(trimmed)) {
    const match = trimmed.match(/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE)\b/i);
    const op = match ? match[1] : 'Restricted operation';
    return { allowed: false, reason: `Detected restricted operation: ${op.toUpperCase()}. Only SELECT is allowed.` };
  }
  if (FORBIDDEN_INTO_SET.test(trimmed)) {
    return { allowed: false, reason: 'Detected restricted operation (INTO/SET). Only SELECT is allowed.' };
  }
  const statements = trimmed.split(';').map(s => s.trim()).filter(Boolean);
  if (statements.length > 1) {
    return { allowed: false, reason: 'Multiple statements not allowed.' };
  }
  const allowList = getAllowList(db);
  if (allowList.size) {
    const fromMatch = trimmed.match(/\bFROM\s+([\w.\s,]+?)(?=\s+WHERE|\s+GROUP|\s+ORDER|\s+LIMIT|$)/is);
    const joinMatch = trimmed.match(/\bJOIN\s+([\w.\s]+?)(?=\s+ON|\s+WHERE|\s+GROUP|\s+ORDER|\s+LIMIT|$)/gi);
    const tables = new Set();
    if (fromMatch) {
      fromMatch[1].split(',').map(s => s.trim().split(/\s+/)[0].replace(/^[\w.]*\./, '')).forEach(t => tables.add(t.toLowerCase()));
    }
    if (joinMatch) {
      joinMatch.forEach(j => {
        const t = j.replace(/\bJOIN\s+/i, '').trim().split(/\s+/)[0].replace(/^[\w.]*\./, '');
        if (t) tables.add(t.toLowerCase());
      });
    }
    for (const t of tables) {
      if (!allowList.has(t)) {
        return { allowed: false, reason: `Table "${t}" is not in the allowed list.` };
      }
    }
  }
  return { allowed: true, sql: trimmed };
}
