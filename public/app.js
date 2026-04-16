'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────
const COLORS = ['#fa5c5c','#5c8afa','#4ade80','#fbbf24','#a78bfa','#5cfad6','#fa965c','#5cface'];

// ─── State ───────────────────────────────────────────────────────────────────
const S = {
  snapshots: [],
  current: null,      // most recent snapshot
  selectedIds: new Set(), // empty = all games
  compareWith: '',    // 'prev' | '7d' | '30d' | '90d' | 'first'
  metric: 'revenue',  // trend chart metric
  charts: { trend: null, pie: null, bar: null },
};

// ─── API ─────────────────────────────────────────────────────────────────────
async function api(path, method = 'GET') {
  const res = await fetch('/api' + path, { method });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Formatting ──────────────────────────────────────────────────────────────
const fmt$ = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = n => Number(n).toLocaleString('en-US');
const fmtPct = (n, d) => d ? (n / d * 100).toFixed(2) + '%' : '—';

function fmtDelta(diff, type = 'n') {
  if (diff === 0) return '<span class="delta delta-zero">—</span>';
  const cls = diff > 0 ? 'delta-up' : 'delta-down';
  const arrow = diff > 0 ? '▲' : '▼';
  const val = type === '$' ? fmt$(Math.abs(diff)) : fmtN(Math.abs(diff));
  return `<span class="delta ${cls}">${arrow} ${val}</span>`;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────
function gameRevenue(g) {
  const usd = (g.earnings || []).find(e => e.currency === 'USD');
  return usd ? (usd.amount || 0) : 0;
}

function filteredGames(snap) {
  if (!snap) return [];
  const games = snap.games || [];
  return S.selectedIds.size ? games.filter(g => S.selectedIds.has(g.id)) : games;
}

function sumStats(games) {
  return {
    revenue:   games.reduce((s, g) => s + gameRevenue(g), 0),
    purchases: games.reduce((s, g) => s + (g.purchases_count || 0), 0),
    downloads: games.reduce((s, g) => s + (g.downloads_count || 0), 0),
    views:     games.reduce((s, g) => s + (g.views_count || 0), 0),
  };
}

function compareSnapshot() {
  if (!S.compareWith || S.snapshots.length < 2) return null;
  const idx = S.snapshots.indexOf(S.current);

  if (S.compareWith === 'prev') return idx > 0 ? S.snapshots[idx - 1] : null;
  if (S.compareWith === 'first') return S.snapshots[0] !== S.current ? S.snapshots[0] : null;

  const days = parseInt(S.compareWith); // '7d' -> 7
  const cutoff = new Date(S.current.date);
  cutoff.setDate(cutoff.getDate() - days);
  let best = null;
  for (const s of S.snapshots) {
    if (s === S.current) continue;
    if (new Date(s.date) <= cutoff) best = s;
  }
  return best;
}

function gameInSnap(snap, id) {
  return (snap?.games || []).find(g => g.id === id);
}

// ─── Chart setup ─────────────────────────────────────────────────────────────
Chart.defaults.color = '#7070a0';
Chart.defaults.borderColor = '#2a2a42';
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
Chart.defaults.font.size = 12;

function destroyChart(key) {
  if (S.charts[key]) { S.charts[key].destroy(); S.charts[key] = null; }
}

const tooltipDefaults = {
  backgroundColor: '#1e1e30',
  borderColor: '#2a2a42',
  borderWidth: 1,
  padding: 10,
  titleColor: '#e8e8f2',
  bodyColor: '#7070a0',
};

// ─── Trend Chart ──────────────────────────────────────────────────────────────
function renderTrendChart() {
  destroyChart('trend');
  const section = document.getElementById('trends-section');
  const note = document.getElementById('trend-note');

  if (S.snapshots.length < 2) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const snaps = S.snapshots;
  const labels = snaps.map(s => s.date);
  const metric = S.metric;

  // Total line
  const totalData = snaps.map(s => {
    const tot = sumStats(filteredGames(s));
    if (metric === 'revenue') return +(tot.revenue / 100).toFixed(2);
    return tot[metric];
  });

  // Per-game lines (only if ≤8 games or filter active)
  const currentGames = filteredGames(S.current);
  const showPerGame = currentGames.length <= 8 || S.selectedIds.size > 0;
  const datasets = [];

  if (showPerGame) {
    currentGames.forEach((g, i) => {
      datasets.push({
        label: g.title,
        data: snaps.map(s => {
          const found = gameInSnap(s, g.id);
          if (!found) return null;
          if (metric === 'revenue') return +(gameRevenue(found) / 100).toFixed(2);
          return found[metric + '_count'] ?? 0;
        }),
        borderColor: COLORS[i % COLORS.length],
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 3,
        tension: 0.3,
        spanGaps: true,
      });
    });
  }

  // Add total line last (on top)
  datasets.push({
    label: 'Total',
    data: totalData,
    borderColor: '#e8e8f2',
    backgroundColor: 'rgba(232,232,242,0.05)',
    borderWidth: 2.5,
    pointRadius: 4,
    fill: true,
    tension: 0.3,
  });

  const yLabel = metric === 'revenue' ? 'USD ($)' : metric.charAt(0).toUpperCase() + metric.slice(1);

  S.charts.trend = new Chart(document.getElementById('trend-chart'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: {
          ...tooltipDefaults,
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y;
              return ` ${ctx.dataset.label}: ${metric === 'revenue' ? '$' + v.toFixed(2) : fmtN(v)}`;
            },
          },
        },
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16 } },
      },
      scales: {
        x: { grid: { color: '#2a2a42' } },
        y: {
          grid: { color: '#2a2a42' },
          title: { display: true, text: yLabel },
          ticks: {
            callback: v => metric === 'revenue' ? '$' + v : fmtN(v),
          },
        },
      },
    },
  });

  note.textContent = `${snaps.length} snapshots · ${snaps[0].date} → ${snaps[snaps.length - 1].date}`;
}

