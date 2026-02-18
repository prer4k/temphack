import './style.css';

const API = '/api';

let state = {
  prompt: '',
  generatedSQL: '',
  results: null,
  columns: [],
  blocked: null,
  blockedReason: '',
  loading: false,
  cached: false,
};

// ----- DOM refs (set in init) -----
let refs = {};

function el(id) {
  return document.getElementById(id);
}

function q(sel, root = document) {
  return root.querySelector(sel);
}

function fetchJSON(url, options = {}) {
  return fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } })
    .then(r => r.json().then(j => (r.ok ? j : Promise.reject(j))));
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

function renderBlockedBanner() {
  const banner = refs.blockedBanner;
  if (!banner) return;
  if (state.blocked) {
    banner.classList.remove('hidden');
    banner.textContent = `Execution blocked: ${state.blockedReason}`;
  } else {
    banner.classList.add('hidden');
  }
}

function renderResults() {
  const wrap = refs.resultsTableWrap;
  const toolbar = refs.resultsToolbar;
  const actions = refs.resultsActions;
  if (!wrap || !toolbar) return;
  renderBlockedBanner();
  if (!state.results || state.blocked) {
    wrap.innerHTML = '<div class="results-empty">Run a safe SELECT query to see results here.</div>';
    if (toolbar) toolbar.classList.add('hidden');
    if (actions) actions.classList.add('hidden');
    return;
  }
  const cols = state.columns.length ? state.columns : (state.results[0] ? Object.keys(state.results[0]) : []);
  toolbar.classList.remove('hidden');
  toolbar.querySelector('.rows-count').textContent = `Rows: ${state.results.length}`;
  wrap.innerHTML = `
    <table class="results-table">
      <thead><tr>${cols.map(c => `<th>${escapeHtml(String(c))}</th>`).join('')}</tr></thead>
      <tbody>
        ${state.results.map(row =>
          `<tr>${cols.map(col => `<td>${escapeHtml(String(row[col] ?? ''))}</td>`).join('')}</tr>`
        ).join('')}
      </tbody>
    </table>
  `;
  if (actions) {
    actions.classList.remove('hidden');
    actions.querySelector('.export-csv').onclick = () => exportCSV();
    actions.querySelector('.download').onclick = () => downloadCSV();
  }
}

function exportCSV() {
  if (!state.results || !state.results.length) return;
  const cols = state.columns.length ? state.columns : Object.keys(state.results[0]);
  const header = cols.join(',');
  const rows = state.results.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','));
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'query-results.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCSV() {
  exportCSV();
}

async function generateQuery() {
  const prompt = (refs.promptInput && refs.promptInput.value) || state.prompt;
  if (!prompt.trim()) return;
  state.prompt = prompt.trim();
  state.loading = true;
  state.blocked = null;
  state.results = null;
  if (refs.generateBtn) refs.generateBtn.disabled = true;
  renderBlockedBanner();
  renderResults();
  try {
    const data = await fetchJSON(`${API}/generate-sql`, {
      method: 'POST',
      body: JSON.stringify({ prompt: state.prompt }),
    });
    state.generatedSQL = data.sql || '';
    state.cached = !!data.cached;
    if (refs.sqlText) refs.sqlText.value = state.generatedSQL;
    if (refs.cacheBadge) {
      refs.cacheBadge.textContent = data.cached ? 'From cache' : '';
      refs.cacheBadge.classList.toggle('hidden', !data.cached);
    }
    await executeQuery();
  } catch (err) {
    state.blocked = true;
    state.blockedReason = err.error || err.message || 'Could not generate SQL.';
    renderBlockedBanner();
  } finally {
    state.loading = false;
    if (refs.generateBtn) refs.generateBtn.disabled = false;
  }
}

async function executeQuery() {
  const sql = state.generatedSQL;
  if (!sql) return;
  try {
    const data = await fetchJSON(`${API}/execute`, {
      method: 'POST',
      body: JSON.stringify({ sql, prompt: state.prompt }),
    });
    state.blocked = false;
    state.results = data.rows || [];
    state.columns = data.columns || [];
    renderBlockedBanner();
    renderResults();
  } catch (err) {
    state.blocked = true;
    state.blockedReason = err.reason || err.error || err.message || 'Execution blocked.';
    state.results = null;
    renderBlockedBanner();
    renderResults();
  }
}

function copySQL() {
  const sql = refs.sqlText && refs.sqlText.value;
  if (!sql) return;
  navigator.clipboard.writeText(sql).then(() => {
    const btn = refs.copyBtn;
    if (btn) {
      const t = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = t; }, 1500);
    }
  });
}

function init() {
  const app = el('app');
  app.innerHTML = `
    <header class="header">
      <span class="logo">LOGO</span>
      <nav class="nav">
        <a href="#">Dashboard</a>
      </nav>
      <span class="user">User | <a href="#">Logout</a></span>
    </header>
    <main class="content">
      <h1 class="section-title">Prompt to SQL Dashboard</h1>
      <label class="prompt-label" for="prompt-input">Ask your question in plain english</label>
      <textarea id="prompt-input" class="prompt-input" placeholder="eg: Show total sales from last month"></textarea>
      <div class="generate-wrap">
        <button type="button" id="generate-btn" class="btn btn-primary">Generate query</button>
      </div>

      <section class="sql-section" id="sql-section">
        <h2 class="section-title">Generated SQL</h2>
        <div class="sql-block">
          <textarea id="sql-text" class="sql-text" readonly></textarea>
          <button type="button" id="copy-btn" class="btn btn-secondary">Copy</button>
        </div>
        <span id="cache-badge" class="cache-badge hidden">From cache</span>
      </section>

      <section class="results-section">
        <h2 class="section-title">Query results</h2>
        <div class="blocked-banner hidden" id="blocked-banner" role="alert"></div>
        <div class="results-toolbar hidden" id="results-toolbar">
          <span class="rows-count">Rows: 0</span>
        </div>
        <div class="results-table-wrap" id="results-table-wrap">
          <div class="results-empty">Run a safe SELECT query to see results here.</div>
        </div>
        <div class="results-actions hidden" id="results-actions">
          <button type="button" class="btn btn-secondary export-csv">Export CSV</button>
          <button type="button" class="btn btn-secondary download">Download</button>
        </div>
      </section>
    </main>
  `;

  refs = {
    promptInput: el('prompt-input'),
    generateBtn: el('generate-btn'),
    sqlText: el('sql-text'),
    copyBtn: el('copy-btn'),
    cacheBadge: el('cache-badge'),
    resultsToolbar: el('results-toolbar'),
    resultsTableWrap: el('results-table-wrap'),
    resultsActions: el('results-actions'),
    blockedBanner: el('blocked-banner'),
  };

  refs.generateBtn.addEventListener('click', generateQuery);
  refs.copyBtn.addEventListener('click', copySQL);
}

init();
