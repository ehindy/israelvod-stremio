import express from 'express'
import sdk from 'stremio-addon-sdk'

const { addonBuilder, serveHTTP } = sdk

const manifest = {
  id: 'community.israelvod.stremio',
  version: '0.1.0',
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

const builder = new addonBuilder(manifest)

builder.defineCatalogHandler(async ({ id }) => {
  const sample = {
    'vod-11': [{ id: 'kan11:test', type: 'series', name: 'בדיקת כאן 11' }],
    'vod-12': [{ id: 'keshet12:test', type: 'series', name: 'בדיקת קשת 12' }],
    'vod-13': [{ id: 'reshet13:test', type: 'series', name: 'בדיקת רשת 13' }],
    'vod-all': [
      { id: 'kan11:test', type: 'series', name: 'בדיקת כאן 11' },
      { id: 'keshet12:test', type: 'series', name: 'בדיקת קשת 12' },
      { id: 'reshet13:test', type: 'series', name: 'בדיקת רשת 13' }
    ]
  }

  return { metas: sample[id] || [] }
})

builder.defineMetaHandler(async ({ id }) => {
  return {
    meta: {
      id,
      type: 'series',
      name: `Meta for ${id}`,
      description: 'Temporary test metadata',
      videos: []
    }
  }
})

const app = express()

app.get('/', (_, res) => {
  res.type('text/plain').send('Israel VOD addon is running. Open /manifest.json')
})

serveHTTP(builder.getInterface(), { app })

const port = process.env.PORT || 7000
app.listen(port, () => {
  console.log(`Israel VOD addon listening on http://localhost:${port}/manifest.json`)
})
