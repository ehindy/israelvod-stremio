const { addonBuilder, serveHTTP } = require('stremio-addon-sdk')
const axios = require('axios')
const cheerio = require('cheerio')

const BASE = 'https://www.kan.org.il'
const USER_AGENT = 'Mozilla/5.0 (compatible; KanStremioAddon/1.0)'
const CACHE_TTL_MS = 15 * 60 * 1000
const cache = new Map()

function absoluteUrl(url) {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/')) return `${BASE}${url}`
  return `${BASE}/${url}`
}

async function fetchText(url) {
  const now = Date.now()
  const cached = cache.get(url)
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'he,en;q=0.8' },
    timeout: 30000,
    responseType: 'text'
  })
  cache.set(url, { ts: now, data })
  return data
}

function cleanText(str) {
  return (str || '').replace(/\s+/g, ' ').trim()
}

function parseLdJson($) {
  const results = []
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html()
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) results.push(...parsed)
      else results.push(parsed)
    } catch {}
  })
  return results
}

function extractEpisodeData(html, pageUrl) {
  const $ = cheerio.load(html)
  const player = $('[id^="redge-player-"]').first()
  if (!player.length) throw new Error('Player block not found')

  const ld = parseLdJson($)
  const videoObject = ld.find(x => x['@type'] === 'VideoObject') || {}
  const canonical = $('link[rel="canonical"]').attr('href') || pageUrl
  const m = canonical.match(/\/p-(\d+)\/s(\d+)\/(\d+)\/?$/)

  const programId = m ? m[1] : String(player.attr('data-player-id') || '')
  const season = m ? Number(m[2]) : Number(player.attr('data-meta-season-number') || 1)
  const episodeId = m ? m[3] : String(player.attr('data-player-id') || '')

  const title = cleanText(player.attr('data-meta-title')) || cleanText(videoObject.name) || cleanText($('title').text())
  const seriesName = cleanText(player.attr('data-meta-series-name')) || cleanText($('meta[property="og:site_name"]').attr('content')) || 'Kan'
  const poster = absoluteUrl(player.attr('data-poster-url') || videoObject.thumbnailUrl || $('meta[property="og:image"]').attr('content'))
  const background = absoluteUrl($('meta[property="og:image"]').attr('content') || poster)
  const description = cleanText($('meta[name="description"]').attr('content') || videoObject.description || '')
  const dashUrl = absoluteUrl(player.attr('data-dash-url'))
  const hlsUrl = absoluteUrl(player.attr('data-hls-url'))
  const duration = Number(($('body').html().match(/itemduration\s*(?:[:=])\s*(\d+)/i) || [])[1] || 0)

  return {
    id: `kan:series:${programId}`,
    type: 'series',
    name: seriesName,
    poster,
    background,
    description,
    videos: [{
      id: `kan:episode:${episodeId}`,
      title,
      season,
      episode: 1,
      released: undefined,
      thumbnail: poster,
      streams: { dashUrl, hlsUrl },
      overview: description
    }],
    _episode: {
      title,
      season,
      episodeId,
      programId,
      dashUrl,
      hlsUrl,
      canonical,
      poster,
      description
    }
  }
}

async function getEpisodeFromUrl(pageUrl) {
  const html = await fetchText(pageUrl)
  return extractEpisodeData(html, pageUrl)
}

async function getSeasonEpisodes(seriesUrl) {
  const html = await fetchText(seriesUrl)
  const $ = cheerio.load(html)
  const links = new Map()
  $('a[href*="/p-"][href*="/s"]').each((_, el) => {
    const href = absoluteUrl($(el).attr('href'))
    const mm = href.match(/\/p-(\d+)\/s(\d+)\/(\d+)\/?$/)
    if (mm) links.set(href, true)
  })
  const urls = [...links.keys()].slice(0, 100)
  const out = []
  for (const url of urls) {
    try {
      const parsed = await getEpisodeFromUrl(url)
      out.push(parsed._episode)
    } catch {}
  }
  return out.sort((a, b) => String(a.episodeId).localeCompare(String(a.episodeId)))
}

const manifest = {
  id: 'org.kan.vod',
  version: '1.0.0',
  name: 'Kan VOD',
  description: 'Auto-discovers Kan VOD episode streams from episode pages',
  resources: ['catalog', 'meta', 'stream'],
  types: ['series'],
  idPrefixes: ['kan:series:', 'kan:episode:'],
  catalogs: [
    {
      type: 'series',
      id: 'kan-latest',
      name: 'Kan Latest',
      extra: [
        { name: 'search', isRequired: false }
      ]
    }
  ]
}

const builder = new addonBuilder(manifest)

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== 'series' || id !== 'kan-latest') return { metas: [] }
  const search = (extra && extra.search) ? encodeURIComponent(extra.search) : ''
  const target = search
    ? `${BASE}/search/?query=${search}`
    : `${BASE}/lobby/series/`
  const html = await fetchText(target)
  const $ = cheerio.load(html)
  const metas = []
  const seen = new Set()
  $('a[href*="/content/kan/kan-11/p-"]').each((_, el) => {
    const href = absoluteUrl($(el).attr('href'))
    const mm = href.match(/\/p-(\d+)(?:\/|$)/)
    if (!mm) return
    const programId = mm[1]
    const metaId = `kan:series:${programId}`
    if (seen.has(metaId)) return
    seen.add(metaId)
    const name = cleanText($(el).text()) || `Kan Series ${programId}`
    const img = absoluteUrl($(el).find('img').attr('src') || '')
    metas.push({ id: metaId, type: 'series', name, poster: img || undefined })
  })
  return { metas: metas.slice(0, 100) }
})

builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== 'series' || !id.startsWith('kan:series:')) return { meta: null }
  const programId = id.split(':').pop()
  const seasonUrl = `${BASE}/content/kan/kan-11/p-${programId}/s1/`
  const episodes = await getSeasonEpisodes(seasonUrl)
  const first = episodes[0]
  return {
    meta: {
      id,
      type: 'series',
      name: first ? `Kan ${programId}` : `Kan ${programId}`,
      poster: first ? first.poster : undefined,
      background: first ? first.poster : undefined,
      description: first ? first.description : 'Kan VOD series',
      videos: episodes.map((ep, idx) => ({
        id: `kan:episode:${ep.episodeId}`,
        title: ep.title || `Episode ${idx + 1}`,
        season: ep.season || 1,
        episode: idx + 1,
        thumbnail: ep.poster,
        overview: ep.description
      }))
    }
  }
})

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== 'series' || !id.startsWith('kan:episode:')) return { streams: [] }
  const episodeId = id.split(':').pop()
  const searchUrl = `${BASE}/search/?query=${encodeURIComponent(episodeId)}`
  const html = await fetchText(searchUrl)
  const $ = cheerio.load(html)
  let pageUrl = ''
  $('a[href]').each((_, el) => {
    const href = absoluteUrl($(el).attr('href'))
    if (href.includes(`/${episodeId}/`)) {
      pageUrl = href
      return false
    }
  })
  if (!pageUrl) return { streams: [] }
  const parsed = await getEpisodeFromUrl(pageUrl)
  const ep = parsed._episode
  const streams = []
  if (ep.hlsUrl) streams.push({
    name: 'Kan VOD HLS',
    title: `${ep.title} • HLS`,
    url: ep.hlsUrl,
    behaviorHints: { bingeGroup: `kan-${ep.programId}` }
  })
  if (ep.dashUrl) streams.push({
    name: 'Kan VOD DASH',
    title: `${ep.title} • DASH`,
    externalUrl: ep.dashUrl
  })
  return { streams }
})

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 })
