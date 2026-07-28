const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 7000;
const ORIGIN = 'https://www.kan.org.il';
const SOURCE_URL = `${ORIGIN}/lobby/kan-box/`;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60 * 60 * 1000);

const cache = {
  fetchedAt: 0,
  items: [],
  series: [],
  episodes: [],
  groups: {}
};

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KanDynamicCatalog/1.0)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirected = new URL(res.headers.location, url).toString();
        res.resume();
        return resolve(fetchText(redirected));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Request timeout')));
  });
}

function decodeHtml(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAnchorItems(html) {
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const raw = [];
  let m;
  while ((m = regex.exec(html))) {
    const href = m[1];
    const inner = m[2]
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    const text = decodeHtml(inner);
    raw.push({ href, text });
  }
  return raw;
}

function normalizeUrl(href) {
  try {
    return new URL(href, ORIGIN).toString();
  } catch {
    return null;
  }
}

function classifyItem(url, text) {
  const m = url.match(/\/content\/kan\/([^/]+)\/p-(\d+)(?:\/s(\d+)\/(\d+)\/?)?/);
  if (!m) return null;
  const section = m[1];
  const programId = m[2];
  const season = m[3] ? Number(m[3]) : null;
  const episodeId = m[4] ? Number(m[4]) : null;
  return {
    text,
    url,
    section,
    programId,
    season,
    episodeId,
    type: season || episodeId ? 'episode' : 'series'
  };
}

function cleanItems(items) {
  const allowedSections = new Set(['kan-11', 'kan-actual', 'podcasts', 'kan-reka', 'eurovision-2023']);
  const blacklistTexts = new Set(['לעמוד הסדרה']);
  const seen = new Map();

  for (const row of items) {
    const url = normalizeUrl(row.href);
    if (!url) continue;
    const classified = classifyItem(url, row.text || '');
    if (!classified) continue;
    if (!allowedSections.has(classified.section)) continue;
    if (!classified.text || blacklistTexts.has(classified.text)) continue;

    const key = `${classified.url}|||${classified.text}`;
    if (!seen.has(key)) seen.set(key, classified);
  }

  return [...seen.values()];
}

function splitCatalog(items) {
  const series = [];
  const episodes = [];
  const groups = {};

  for (const item of items) {
    if (!groups[item.section]) groups[item.section] = [];
    groups[item.section].push(item);
    if (item.type === 'episode') episodes.push(item);
    else series.push(item);
  }

  return { series, episodes, groups };
}

async function refreshCache(force = false) {
  if (!force && cache.items.length && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  const html = await fetchText(SOURCE_URL);
  const anchors = extractAnchorItems(html);
  const items = cleanItems(anchors);
  const { series, episodes, groups } = splitCatalog(items);

  cache.fetchedAt = Date.now();
  cache.items = items;
  cache.series = series;
  cache.episodes = episodes;
  cache.groups = groups;
  return cache;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300'
  });
  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/') {
      return sendJson(res, 200, {
        name: 'kan-dynamic-catalog',
        source: SOURCE_URL,
        endpoints: [
          '/refresh',
          '/catalog',
          '/catalog/series',
          '/catalog/episodes',
          '/catalog/section/kan-11',
          '/catalog/section/kan-actual',
          '/catalog/section/podcasts',
          '/catalog/section/kan-reka'
        ]
      });
    }

    if (url.pathname === '/refresh') {
      const data = await refreshCache(true);
      return sendJson(res, 200, {
        ok: true,
        fetchedAt: data.fetchedAt,
        total: data.items.length,
        series: data.series.length,
        episodes: data.episodes.length
      });
    }

    const data = await refreshCache(false);

    if (url.pathname === '/catalog') {
      return sendJson(res, 200, {
        fetchedAt: data.fetchedAt,
        total: data.items.length,
        series: data.series.length,
        episodes: data.episodes.length,
        items: data.items
      });
    }

    if (url.pathname === '/catalog/series') {
      return sendJson(res, 200, { fetchedAt: data.fetchedAt, total: data.series.length, items: data.series });
    }

    if (url.pathname === '/catalog/episodes') {
      return sendJson(res, 200, { fetchedAt: data.fetchedAt, total: data.episodes.length, items: data.episodes });
    }

    const sec = url.pathname.match(/^\/catalog\/section\/([^/]+)$/);
    if (sec) {
      const section = sec[1];
      return sendJson(res, 200, {
        fetchedAt: data.fetchedAt,
        section,
        total: (data.groups[section] || []).length,
        items: data.groups[section] || []
      });
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`kan dynamic catalog listening on http://localhost:${PORT}`);
});
