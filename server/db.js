/**
 * Thin wrapper around sql.js to mimic better-sqlite3 style API (prepare().get/all/run).
 */
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'demo.db');

export async function createDb() {
  const SQL = await initSqlJs();
  let db;
  if (existsSync(DB_PATH)) {
    const buf = readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  function prepare(sql) {
    const stmt = db.prepare(sql);
    return {
      get(...params) {
        if (params.length) stmt.bind(params);
        const row = stmt.step() ? stmt.getAsObject() : null;
        stmt.free();
        return row;
      },
      all(...params) {
        if (params.length) stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
      run(...params) {
        if (params.length) stmt.bind(params);
        stmt.step();
        stmt.free();
        return {};
      },
    };
  }

  return {
    exec(sql) {
      db.exec(sql);
    },
    prepare,
    _raw: db,
    save() {
      const data = db.export();
      const buffer = Buffer.from(data);
      writeFileSync(DB_PATH, buffer);
    },
  };
}
