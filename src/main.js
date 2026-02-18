import "./style.css";

const API = "/api";

let state = {
  prompt: "",
  generatedSQL: "",
  results: null,
  columns: [],
  blocked: null,
  blockedReason: "",
  loading: false,
  cached: false,
};

let refs = {};

function el(id) {
  return document.getElementById(id);
}

function fetchJSON(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  }).then((r) => r.json().then((j) => (r.ok ? j : Promise.reject(j))));
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

function renderBlockedBanner() {
  const banner = refs.blockedBanner;
  if (!banner) return;
  if (state.blocked) {
    banner.classList.remove("hidden");
    banner.textContent = `Execution blocked: ${state.blockedReason}`;
  } else {
    banner.classList.add("hidden");
  }
}

function renderResults() {
  const wrap = refs.resultsTableWrap;
  const toolbar = refs.resultsToolbar;
  const actions = refs.resultsActions;
  if (!wrap || !toolbar) return;
  renderBlockedBanner();
  if (!state.results || state.blocked) {
    wrap.innerHTML =
      '<div class="results-empty">Run a safe SELECT query to see results here.</div>';
    if (toolbar) toolbar.classList.add("hidden");
    if (actions) actions.classList.add("hidden");
    return;
  }
  const cols = state.columns.length
    ? state.columns
    : state.results[0]
      ? Object.keys(state.results[0])
      : [];
  toolbar.classList.remove("hidden");
  toolbar.querySelector(".rows-count").textContent =
    `Rows: ${state.results.length}`;
  wrap.innerHTML = `
    <table class="results-table">
      <thead><tr>${cols.map((c) => `<th>${escapeHtml(String(c))}</th>`).join("")}</tr></thead>
      <tbody>
        ${state.results
          .map(
            (row) =>
              `<tr>${cols.map((col) => `<td>${escapeHtml(String(row[col] ?? ""))}</td>`).join("")}</tr>`,
          )
          .join("")}
      </tbody>
    </table>
  `;
  if (actions) {
    actions.classList.remove("hidden");
    actions.querySelector(".export-csv").onclick = () => exportCSV();
  }
}

function exportCSV() {
  if (!state.results || !state.results.length) return;
  const cols = state.columns.length
    ? state.columns
    : Object.keys(state.results[0]);
  const header = cols.join(",");
  const rows = state.results.map((r) =>
    cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","),
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "query-results.csv";
  a.click();
  URL.revokeObjectURL(url);
}

async function generateQuery() {
  const prompt = (refs.promptInput && refs.promptInput.value) || state.prompt;
  if (!prompt.trim()) return;
  state.prompt = prompt.trim();
  state.loading = true;
  state.blocked = null;
  state.results = null;
  if (refs.generateBtn) {
    refs.generateBtn.disabled = true;
    refs.generateBtn.textContent = "Generating…";
  }
  renderBlockedBanner();
  renderResults();
  try {
    const data = await fetchJSON(`${API}/generate-sql`, {
      method: "POST",
      body: JSON.stringify({ prompt: state.prompt }),
    });
    state.generatedSQL = data.sql || "";
    state.cached = !!data.cached;
    if (refs.sqlText) refs.sqlText.value = state.generatedSQL;
    if (refs.cacheBadge) {
      refs.cacheBadge.textContent = data.cached ? "From cache" : "";
      refs.cacheBadge.classList.toggle("hidden", !data.cached);
    }
    await executeQuery();
  } catch (err) {
    state.blocked = true;
    state.blockedReason = err.error || err.message || "Could not generate SQL.";
    renderBlockedBanner();
  } finally {
    state.loading = false;
    if (refs.generateBtn) {
      refs.generateBtn.disabled = false;
      refs.generateBtn.textContent = "Generate query";
    }
  }
}

async function executeQuery() {
  const sql = state.generatedSQL;
  if (!sql) return;
  try {
    const data = await fetchJSON(`${API}/execute`, {
      method: "POST",
      body: JSON.stringify({ sql, prompt: state.prompt }),
    });
    state.blocked = false;
    state.results = data.rows || [];
    state.columns = data.columns || [];
    renderBlockedBanner();
    renderResults();
  } catch (err) {
    state.blocked = true;
    state.blockedReason =
      err.reason || err.error || err.message || "Execution blocked.";
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
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = t;
      }, 1500);
    }
  });
}