// ─── Revenue Pie ─────────────────────────────────────────────────────────────
function renderRevenuePie() {
  destroyChart('pie');
  const games = filteredGames(S.current);
  const revenues = games.map(g => +(gameRevenue(g) / 100).toFixed(2));
  if (revenues.every(v => v === 0)) return;

  S.charts.pie = new Chart(document.getElementById('revenue-pie-chart'), {
    type: 'doughnut',
    data: {
      labels: games.map(g => g.title),
      datasets: [{ data: revenues, backgroundColor: COLORS.slice(0, games.length), borderWidth: 0 }],
    },
    options: {
      responsive: true,
      cutout: '65%',
      plugins: {
        tooltip: {
          ...tooltipDefaults,
          callbacks: { label: ctx => ` ${ctx.label}: $${ctx.parsed.toFixed(2)}` },
        },
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
      },
    },
  });
}

// ─── Downloads vs Views Bar ───────────────────────────────────────────────────
function renderDVBar() {
  destroyChart('bar');
  const games = filteredGames(S.current);
  const labels = games.map(g => g.title.length > 22 ? g.title.slice(0, 19) + '…' : g.title);

  S.charts.bar = new Chart(document.getElementById('dv-bar-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Downloads', data: games.map(g => g.downloads_count || 0), backgroundColor: '#5c8afa' },
        { label: 'Views',     data: games.map(g => g.views_count || 0),     backgroundColor: '#a78bfa' },
      ],
    },
    options: {
      responsive: true,
      indexAxis: 'y',
      plugins: {
        tooltip: { ...tooltipDefaults },
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
      },
      scales: {
        x: { grid: { color: '#2a2a42' }, ticks: { callback: v => fmtN(v) } },
        y: { grid: { display: false } },
      },
    },
  });
}

