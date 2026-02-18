# Prompt-to-SQL Interface (NL2SQL)

A small web app that turns plain-English questions into **read-only** SQL, runs them against a SQLite demo database, and shows results. Built with **Vite**, **vanilla JavaScript**, and **SQLite**.

## Features

- **Natural language → SQL**: Type a question (e.g. “Show total sales from last month”) and get a generated `SELECT` query.
- **Prompt caching**: Repeated or similar prompts reuse the last generated SQL so you don’t regenerate every time.
- **Query safety**: Only `SELECT` is allowed. `INSERT`, `UPDATE`, `DELETE`, `DROP`, and other modifying or DDL statements are blocked; only searching and joining are permitted.
- **Wireframe UI**: Header, prompt input, “Generate Query”, optional generated SQL with Copy, query results table, Export CSV / Download, and a sidebar with blocked-query state, allowed tables, and query logs.

## Setup

```bash
cd /Users/pwe/Code/hack
npm install
```

### Gemini API (optional)

NL2SQL uses **Gemini** when an API key is set. Get a key from [Google AI Studio](https://aistudio.google.com/apikey), then:

1. Copy `.env.example` to `.env` (or create `.env`).
2. Add your key: `GEMINI_API_KEY=your_key_here`

If `GEMINI_API_KEY` is missing or invalid, the app falls back to built-in rule-based SQL generation.

## Run

1. Start the API server (SQLite + NL2SQL + safety):

   ```bash
   npm run server
   ```

2. In another terminal, start the Vite dev server (proxies `/api` to the server):

   ```bash
   npm run dev
   ```

3. Open **http://localhost:5173**.

To run both in one go:

```bash
npm run dev:all
```

## Tech

- **Frontend**: Vite, vanilla JS, CSS (no framework).
- **Backend**: Express, `sql.js` (SQLite), `@google/genai` (Gemini).
- **Database**: SQLite (`server/demo.db`) with demo tables: `users`, `orders`, `products`, `order_items`, plus `prompt_cache`, `query_logs`, `allowed_tables`.

## Safety

- All user/LLM-generated SQL is validated in `server/safety.js`.
- Only a single `SELECT` is allowed; forbidden verbs and multiple statements are rejected.
- Table access can be restricted via the Admin Panel “Allowed Tables” (stored in `allowed_tables`).

## Caching

- Prompts are normalized (lowercase, trimmed, collapsed spaces) and hashed.
- First time: prompt → NL2SQL → SQL stored in `prompt_cache` and executed.
- Next time the same (or normalized-same) prompt: SQL is read from `prompt_cache` and executed; no regeneration.

Gemini is used in `server/nl2sql.js`; the same caching and safety flow apply.
# temphack
