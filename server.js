import express from 'express'

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

const metas = {
  'kan11:zman-emet': {
    id: 'kan11:zman-emet',
    type: 'series',
    name: 'זמן אמת',
    description: 'תוכנית תחקירים המביאה את הסיפורים העיתונאיים החשובים באמת: תחקירים, כתבות דיוקן וחשיפות שונות של תופעות חברתיות ישראליות, הונאות ושחיתויות, ותופעות עולמיות.',
    videos: [
      {
        id: 'kan11:zman-emet:s5e22',
        title: 'עונה 5 פרק 22 - העדות החדשה',
        season: 5,
        episode: 22
      },
      {
        id: 'kan11:zman-emet:s5e21',
        title: 'עונה 5 פרק 21 - במילוי תפקידו',
        season: 5,
        episode: 21
      },
      {
        id: 'kan11:zman-emet:s5e20',
        title: 'עונה 5 פרק 20 - חורגים מהמסגרת',
        season: 