// ─── Overview Cards ───────────────────────────────────────────────────────────
function renderOverview() {
  const cur   = sumStats(filteredGames(S.current));
  const cmpSnap = compareSnapshot();
  const cmp   = cmpSnap ? sumStats(filteredGames(cmpSnap)) : null;

  const avg$ = cur.purchases > 0 ? fmt$(cur.revenue / cur.purchases) : '—';
  const cmpAvg = (cmp && cmp.purchases > 0) ? cmp.revenue / cmp.purchases : null;
  const curAvg = cur.purchases > 0 ? cur.revenue / cur.purchases : null;

  set('stat-revenue',   fmt$(cur.revenue));
  set('stat-purchases', fmtN(cur.purchases));
  set('stat-downloads', fmtN(cur.downloads));
  set('stat-views',     fmtN(cur.views));
  set('stat-avg-price', avg$);
  set('stat-conversion', fmtPct(cur.purchases, cur.views));

  setHtml('delta-revenue',   cmp ? fmtDelta(cur.revenue   - cmp.revenue,   '$') : '');
  setHtml('delta-purchases', cmp ? fmtDelta(cur.purchases - cmp.purchases)      : '');
  setHtml('delta-downloads', cmp ? fmtDelta(cur.downloads - cmp.downloads)      : '');
  setHtml('delta-views',     cmp ? fmtDelta(cur.views     - cmp.views)          : '');
  setHtml('delta-avg-price', (cmp && curAvg !== null && cmpAvg !== null) ? fmtDelta(curAvg - cmpAvg, '$') : '');

  const sub = cmpSnap ? `vs ${cmpSnap.date}` : '';
  set('overview-sub', sub);
}

// ─── Games Grid ───────────────────────────────────────────────────────────────
function renderGamesGrid() {
  const games = filteredGames(S.current);
  const cmpSnap = compareSnapshot();
  const el = document.getElementById('games-grid');

  if (!games.length) { el.innerHTML = '<p style="color:var(--muted)">No games.</p>'; return; }

  el.innerHTML = games.map((g, i) => {
    const rev = gameRevenue(g);
    const cg  = gameInSnap(cmpSnap, g.id);
    const dRev = cg != null ? fmtDelta(rev - gameRevenue(cg), '$') : '';
    const dPur = cg != null ? fmtDelta((g.purchases_count||0) - (cg.purchases_count||0)) : '';
    const dDL  = cg != null ? fmtDelta((g.downloads_count||0) - (cg.downloads_count||0)) : '';
    const dVw  = cg != null ? fmtDelta((g.views_count||0)     - (cg.views_count||0))     : '';
    const conv = fmtPct(g.purchases_count || 0, g.views_count || 0);
    const platforms = [
      g.p_windows && '<span class="platform-badge">Win</span>',
      g.p_osx     && '<span class="platform-badge">Mac</span>',
      g.p_linux   && '<span class="platform-badge">Linux</span>',
      g.p_android && '<span class="platform-badge">Android</span>',
    ].filter(Boolean).join('');

    const cover = g.cover_url
      ? `<img class="game-cover" src="${esc(g.cover_url)}" alt="" loading="lazy">`
      : `<div class="game-cover-placeholder">🎮</div>`;

    return `
      <div class="game-card${g.published ? '' : ' game-unpublished'}">
        ${cover}
        <div class="game-body">
          <div class="game-title">
            <a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.title)}</a>
            ${g.published ? '' : '<span class="platform-badge" style="color:var(--yellow)">Draft</span>'}
          </div>
          <div class="game-stats">
            <div class="game-stat-item">
              <div class="game-stat-label">Revenue</div>
              <div class="game-stat-value" style="color:${COLORS[i % COLORS.length]}">${fmt$(rev)}</div>
              <div class="game-stat-delta">${dRev}</div>
            </div>
            <div class="game-stat-item">
              <div class="game-stat-label">Sales</div>
              <div class="game-stat-value">${fmtN(g.purchases_count || 0)}</div>
              <div class="game-stat-delta">${dPur}</div>
            </div>
            <div class="game-stat-item">
              <div class="game-stat-label">Downloads</div>
              <div class="game-stat-value">${fmtN(g.downloads_count || 0)}</div>
              <div class="game-stat-delta">${dDL}</div>
            </div>
            <div class="game-stat-item">
              <div class="game-stat-label">Views</div>
              <div class="game-stat-value">${fmtN(g.views_count || 0)}</div>
              <div class="game-stat-delta">${dVw}</div>
            </div>
            <div class="game-stat-item">
              <div class="game-stat-label">Conv. rate</div>
              <div class="game-stat-value">${conv}</div>
            </div>
            <div class="game-stat-item">
              <div class="game-stat-label">Min price</div>
              <div class="game-stat-value">${g.min_price > 0 ? fmt$(g.min_price) : 'Free'}</div>
            </div>
          </div>
          <div class="game-platforms">${platforms}</div>
        </div>
      </div>`;
  }).join('');
}

