'use strict';

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ITCH_BASE = 'https://itch.io/api/1';
const DATA_DIR = path.join(__dirname, 'data');
const SNAPSHOTS_FILE = path.join(DATA_DIR, 'snapshots.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readSnapshots() {
  try {
    const raw = await fs.readFile(SNAPSHOTS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { snapshots: [] };
  }
}

async function writeSnapshots(data) {
  await ensureDataDir();
  await fs.writeFile(SNAPSHOTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// itch.io API helpers
// ---------------------------------------------------------------------------

function getKey(req) {
  return req.headers['x-api-key'] || process.env.ITCH_API_KEY || '';
}

async function itchRequest(key, endpoint) {
  const url = `${ITCH_BASE}/${key}${endpoint}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`itch.io ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.errors) throw new Error(data.errors.join(', '));
  return data;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Validate API key and return scopes
app.get('/api/credentials', async (req, res) => {
  const key = getKey(req);
  if (!key) return res.status(400).json({ error: 'No API key provided' });
  try {
    const data = await itchRequest(key, '/credentials/info');
    res.json(data);
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

// Fetch public profile for the key owner
app.get('/api/me', async (req, res) => {
  const key = getKey(req);
  if (!key) return res.status(400).json({ error: 'No API key provided' });
  try {
    const data = await itchRequest(key, '/me');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Current live game data (not stored)
app.get('/api/my-games', async (req, res) => {
  const key = getKey(req);
  if (!key) return res.status(400).json({ error: 'No API key provided' });
  try {
    const data = await itchRequest(key, '/my-games');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Return all stored snapshots
app.get('/api/snapshots', async (req, res) => {
  try {
    const data = await readSnapshots();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch fresh data from itch.io and persist as a snapshot.
// One snapshot per calendar day (today's snapshot is overwritten on re-fetch).
app.post('/api/snapshot', async (req, res) => {
  const key = getKey(req);
  if (!key) return res.status(400).json({ error: 'No API key provided' });

  try {
    const [gamesData, meData] = await Promise.all([
      itchRequest(key, '/my-games'),
      itchRequest(key, '/me').catch(() => ({ user: null })),
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
        p_osx: !!g.p_osx,
        p_linux: !!g.p_linux,
        p_android: !!g.p_android,
        views_count: g.views_count || 0,
        downloads_count: g.downloads_count || 0,
        purchases_count: g.purchases_count || 0,
        // earnings is an array: [{ currency, amount (cents), amount_formatted }]
        earnings: g.earnings || [],
      })),
    };

    const stored = await readSnapshots();

    const idx = stored.snapshots.findIndex(s => s.date === dateKey);
    if (idx >= 0) {
      stored.snapshots[idx] = snapshot;
    } else {
      stored.snapshots.push(snapshot);
    }

    // Chronological order; keep at most 730 days (~2 years)
    stored.snapshots.sort((a, b) => a.date.localeCompare(b.date));
    if (stored.snapshots.length > 730) {
      stored.snapshots = stored.snapshots.slice(-730);
    }

    await writeSnapshots(stored);

    res.json({ snapshot, total_snapshots: stored.snapshots.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a single snapshot by date (for cleanup)
app.delete('/api/snapshot/:date', async (req, res) => {
  try {
    const stored = await readSnapshots();
    stored.snapshots = stored.snapshots.filter(s => s.date !== req.params.date);
    await writeSnapshots(stored);
    res.json({ ok: true, remaining: stored.snapshots.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nitchy-stats → http://localhost:${PORT}\n`);
});