const TESTIMONIALS_DATA = [
  {
    text: "This app literally changed my life due to the bugs.",
    author: "Jane Doe",
  },
  {
    text: "I've never seen z-index used this creatively.",
    author: "John Smith",
  },
  { text: "My CPU fan loves this website.", author: "Tech Reviewer" },
  {
    text: "This app literally changed my life due to the bugs.",
    author: "Jane Doe",
  },
  {
    text: "I've never seen z-index used this creatively.",
    author: "John Smith",
  },
  { text: "My CPU fan loves this website.", author: "Tech Reviewer" },
];

function init() {
  const app = el("app");
  app.innerHTML = `
    <!-- SIDEBAR -->
    <aside class="sidebar" id="sidebar">
      <button class="sidebar-collapse" id="sidebar-collapse" title="Collapse sidebar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <nav class="sidebar-nav">
        <button class="sidebar-item sidebar-item-active" data-tab="home">
          <svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span class="sidebar-label">Home</span>
        </button>
        <button class="sidebar-item" data-tab="analytics">
          <svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          <span class="sidebar-label">Analytics</span>
        </button>
        <button class="sidebar-item" data-tab="users">
          <svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span class="sidebar-label">Users</span>
        </button>
        <button class="sidebar-item" data-tab="settings">
          <svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span class="sidebar-label">Settings</span>
        </button>
      </nav>
      <button class="sidebar-logout">
        <svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        <span class="sidebar-label">Logout</span>
      </button>
    </aside>

    <!-- NAVBAR -->
    <nav class="navbar" id="navbar">
      <div class="nav-inner">
        <div class="nav-brand">
          <div class="nav-logo-dot"></div>
          <span class="nav-brand-text">NL<span class="nav-brand-white">2SQL</span></span>
        </div>
        <div class="nav-links">
          <a href="#features" class="nav-link">Features</a>
          <a href="#pricing" class="nav-link">Pricing</a>
          <a href="#about" class="nav-link">About</a>
        </div>
        <div class="nav-actions">
          <button id="theme-toggle" class="theme-toggle" title="Toggle theme">
            <span class="theme-icon">🌙</span>
          </button>
          <span class="nav-user">User | <a href="#">Logout</a></span>
          <button class="nav-cta">Get Started</button>
        </div>
      </div>
    </nav>

    <!-- HERO SECTION -->
    <section class="hero">
      <div class="hero-glow hero-glow-1"></div>
      <div class="hero-glow hero-glow-2"></div>
      <div class="hero-inner">

        <!-- ===== SQL DASHBOARD (stitched in) ===== -->
        <div class="dashboard-card" id="dashboard">
          <label class="prompt-label" for="prompt-input">Ask your question in plain english</label>
          <textarea id="prompt-input" class="prompt-input" placeholder="eg: Show total sales from last month"></textarea>
          <div class="generate-wrap">
            <button type="button" id="generate-btn" class="btn btn-primary">Generate query</button>
          </div>
          <section class="sql-section">
            <h3 class="section-sub">Generated SQL</h3>
            <div class="sql-block">
              <textarea id="sql-text" class="sql-text" readonly></textarea>
              <button type="button" id="copy-btn" class="btn btn-secondary">Copy</button>
            </div>
            <span id="cache-badge" class="cache-badge hidden">From cache</span>
          </section>
          <section class="results-section">
            <h3 class="section-sub">Query results</h3>
            <div class="blocked-banner hidden" id="blocked-banner" role="alert"></div>
            <div class="results-toolbar hidden" id="results-toolbar">
              <span class="rows-count">Rows: 0</span>
            </div>
            <div class="results-table-wrap" id="results-table-wrap">
              <div class="results-empty">Run a safe SELECT query to see results here.</div>
            </div>
            <div class="results-actions hidden" id="results-actions">
              <button type="button" class="btn btn-secondary export-csv">Export CSV</button>
            </div>
          </section>
        </div>
        <!-- ===== END SQL DASHBOARD ===== -->

      </div>

    </section>

    <!-- FEATURES -->
    <section class="features" id="features">
      <h2 class="features-title">Why Choose NL2SQL?</h2>
      <div class="features-grid">
        ${[
          {
            icon: "🚀",
            title: "Turbo Speed",
            desc: "Our engine is faster than light. Query results in milliseconds.",
          },
          {
            icon: "⚡",
            title: "Zap Events",
            desc: "Real-time event processing with zero latency overhead.",
          },
          {
            icon: "🛡️",
            title: "Iron Shield",
            desc: "Unbreakable security with read-only query enforcement.",
          },
        ]
          .map(
            (f) => `
          <div class="feature-card">
            <div class="feature-icon-wrap">${f.icon}</div>
            <h3 class="feature-title">${f.title}</h3>
            <p class="feature-desc">${f.desc}</p>
            <div class="feature-line"></div>
          </div>
        `,
          )
          .join("")}
      </div>
    </section>

    <!-- TESTIMONIALS -->
    <section class="testimonials">
      <h2 class="testimonials-title">TRUSTED BY MILLIONS</h2>
      <div class="marquee-wrap">
        <div class="marquee-fade marquee-fade-left"></div>
        <div class="marquee-fade marquee-fade-right"></div>
        <div class="marquee" id="marquee">
          ${TESTIMONIALS_DATA.map(
            (t, i) => `
            <div class="testimonial-card">
              <p class="testimonial-text">"${t.text}"</p>
              <div class="testimonial-author">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${i}" class="testimonial-avatar" alt="Avatar" width="40" height="40" />
                <span class="testimonial-name">${t.author}</span>
              </div>
            </div>
          `,
          ).join("")}
        </div>
      </div>
    </section>
  `;

  refs = {
    promptInput: el("prompt-input"),
    generateBtn: el("generate-btn"),
    sqlText: el("sql-text"),
    copyBtn: el("copy-btn"),
    cacheBadge: el("cache-badge"),
    resultsToolbar: el("results-toolbar"),
    resultsTableWrap: el("results-table-wrap"),
    resultsActions: el("results-actions"),
    blockedBanner: el("blocked-banner"),
    themeToggle: el("theme-toggle"),
  };

  refs.generateBtn.addEventListener("click", generateQuery);
  refs.copyBtn.addEventListener("click", copySQL);

  refs.themeToggle.addEventListener("click", () => {
    const isLight = document.body.classList.toggle("light-mode");
    refs.themeToggle.querySelector(".theme-icon").textContent = isLight
      ? "☀️"
      : "🌙";
  });

  window.addEventListener("scroll", () => {
    const navbar = el("navbar");
    if (navbar) navbar.classList.toggle("nav-scrolled", window.scrollY > 20);
  });

  // Marquee
  let pos = 0;
  const marquee = el("marquee");
  function animateMarquee() {
    pos -= 0.6;
    if (marquee) {
      if (pos < -1400) pos = 0;
      marquee.style.transform = `translateX(${pos}px)`;
    }
    requestAnimationFrame(animateMarquee);
  }
  animateMarquee();

  // Feature card hover lines
  document.querySelectorAll(".feature-card").forEach((card) => {
    const line = card.querySelector(".feature-line");
    card.addEventListener("mouseenter", () => {
      if (line) line.style.opacity = "1";
    });
    card.addEventListener("mouseleave", () => {
      if (line) line.style.opacity = "0";
    });
  });
  // Sidebar collapse toggle
  const sidebar = el("sidebar");
  const collapseBtn = el("sidebar-collapse");
  collapseBtn.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    app.classList.toggle("sidebar-collapsed");
  });

  // Sidebar tab active state
  document.querySelectorAll(".sidebar-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".sidebar-item")
        .forEach((b) => b.classList.remove("sidebar-item-active"));
      btn.classList.add("sidebar-item-active");
    });
  });
}

init();