// ─── History Table ────────────────────────────────────────────────────────────
function renderHistoryTable() {
  const snaps = [...S.snapshots].reverse(); // newest first
  const section = document.getElementById('history-section');
  if (!snaps.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  const tbody = document.getElementById('history-tbody');
  const today = new Date().toISOString().slice(0, 10);

  tbody.innerHTML = snaps.map((s, i) => {
    const prev = snaps[i + 1] || null; // next in reversed = older
    const cur  = sumStats(filteredGames(s));
    const prv  = prev ? sumStats(filteredGames(prev)) : null;
    const isToday = s.date === today;

    const dRev = prv ? fmtDelta(cur.revenue   - prv.revenue,   '$') : '—';
    const dPur = prv ? fmtDelta(cur.purchases - prv.purchases)      : '—';
    const dDL  = prv ? fmtDelta(cur.downloads - prv.downloads)      : '—';
    const dVw  = prv ? fmtDelta(cur.views     - prv.views)          : '—';

    return `<tr>
      <td class="${isToday ? 'today' : ''}">${s.date}${isToday ? ' ●' : ''}</td>
      <td class="num">${fmt$(cur.revenue)}</td>
      <td class="num">${dRev}</td>
      <td class="num">${fmtN(cur.purchases)}</td>
      <td class="num">${dPur}</td>
      <td class="num">${fmtN(cur.downloads)}</td>
      <td class="num">${dDL}</td>
      <td class="num">${fmtN(cur.views)}</td>
      <td class="num">${dVw}</td>
      <td class="num">${(s.games || []).length}</td>
    </tr>`;
  }).join('');
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function renderSidebar() {
  const games = (S.current?.games || []);
  const container = document.getElementById('game-filters');

  container.innerHTML = games.map(g => {
    const checked = S.selectedIds.size === 0 || S.selectedIds.has(g.id);
    return `<label class="game-filter-item${checked ? ' active' : ''}">
      <input type="checkbox" data-id="${g.id}" ${checked ? 'checked' : ''}>
      <span class="game-filter-name">${esc(g.title)}</span>
    </label>`;
  }).join('');

  container.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      // Collect checked IDs
      const checked = [...container.querySelectorAll('input:checked')].map(el => +el.dataset.id);
      S.selectedIds = checked.length === games.length ? new Set() : new Set(checked);
      // Update active classes
      container.querySelectorAll('.game-filter-item').forEach(item => {
        const id = +item.querySelector('input').dataset.id;
        item.classList.toggle('active', S.selectedIds.size === 0 || S.selectedIds.has(id));
      });
      renderAll(false); // skip sidebar re-render to avoid loop
    });
  });

  const n = S.snapshots.length;
  set('snapshot-info', n === 0 ? 'No snapshots yet.' :
    n === 1 ? '1 snapshot stored.' : `${n} snapshots stored.`);
}

// ─── Last Updated ─────────────────────────────────────────────────────────────
function renderHeader() {
  if (S.current) {
    set('last-updated', `Updated ${S.current.fetched_at.slice(0, 10)}`);
    if (S.current.user) {
      set('header-username', `👤 ${S.current.user.display_name || S.current.user.username}`);
    }
  }
}

// ─── Render all ──────────────────────────────────────────────────────────────
function renderAll(includeSidebar = true) {
  if (includeSidebar) renderSidebar();
  renderHeader();
  renderOverview();
  renderTrendChart();
  renderRevenuePie();
  renderDVBar();
  renderGamesGrid();
  renderHistoryTable();
}

