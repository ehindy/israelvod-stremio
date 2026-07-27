import express from 'express'
import * as cheerio from 'cheerio'

const app = express()

const manifest = {
  id: 'community.israelvod.stremio',
  version: '0.3.0',
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
    lobby: 'https://www.kan.org.il/lobby/kan11/',
    allowedPrefixes: ['/content/kan/kan-11/'],
    idPrefix: 'kan11',
    type: 'series'
  }
}

function normalizeText(text) {
  return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function absolutize(url, base) {
  try {
    return new URL(url, base).href
  } catch {
    return null
  }
}

function dedupeByKey(items, keyFn) {
  const seen = new Set()
  const out = []

  for (const item of items) {
    const key = keyFn(item)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(item)
    }
  }

  return out
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; IsraelVOD/0.3)'
    }
  })

  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} ${url}`)
  }

  return await res.text()
}

function getCached(key) {
  const entry = cache.get(key)
  if (!entry) return null

  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }

  return entry.value
}

function setCached(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL })
}

async function getKanLobbyCatalog() {
  const cached = getCached('kan11-catalog')
  if (cached) return cached

  const html = await fetchHtml(SOURCES['vod-11'].lobby)
  const $ = cheerio.load(html)
  const items = []

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || ''
    const abs = absolutize(href, SOURCES['vod-11'].lobby)
    if (!abs) return
    if (!SOURCES['vod-11'].allowedPrefixes.some(prefix => abs.includes(prefix))) return

    const text = normalizeText($(el).text())
    if (!text || text.length < 2) return

    items.push({
      href: abs,
      name: text
    })
  })

  const cleaned = dedupeByKey(items, item => item.href)
    .map(item => {
      const href = new URL(item.href)
      const path = href.pathname
      const match = path.match(/\/content\/kan\/kan-11\/p-(\d+)\//)

      if (!match) return null

      const programId = match[1]
      const id = `kan11:${programId}`

      return {
        id,
        type: 'series',
        name: item.name,
        url: item.href
      }
    })
    .filter(Boolean)

  const ordered = dedupeByKey(cleaned, item => item.id)
  setCached('kan11-catalog', ordered)
  return ordered
}

function parseEpisodeNodesFromPage($, pageUrl) {
  const text = normalizeText($.root().text())
  const seasonMatch = pageUrl.match(/\/s(\d+)\//)
  const season = seasonMatch ? Number(seasonMatch[1]) : undefined

  const matches = [...text.matchAll(/פרק\s+(\d+)\s*[-–:]\s*([^\n\r|·<>]{2,120})/g)]

  const videos = matches.map(match => {
    const episode = Number(match[1])
    const titlePart = normalizeText(match[2])

    return {
      id: `${pageUrl}#s${season || 0}e${episode}`,
      title: season
        ? `עונה ${season} פרק ${episode} - ${titlePart}`
        : `פרק ${episode} - ${titlePart}`,
      season,
      episode
    }
  })

  return dedupeByKey(videos, video => video.id)
}

async function buildKanMeta(id) {
  const cached = getCached(`meta:${id}`)
  if (cached) return cached

  if (!id.startsWith('kan11:')) return null

  const programId = id.split(':')[1]
  const catalog = await getKanLobbyCatalog()
  const item = catalog.find(entry => entry.id === id)

  const title = item?.name || `כאן 11 ${programId}`
  const meta = {
    id,
    type: 'series',
    name: title,
    description: `תכנים מעודכנים של ${title} מכאן 11.`,
    videos: []
  }

  const candidateUrls = [
    item?.url,
    `https://www.kan.org.il/content/kan/kan-11/p-${programId}/`
  ].filter(Boolean)

  for (const url of candidateUrls) {
    try {
      const html = await fetchHtml(url)
      const $ = cheerio.load(html)
      const videos = parseEpisodeNodesFromPage($, url)

      if (videos.length) {
        meta.videos = videos
        break
      }
    } catch (error) {
      console.error(`meta scrape failed for ${url}: ${error.message}`)
    }
  }

  setCached(`meta:${id}`, meta)
  return meta
}

app.get('/', (_, res) => {
  res.type('text/plain').send('Israel VOD addon is running. Open /manifest.json')
})

app.get('/manifest.json', (_, res) => {
  res.json(manifest)
})

app.get('/catalog/:type/:id.json', async (req, res) => {
  try {
    const { id } = req.params

    if (id === 'vod-11') {
      const metas = await getKanLobbyCatalog()
      return res.json({ metas })
    }

    return res.json({ metas: [] })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { id } = req.params
    const meta = await buildKanMeta(id)

    if (!meta) {
      return res.status(404).json({ error: 'meta not found' })
    }

    return res.json({ meta })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

const port = process.env.PORT || 7000

app.listen(port, () => {
  console.log(`Israel VOD addon listening on http://localhost:${port}`)
})
