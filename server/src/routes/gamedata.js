import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getGameData, getSpriteUrl } from '../services/gtApi.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const SPRITE_CACHE_PATH = join(__dirname, '../../sprite-cache.svg');

// Icons don't change — serve from disk permanently once fetched.
// To force a refresh: delete sprite-cache.svg and restart the server.
function getCachedSprite() {
  if (!existsSync(SPRITE_CACHE_PATH)) return null;
  return readFileSync(SPRITE_CACHE_PATH, 'utf8');
}

router.get('/', async (req, res, next) => {
  try {
    const data = await getGameData();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/gamedata/sprite
// Serves the game's SVG sprite from our origin (avoids CORS on <use href>).
// Cached to disk for 24h so it survives restarts and minimises CDN hits.
router.get('/sprite', async (req, res, next) => {
  try {
    const cached = getCachedSprite();
    if (cached) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(cached);
    }

    const url = await getSpriteUrl();
    if (!url) return res.status(503).send('Sprite URL not available');
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(502).send('Failed to fetch sprite from CDN');
    const svg = await upstream.text();

    try { writeFileSync(SPRITE_CACHE_PATH, svg, 'utf8'); } catch { /* non-fatal */ }

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  } catch (err) {
    next(err);
  }
});

export default router;