// ─── CSV Export ───────────────────────────────────────────────────────────────
function exportCSV() {
  const snaps = [...S.snapshots].reverse();
  const rows = [['Date','Revenue_USD','New_Revenue','Sales','New_Sales','Downloads','New_Downloads','Views','New_Views','Games']];
  snaps.forEach((s, i) => {
    const prev = snaps[i + 1] || null;
    const cur  = sumStats(filteredGames(s));
    const prv  = prev ? sumStats(filteredGames(prev)) : null;
    rows.push([
      s.date,
      (cur.revenue / 100).toFixed(2),
      prv ? ((cur.revenue - prv.revenue) / 100).toFixed(2) : '',
      cur.purchases,
      prv ? cur.purchases - prv.purchases : '',
      cur.downloads,
      prv ? cur.downloads - prv.downloads : '',
      cur.views,
      prv ? cur.views - prv.views : '',
      (s.games || []).length,
    ]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'itchy-stats.csv';
  a.click();
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
const el = id => document.getElementById(id);
const set = (id, text) => { const e = el(id); if (e) e.textContent = text; };
const setHtml = (id, html) => { const e = el(id); if (e) e.innerHTML = html; };
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function showLoading(msg = 'Loading…') {
  el('loading-state').classList.remove('hidden');
  el('error-state').classList.add('hidden');
  el('dashboard').classList.add('hidden');
  set('loading-text', msg);
}

function showError(msg) {
  el('loading-state').classList.add('hidden');
  el('error-state').classList.remove('hidden');
  el('dashboard').classList.add('hidden');
  setHtml('error-text', msg);
}

function showDashboard() {
  el('loading-state').classList.add('hidden');
  el('error-state').classList.add('hidden');
  el('dashboard').classList.remove('hidden');
}

// ─── Load & Refresh ───────────────────────────────────────────────────────────
async function load(forceRefresh = false) {
  showLoading('Connecting to itch.io…');

  try {
    // Check key is configured
    await api('/credentials');
  } catch (e) {
    if (e.message.includes('No API key')) {
      showError(
        'No API key configured.<br><br>' +
        'Create a <code>.env</code> file in the project root:<br>' +
        '<code>ITCH_API_KEY=your_key_here</code><br><br>' +
        'Then restart the server. Get your key at ' +
        '<a href="https://itch.io/user/settings/api-keys" target="_blank" rel="noopener">itch.io/user/settings/api-keys</a>.'
      );
    } else {
      showError('API key error: ' + e.message);
    }
    return;
  }

  try {
    showLoading('Loading snapshots…');
    const stored = await api('/snapshots');
    S.snapshots = stored.snapshots || [];

    const today = new Date().toISOString().slice(0, 10);
    const hasToday = S.snapshots.some(s => s.date === today);

    if (forceRefresh || !hasToday) {
      showLoading('Fetching latest data from itch.io…');
      const result = await api('/snapshot', 'POST');
      const idx = S.snapshots.findIndex(s => s.date === result.snapshot.date);
      if (idx >= 0) S.snapshots[idx] = result.snapshot;
      else S.snapshots.push(result.snapshot);
      S.snapshots.sort((a, b) => a.date.localeCompare(b.date));
    }

    S.current = S.snapshots[S.snapshots.length - 1];
    showDashboard();
    renderAll();
  } catch (e) {
    showError('Failed to load data: ' + e.message);
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────
el('refresh-btn').addEventListener('click', () => load(true));
el('retry-btn').addEventListener('click', () => load());

el('compare-select').addEventListener('change', e => {
  S.compareWith = e.target.value;
  renderAll(false);
});

el('metric-tabs').addEventListener('click', e => {
  const tab = e.target.closest('.metric-tab');
  if (!tab) return;
  document.querySelectorAll('.metric-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  S.metric = tab.dataset.metric;
  renderTrendChart();
});

el('export-csv-btn').addEventListener('click', exportCSV);

// ─── Init ─────────────────────────────────────────────────────────────────────
load();
