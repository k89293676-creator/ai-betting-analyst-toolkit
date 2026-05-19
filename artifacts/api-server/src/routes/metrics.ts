import { Router, type IRouter } from "express";
import { desc, gte } from "drizzle-orm";
import { db, predictionsTable, performanceMetricsTable } from "@workspace/db";
import { GetPerformanceMetricsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/metrics/performance", async (req, res): Promise<void> => {
  const query = GetPerformanceMetricsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const days = query.data.days ?? 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const stored = await db
    .select()
    .from(performanceMetricsTable)
    .where(gte(performanceMetricsTable.date, since))
    .orderBy(desc(performanceMetricsTable.date));

  if (stored.length > 0) {
    res.json(stored);
    return;
  }

  const allPredictions = await db.select().from(predictionsTable);
  const settled = allPredictions.filter(
    (p) => p.status === "won" || p.status === "lost"
  );

  if (settled.length === 0) {
    res.json([]);
    return;
  }

  const totalPredictions = settled.length;
  const correctPredictions = settled.filter((p) => p.status === "won").length;
  const accuracy = totalPredictions > 0 ? correctPredictions / totalPredictions : 0;
  const roi =
    totalPredictions > 0
      ? settled.reduce((sum, p) => {
          if (p.status === "won") return sum + (p.odds - 1) * p.kellyFraction;
          return sum - p.kellyFraction;
        }, 0) / totalPredictions
      : 0;
  const avgConfidence =
    totalPredictions > 0
      ? settled.reduce((sum, p) => sum + p.confidence, 0) / totalPredictions
      : 0;

  res.json([
    {
      id: 0,
      date: new Date().toISOString(),
      sport: null,
      totalPredictions,
      correctPredictions,
      accuracy,
      roi,
      avgConfidence,
      createdAt: new Date().toISOString(),
    },
  ]);
});

router.get("/metrics/summary", async (req, res): Promise<void> => {
  const allPredictions = await db.select().from(predictionsTable);

  const total = allPredictions.length;
  const pending = allPredictions.filter((p) => p.status === "pending").length;
  const won = allPredictions.filter((p) => p.status === "won").length;
  const lost = allPredictions.filter((p) => p.status === "lost").length;
  const settled = won + lost;

  const overallAccuracy = settled > 0 ? won / settled : 0;
  const avgConfidence = total > 0 ? allPredictions.reduce((s, p) => s + p.confidence, 0) / total : 0;

  const settledPredictions = allPredictions.filter((p) => p.status === "won" || p.status === "lost");
  const overallRoi =
    settledPredictions.length > 0
      ? settledPredictions.reduce((sum, p) => {
          if (p.status === "won") return sum + (p.odds - 1) * p.kellyFraction;
          return sum - p.kellyFraction;
        }, 0) / settledPredictions.length
      : 0;

  const sportMap: Record<string, { won: number; settled: number }> = {};
  for (const p of settledPredictions) {
    if (!sportMap[p.sport]) sportMap[p.sport] = { won: 0, settled: 0 };
    sportMap[p.sport].settled++;
    if (p.status === "won") sportMap[p.sport].won++;
  }

  let bestSport: string | null = null;
  let bestAcc = -1;
  for (const [sport, stats] of Object.entries(sportMap)) {
    if (stats.settled < 3) continue;
    const acc = stats.won / stats.settled;
    if (acc > bestAcc) { bestAcc = acc; bestSport = sport; }
  }

  let currentStreak = 0;
  const ordered = [...settledPredictions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  if (ordered.length > 0) {
    const streakStatus = ordered[0].status;
    for (const p of ordered) {
      if (p.status === streakStatus) currentStreak++;
      else break;
    }
    if (streakStatus === "lost") currentStreak = -currentStreak;
  }

  res.json({
    totalPredictions: total,
    pendingPredictions: pending,
    wonPredictions: won,
    lostPredictions: lost,
    overallAccuracy,
    overallRoi,
    avgConfidence,
    bestSport,
    currentStreak,
  });
});

export default router;
