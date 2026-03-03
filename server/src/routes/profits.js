import { Router } from 'express';
import { getGameData, getAllPrices } from '../services/gtApi.js';
import { calcProfits } from '../services/profitCalc.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const [gameData, prices] = await Promise.all([getGameData(), getAllPrices()]);
    const profits = calcProfits(gameData, prices);

    // Optional filters
    const { building, minProfit, excludeMissing } = req.query;
    let filtered = profits;

    if (building) {
      filtered = filtered.filter((r) =>
        r.buildingName?.toLowerCase().includes(building.toLowerCase())
      );
    }
    if (minProfit) {
      filtered = filtered.filter((r) => r.profitPerHour >= Number(minProfit));
    }
    if (excludeMissing === 'true') {
      filtered = filtered.filter((r) => !r.dataMissing);
    }

    res.json(filtered);
  } catch (err) {
    next(err);
  }
});

export default router;
