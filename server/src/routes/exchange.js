import { Router } from 'express';
import { getAllPrices, getAllDetails, getMatDetails, getPriceHistory } from '../services/gtApi.js';

const router = Router();

router.get('/prices', async (req, res, next) => {
  try {
    const data = await getAllPrices();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/alldetails', async (req, res, next) => {
  try {
    const data = await getAllDetails();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/details/:matId', async (req, res, next) => {
  try {
    const data = await getMatDetails(Number(req.params.matId));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/history/:matId', async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 90);
    const data = await getPriceHistory(Number(req.params.matId), days);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
