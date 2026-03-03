import { Router } from 'express';
import { getGameData } from '../services/gtApi.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const data = await getGameData();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
