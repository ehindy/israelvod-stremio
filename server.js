import express from 'express'
import * as cheerio from 'cheerio'

const app = express()

const manifest = {
  id: 'community.israelvod.stremio',
  version: '0.4.0',
  name: 'Israel VOD',
  description: 'Dynamic catalog addon for Kan 11, Keshet 12 and Reshet 13',
  resources: ['catalog', 'meta'],
  types: ['series'],
  catalogs: [
    { type: 'series', id: 'vod-11', name: 'כאן 11', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    { type: 'series', id: 'vod-12', name: 'קשת 12', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    { type: 'series', id: 'vod-13', name: 'רשת 13', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    { type: 'series', id: 'vod-all', name: 'כל הספריות', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] }
  ]
}

const CACHE_TTL = 30 * 60 * 1000
const cache = new Map()

const SOURCES = {
  'vod-11': {
    name: 'כאן 11',
    lobby: 'https://www.kan.org.il/lobby/kan-box/',
    allowedPrefixes: ['/content/kan/'],
    idPrefix: 'kan11',
    type: 'series'
  }
}

function normalizeText(text) {
  return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function absolutize(url, base) {
  try { return new URL(url, base).href } catch { return null }
}

function dedupeByKey(items, keyFn) {
  const seen = new Set(); const out = []
  for (const item of items) {
    const key = keyFn(item)
    if (!seen.has(key)) { seen.add(key); out.push(item) }
  }
  return out
}

function getCached(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null }
  return entry.value
}

function setCached(key, value) { cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL }) }

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'referer': 'https://www.kan.org.il/'
    },
    redirect: 'follow'
  })
  if (!res.ok) throw new Error(`fetch failed ${res.status} ${url}`)
  return await res.text()
}

async function scrapeKanBoxCatalog() {
  const cached = getCached('kan11-catalog')
  if (cached) return cached

  const html = await fetchHtml(SOURCES['vod-11'].lobby)
  const $ = cheerio.load(html)
  const items = []

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || ''
    const abs = absolutize(href, SOURCES['vod-11'].lobby)
    if (!abs) return
    if (!SOURCES['vod-11'].allowedPrefixes.some(prefix => new URL(abs).pathname.startsWith(prefix))) return
    const text = normalizeText($(el).text())
    const imgAlt = normalizeText($(el).find('img').attr('alt'))
    const name = text || imgAlt
    if (!name || name.length < 2) return
    const path = new URL(abs).pathname
    const match = path.match(/\/content\/kan\/(?:kan-11\/)?p-(\d+)/)
    if (!match) return
    const programId = match[1]
    items.push({ id: `kan11:${programId}`, type: 'series', name, url: abs })
  })

  const metas = dedupeByKey(items, x => x.id)
  setCached('kan11-catalog', metas)
  return metas
}

function parseEpisodeNodesFromPage(html, pageUrl) {
  const $ = cheerio.load(html)
  const scripts = $('script').map((_, el) => $(el).html() || '').get().join('\n')
  const combined = normalizeText($.root().text() + ' ' + scripts)
  const seasonMatch = pageUrl.match(/\/s(\d+)\//)
  const season = seasonMatch ? Number(seasonMatch[1]) : undefined
  const out = []
  const regexes = [
    /פרק\s+(\d+)\s*[-–:]\s*([^·<\n\r]{2,120})/g,
    /"title"\s*:\s*"(?:(?:[^"\\]|\\.)*?)פרק\s+(\d+)\s*[-–:]\s*([^"\\]{2,120})/g
  ]
  for (const re of regexes) {
    let m
    while ((m = re.exec(combined)) !== null) {
      const ep = Number(m[1])
      const t = normalizeText(m[2])
      if (!ep || !t) continue
      out.push({ id: `${pageUrl}#s${season || 0}e${ep}`, title: season ? `עונה ${season} פרק ${ep} - ${t}` : `פרק ${ep} - ${t}`, season, episode: ep })
    }
  }
  return dedupeByKey(out, x => x.id).sort((a,b) => (b.season||0) - (a.season||0) || b.episode - a.episode)
}

async function buildKanMeta(id) {
  const cached = getCached(`meta:${id}`)
  if (cached) return cached
  if (!id.startsWith('kan11:')) return null
  const programId = id.split(':')[1]
  const catalog = await scrapeKanBoxCatalog()
  const item = catalog.find(x => x.id === id)
  const title = item?.name || `כאן 11 ${programId}`
  const meta = { id, type: 'series', name: title, description: `תכנים מעודכנים של ${title} מכאן 11.`, videos: [] }
  const candidateUrls = [
    item?.url,
    `https://www.kan.org.il/content/kan/kan-11/p-${programId}/`,
    `https://www.kan.org.il/content/kan/kan-11/p-${programId}/s1/`,
    `https://www.kan.org.il/content/kan/kan-11/p-${programId}/s2/`,
    `https://www.kan.org.il/content/kan/kan-11/p-${programId}/s3/`
  ].filter(Boolean)
  for (const url of candidateUrls) {
    try {
      const html = await fetchHtml(url)
      const videos = parseEpisodeNodesFromPage(html, url)
      if (videos.length) { meta.videos = videos; break }
    } catch (e) {}
  }
  setCached(`meta:${id}`, meta)
  return meta
}

app.get('/', (_, res) => res.type('text/plain').send('Israel VOD addon is running. Open /manifest.json'))
app.get('/manifest.json', (_, res) => res.json(manifest))
app.get('/catalog/:type/:id.json', async (req, res) => {
  try {
    const { id } = req.params
    if (id === 'vod-11') return res.json({ metas: await scrapeKanBoxCatalog() })
    return res.json({ metas: [] })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})
app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { id } = req.params
    const meta = await buildKanMeta(id)
    if (!meta) return res.status(404).json({ error: 'meta not found' })
    return res.json({ meta })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})
const port = process.env.PORT || 7000
app.listen(port, () => console.log(`Israel VOD addon listening on http://localhost:${port}`))
