'use strict';

// Fetches current stats from itch.io and appends a dated snapshot to
// docs/data/snapshots.json. Run locally or via GitHub Actions.

require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ITCH_BASE = 'https://itch.io/api/1';
const DATA_PATH = path.join(__dirname, '..', 'docs', 'data', 'snapshots.json');

async function itchGet(key, endpoint) {
  const res = await fetch(`${ITCH_BASE}/${key}${endpoint}`);
  const data = await res.json();
  if (data.errors) throw new Error(data.errors.join(', '));
  return data;
}

async function main() {
  const key = process.env.ITCH_API_KEY;
  if (!key) throw new Error('ITCH_API_KEY is not set. Add it to .env or as a GitHub secret.');

  console.log('Fetching from itch.io…');

  const [gamesData, meData] = await Promise.all([
    itchGet(key, '/my-games'),
    itchGet(key, '/me').catch(() => ({ user: null })),
  ]);

  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const snapshot = {
    date: dateKey,
    fetched_at: now.toISOString(),
    user: meData.user || null,
    games: (gamesData.games || []).map(g => ({
      id: g.id,
      title: g.title,
      url: g.url,
      cover_url: g.cover_url,
      created_at: g.created_at,
      published_at: g.published_at,
      published: g.published,
      type: g.type,
      short_text: g.short_text,
      min_price: g.min_price,
      p_windows: !!g.p_windows,
      p_osx:     !!g.p_osx,
      p_linux:   !!g.p_linux,
      p_android: !!g.p_android,
      views_count:     g.views_count     || 0,
      downloads_count: g.downloads_count || 0,
      purchases_count: g.purchases_count || 0,
      earnings: g.earnings || [],
    })),
  };

  // Load existing snapshots
  let stored = { snapshots: [] };
  if (fs.existsSync(DATA_PATH)) {
    stored = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  }

  // Upsert today's entry (re-running on the same day overwrites)
  const idx = stored.snapshots.findIndex(s => s.date === dateKey);
  if (idx >= 0) stored.snapshots[idx] = snapshot;
  else stored.snapshots.push(snapshot);

  // Keep sorted, cap at 2 years of history
  stored.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  if (stored.snapshots.length > 730) stored.snapshots = stored.snapshots.slice(-730);

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(stored, null, 2), 'utf8');

  // Write password hash to config.json if DASHBOARD_PASSWORD is set
  const configPath = path.join(path.dirname(DATA_PATH), 'config.json');
  if (process.env.DASHBOARD_PASSWORD) {
    const hash = crypto.createHash('sha256').update(process.env.DASHBOARD_PASSWORD).digest('hex');
    fs.writeFileSync(configPath, JSON.stringify({ passwordHash: hash }, null, 2), 'utf8');
    console.log('   Password protection: enabled');
  } else if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({}, null, 2), 'utf8');
  }

  const totalRevenue = snapshot.games.reduce((sum, g) => {
    const usd = (g.earnings || []).find(e => e.currency === 'USD');
    return sum + (usd ? usd.amount : 0);
  }, 0);

  console.log(`✓  Snapshot saved for ${dateKey} (${stored.snapshots.length} total)`);
  console.log(`   Games: ${snapshot.games.length}`);
  console.log(`   Revenue: $${(totalRevenue / 100).toFixed(2)}`);
  if (snapshot.user) console.log(`   User: ${snapshot.user.username}`);
}

main().catch(err => {
  console.error('✗', err.message);
  process.exit(1);
});
