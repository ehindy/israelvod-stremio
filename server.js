import express from 'express'
import * as cheerio from 'cheerio'

const manifest = {
  id: 'community.israelvod.stremio',
  version: '0.2.0',
  name: 'Israel VOD',
  description: 'Catalog addon for Kan 11, Keshet 12 and Reshet 13',
  resources: ['catalog', 'meta'],
  types: ['series'],
  catalogs: [
    {
      type: 'series',
      id: 'vod-11',
      name: 'כאן 11',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'vod-12',
      name: 'קשת 12',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'vod-13',
      name: 'רשת 13',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'vod-all',
      name: 'כל הספריות',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    }
  ]
}

const app = express()

const sampleCatalogs = {
  'vod-11': [
    {
      id: 'kan11:zman-emet',
      type: 'series',
      name: 'זמן אמת'
    }
  ],
  'vod-12': [],
  'vod-13': [],
  'vod-all': [
    {
      id: 'kan11:zman-emet',
      type: 'series',
      name: 'זמן אמת'
    }
  ]
}

const KAN_SHOWS = {
  'kan11:zman-emet': {
    id: 'kan11:zman-emet',
    name: 'זמן אמת',
    description: 'תוכנית תחקירים המביאה את הסיפורים העיתונאיים החשובים באמת: תחקירים, כתבות דיוקן וחשיפות שונות של תופעות חברתיות ישראליות, הונאות ושחיתויות, ותופעות עולמיות.',
    mainUrl: 'https://www.kan.org.il/content/kan/kan-11/p-12043/',
    seasonUrls: [
      'https://www.kan.org.il/content/kan/kan-11/p-12043/s10/',
      'https://www.kan.org.il/content/kan/kan-11/p-12043/s7/',
      'https://www.kan.org.il/content/kan/kan-11/p-12043/s6/',
      'https://www.kan.org.il/content/kan/kan-11/p-12043/s5/',
      'https://www.kan.org.il/content/kan/kan-11/p-12043/s4/',
      'https://www.kan.org.il/content/kan/kan-11/p-12043/s3/',
      'https://www.kan.org.il/content/kan/kan-11/p-12043/s2/',
      'https://www.kan.org.il/content/kan/kan-11/p-12043/s1/'
    ]
  }
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim()
}

function parseSeasonNumberFromUrl(url) {
  const match = url.match(/\/s(\d+)\//)
  return match ? Number(match[1]) : undefined
}

function parseEpisodesFromHtml(html, fallbackSeason) {
  const $ = cheerio.load(html)
  const text = normalizeText($.root().text())

  const episodes = []
  const regex = /פרק\s+(\d+)\s*-\s*([^0-9]+?)(?=(?:\d{2}:\d{2}:\d{2}\s*פרק\s+\d+)|$)/g

  let match
  while ((match = regex.exec(text)) !== null) {
    const episodeNumber = Number(match[1])
    const rawTitle = normalizeText(match[2])
    const title = `עונה ${fallbackSeason} פרק ${episodeNumber} - ${rawTitle}`

    episodes.push({
      id: `kan11:zman-emet:s${fallbackSeason}e${episodeNumber}`,
      title,
      season: fallbackSeason,
      episode: episodeNumber
    })
  }

  const deduped = []
  const seen = new Set()

  for (const ep of episodes) {
    if (!seen.has(ep.id)) {
      seen.add(ep.id)
      deduped.push(ep)
    }
  }

  deduped.sort((a, b) => {
    if (a.season !== b.season) return b.season - a.season
    return b.episode - a.episode
  })

  return deduped
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; IsraelVOD/0.2)'
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }

  return await response.text()
}

async function buildDynamicKanMeta(showId) {
  const show = KAN_SHOWS[showId]

  if (!show) {
    return null
  }

  const allEpisodes = []

  for (const seasonUrl of show.seasonUrls) {
    try {
      const html = await fetchHtml(seasonUrl)
      const seasonNumber = parseSeasonNumberFromUrl(seasonUrl)
      const episodes = parseEpisodesFromHtml(html, seasonNumber)

      allEpisodes.push(...episodes)
    } catch (error) {
      console.error(`Failed season scrape for ${seasonUrl}: ${error.message}`)
    }
  }

  const unique = []
  const seen = new Set()

  for (const ep of allEpisodes) {
    if (!seen.has(ep.id)) {
      seen.add(ep.id)
      unique.push(ep)
    }
  }

  unique.sort((a, b) => {
    if (a.season !== b.season) return b.season - a.season
    return b.episode - a.episode
  })

  return {
    id: show.id,
    type: 'series',
    name: show.name,
    description: show.description,
    videos: unique
  }
}

app.get('/', (_, res) => {
  res.type('text/plain').send('Israel VOD addon is running. Open /manifest.json')
})

app.get('/manifest.json', (_, res) => {
  res.json(manifest)
})

app.get('/catalog/:type/:id.json', (req, res) => {
  const { id } = req.params
  res.json({
    metas: sampleCatalogs[id] || []
  })
})

app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { id } = req.params

    if (id === 'kan11:zman-emet') {
      const meta = await buildDynamicKanMeta(id)

      if (!meta) {
        return res.status(404).json({ error: 'meta not found' })
      }

      return res.json({ meta })
    }

    return res.status(404).json({ error: 'meta not found' })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

const port = process.env.PORT || 7000

app.listen(port, () => {
  console.log(`Israel VOD addon listening on http://localhost:${port}`)
})
