/**
 * NL2SQL: Gemini API when GEMINI_API_KEY is set, otherwise rule-based fallback.
 */

import { GoogleGenAI } from "@google/genai";

let schemaInfo = [];

export function initSchema(db) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('prompt_cache', 'query_logs', 'allowed_tables')",
    )
    .all();
  schemaInfo = tables.map(({ name }) => {
    const cols = db.prepare(`PRAGMA table_info(${name})`).all();
    return { table: name, columns: cols.map((c) => c.name) };
  });
}

function getSchemaPrompt() {
  const lines = schemaInfo.map(
    ({ table, columns }) => `- ${table}(${columns.join(", ")})`,
  );
  return lines.join("\n");
}

function extractSQL(text) {
  if (!text || typeof text !== "string") return null;
  let s = text.trim();
  const codeBlock = s.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (codeBlock) s = codeBlock[1].trim();
  if (!s.toUpperCase().startsWith("SELECT")) return null;
  return s;
}

/**
 * Generate SQL using Gemini when API key is set, else use rule-based fallback.
 */
export async function promptToSQL(prompt, db) {
  //  Get full schema dynamically from SQLite
  const tables = db
    .prepare(
      `
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `,
    )
    .all();

  let schemaDescription = "";

  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table.name})`).all();
    const columnDefs = columns
      .map((col) => `${col.name} (${col.type})`)
      .join(", ");
    schemaDescription += `Table: ${table.name}\nColumns: ${columnDefs}\n\n`;
  }

  //  Strict system instruction for Gemini
  const systemInstruction = `
You are a SQL generator.

Rules:
- ONLY generate a valid SQL SELECT query.
- DO NOT explain anything.
- DO NOT add markdown.
- DO NOT add comments.
- DO NOT generate INSERT, UPDATE, DELETE, DROP, ALTER.
- Return ONLY raw SQL.

Database schema:
${schemaDescription}
`;

  // Call Gemini
  const response = await gemini.generateContent({
    contents: [
      {
        role: "user",
        parts: [{ text: systemInstruction + "\nUser request: " + prompt }],
      },
    ],
  });

  const text = response.response.text();

  if (!text) return null;

  return text.trim();
}
async function generateWithGemini(prompt, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  const schema = getSchemaPrompt();
  const fullPrompt = `You are a natural language to SQL assistant. Given a SQLite database schema and a user question, reply with exactly one SELECT query.
Rules: Output ONLY the SQL statement, no explanation or markdown. Use only the tables and columns in the schema. Use SQLite syntax.

Schema:
${schema}

Question: ${prompt}

Respond with only the SELECT statement.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: fullPrompt,
  });

  const text = response.text?.trim();
  return extractSQL(text) || null;
}

function getTableColumns(tableName) {
  const t = schemaInfo.find(
    (s) => s.table.toLowerCase() === tableName.toLowerCase(),
  );
  return t ? t.columns : [];
}

/**
 * Rule-based fallback when Gemini is not configured or fails.
 */
function fallbackPromptToSQL(prompt, db) {
  const p = prompt.toLowerCase().trim();

  if (/\btotal\s+sales\b|\bsum\s+of\s+sales\b|\bsales\s+total\b/i.test(p)) {
    return "SELECT SUM(total) AS total_sales FROM orders WHERE status = 'completed'";
  }
  if (/\blast\s+month\b|\bsales\s+from\s+last\s+month\b/i.test(p)) {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const start = d.toISOString().slice(0, 7) + "-01";
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);
    return `SELECT SUM(total) AS total_sales FROM orders WHERE order_date BETWEEN '${start}' AND '${end}'`;
  }
  if (/\btop\s+\d+\s+products?\b|\bproducts?\s+by\s+revenue\b/i.test(p)) {
    const limitMatch = p.match(/top\s+(\d+)/i);
    const limit = limitMatch
      ? Math.min(parseInt(limitMatch[1], 10) || 5, 100)
      : 5;
    return `SELECT p.name AS product_name, SUM(oi.quantity * oi.unit_price) AS revenue, SUM(oi.quantity) AS units_sold
FROM order_items oi
JOIN products p ON p.id = oi.product_id
JOIN orders o ON o.id = oi.order_id
GROUP BY p.id
ORDER BY revenue DESC
LIMIT ${limit}`;
  }
  if (/\ball\s+orders?\b|\blist\s+orders?\b/i.test(p)) {
    return "SELECT * FROM orders ORDER BY order_date DESC LIMIT 100";
  }
  if (/\ball\s+users?\b|\blist\s+users?\b/i.test(p)) {
    return "SELECT * FROM users LIMIT 100";
  }
  if (/\ball\s+products?\b|\blist\s+products?\b/i.test(p)) {
    return "SELECT * FROM products LIMIT 100";
  }
  if (/\bcount\s+of\s+orders?\b|\bnumber\s+of\s+orders?\b/i.test(p)) {
    return "SELECT COUNT(*) AS order_count FROM orders";
  }
  if (/\brevenue\s+by\s+product\b|\bproduct\s+revenue\b/i.test(p)) {
    return `SELECT p.name AS product_name, SUM(oi.quantity * oi.unit_price) AS revenue, SUM(oi.quantity) AS units_sold
FROM order_items oi
JOIN products p ON p.id = oi.product_id
JOIN orders o ON o.id = oi.order_id
GROUP BY p.id
ORDER BY revenue DESC`;
  }

  for (const { table } of schemaInfo) {
    if (p.includes(table) || p.includes(table.replace(/s$/, ""))) {
      const cols = getTableColumns(table);
      const colList = cols.length ? cols.join(", ") : "*";
      return `SELECT ${colList} FROM ${table} LIMIT 50`;
    }
  }

  return "SELECT p.name AS product_name, SUM(oi.quantity * oi.unit_price) AS revenue, SUM(oi.quantity) AS units_sold FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN orders o ON o.id = oi.order_id GROUP BY p.id ORDER BY revenue DESC LIMIT 10";
}
