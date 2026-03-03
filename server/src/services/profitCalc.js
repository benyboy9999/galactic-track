/**
 * Full profit calculation including:
 *  1. Input material costs
 *  2. Worker overhead (admin wages + essential consumables)
 *     attributed proportionally to each recipe run
 *
 * Data facts from the GT API / wiki:
 *   building.workersNeeded[i]  → count of worker type (i+1)
 *   workerDef.adminCost        → GCU per actual worker per day
 *   consumable.amount          → units per 1,000 workers per day
 *   recipe.timeMinutes         → duration in minutes
 *
 * Workers are employed 24/7. Cost per recipe run = daily_cost × (timeMinutes / 1440).
 * Only essential consumables are included in the base cost (missing them causes -40% satisfaction).
 * Non-essential are tracked separately and shown in the UI.
 *
 * All monetary values are in GCU cents (the game's base currency unit).
 */

export function calcProfits(gameData, allPrices) {
  const priceMap = new Map(allPrices.map((p) => [p.matId, p]));
  const matNameMap = new Map(gameData.materials.map((m) => [m.id, m.name]));
  const buildingMap = new Map(gameData.buildings.map((b) => [b.id, b]));

  // Index workers by type (type 1 → index 0, type 2 → index 1, etc.)
  const workerByType = new Map(gameData.workers.map((w) => [w.type, w]));

  const results = [];

  for (const recipe of gameData.recipes) {
    const building = buildingMap.get(recipe.producedIn);

    // ── Input material cost ──────────────────────────────────────────────────
    let inputCost = 0;
    let inputsMissing = false;
    const inputBreakdown = [];

    for (const inp of recipe.inputs ?? []) {
      const matId = inp.id ?? inp.i;
      const qty   = inp.a  ?? inp.am ?? 1;
      const price = priceMap.get(matId);
      const matName = matNameMap.get(matId) ?? `Mat #${matId}`;

      if (!price || price.currentPrice < 0) {
        inputsMissing = true;
        inputBreakdown.push({ matId, matName, qty, unitPrice: null, totalCost: null });
        continue;
      }
      const cost = price.currentPrice * qty;
      inputCost += cost;
      inputBreakdown.push({ matId, matName, qty, unitPrice: price.currentPrice, totalCost: cost });
    }

    // ── Output revenue ───────────────────────────────────────────────────────
    let outputRevenue = 0;
    let outputsMissing = false;
    const outputBreakdown = [];

    if (recipe.output) {
      const out   = recipe.output;
      const matId = out.id ?? out.i;
      const qty   = out.a  ?? out.am ?? 1;
      const price = priceMap.get(matId);
      const matName = matNameMap.get(matId) ?? `Mat #${matId}`;

      if (!price || price.currentPrice < 0) {
        outputsMissing = true;
        outputBreakdown.push({ matId, matName, qty, unitPrice: null, totalRevenue: null });
      } else {
        const rev = price.currentPrice * qty;
        outputRevenue += rev;
        outputBreakdown.push({ matId, matName, qty, unitPrice: price.currentPrice, totalRevenue: rev });
      }
    }

    // ── Worker overhead per recipe run ───────────────────────────────────────
    const workerCostBreakdown = [];
    let dailyWorkerCostEssential = 0;
    let dailyWorkerCostOptional  = 0;
    let workerPriceMissing = false;

    const workersNeeded = building?.workersNeeded ?? [];

    for (let i = 0; i < workersNeeded.length; i++) {
      const count = workersNeeded[i];
      if (!count) continue;

      const workerType = i + 1;
      const wDef = workerByType.get(workerType);
      if (!wDef) continue;

      // Admin wages: per actual worker per day
      const adminDailyTotal = count * wDef.adminCost;
      dailyWorkerCostEssential += adminDailyTotal;

      const consumableLines = [];

      for (const c of wDef.consumables) {
        // Amount is per 1,000 workers per day → scale to actual count
        const dailyQty = (count / 1000) * c.amount;
        const price = priceMap.get(c.matId);
        const matName = matNameMap.get(c.matId) ?? `Mat #${c.matId}`;

        if (!price || price.currentPrice < 0) {
          if (c.essential) workerPriceMissing = true;
          consumableLines.push({
            matId: c.matId, matName, dailyQty: +dailyQty.toFixed(2),
            unitPrice: null, dailyCost: null, essential: c.essential,
          });
          continue;
        }

        const dailyCost = dailyQty * price.currentPrice;
        if (c.essential) {
          dailyWorkerCostEssential += dailyCost;
        } else {
          dailyWorkerCostOptional += dailyCost;
        }
        consumableLines.push({
          matId: c.matId, matName, dailyQty: +dailyQty.toFixed(2),
          unitPrice: price.currentPrice, dailyCost: Math.round(dailyCost),
          essential: c.essential,
        });
      }

      workerCostBreakdown.push({
        workerType,
        count,
        adminDailyTotal,
        consumables: consumableLines,
      });
    }

    // Attribute worker costs to this recipe run (assume continuous production)
    const timeMinutes = recipe.timeMinutes ?? 60;
    const runFractionOfDay = timeMinutes / 1440;
    const workerCostPerRun = Math.round(dailyWorkerCostEssential * runFractionOfDay);
    const workerOptionalPerRun = Math.round(dailyWorkerCostOptional * runFractionOfDay);

    // ── Totals ───────────────────────────────────────────────────────────────
    const totalCost = inputCost + workerCostPerRun;
    const profit    = outputRevenue - totalCost;
    const profitWithOptional = outputRevenue - totalCost - workerOptionalPerRun;

    const durationHours = timeMinutes / 60;
    const profitPerHour = durationHours > 0 ? Math.round(profit / durationHours) : null;
    const profitPerHourWithOptional = durationHours > 0
      ? Math.round(profitWithOptional / durationHours)
      : null;

    const margin = totalCost > 0
      ? parseFloat(((profit / totalCost) * 100).toFixed(1))
      : null;

    const outputName = outputBreakdown[0]?.matName;
    results.push({
      recipeId:   recipe.id,
      recipeName: outputName
        ? `${outputName}${building ? ` (${building.name})` : ''}`
        : `Recipe #${recipe.id}`,
      buildingId:   building?.id   ?? null,
      buildingName: building?.name ?? null,
      timeMinutes,

      inputs:  inputBreakdown,
      outputs: outputBreakdown,
      workers: workerCostBreakdown,

      inputCost,
      outputRevenue,
      dailyWorkerCostEssential: Math.round(dailyWorkerCostEssential),
      dailyWorkerCostOptional:  Math.round(dailyWorkerCostOptional),
      workerCostPerRun,
      workerOptionalPerRun,
      totalCost,

      profit,
      profitWithOptional,
      profitPerHour,
      profitPerHourWithOptional,
      margin,

      dataMissing: inputsMissing || outputsMissing || workerPriceMissing,
    });
  }

  results.sort((a, b) => (b.profitPerHour ?? -Infinity) - (a.profitPerHour ?? -Infinity));
  return results;
}
