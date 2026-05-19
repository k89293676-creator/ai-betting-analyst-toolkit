import { Router, type IRouter } from "express";
import { desc, eq, and, gte, sql } from "drizzle-orm";
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

  const metrics = await db
    .select()
    .from(performanceMetricsTable)
    .where(gte(performanceMetricsTable.date, since))
    .orderBy(desc(performanceMetricsTable.date));

  res.json(metrics);
});

router.get("/metrics/summary", async (req, res): Promise<void> => {
  const allPredictions = await db.select().from(predictionsTable);

  const total = allPredictions.length;
  const pending = allPredictions.filter((p) => p.status === "pending").length;
  const won = allPredictions.filter((p) => p.status === "won").length;
  const lost = allPredictions.filter((p) => p.status === "lost").length;
  const settled = won + lost;

  const overallAccuracy = settled > 0 ? won / settled : 0;

  const avgConfidence =
    total > 0
      ? allPredictions.reduce((sum, p) => sum + p.confidence, 0) / total
      : 0;

  const settledPredictions = allPredictions.filter(
    (p) => p.status === "won" || p.status === "lost"
  );

  const overallRoi =
    settledPredictions.length > 0
      ? settledPredictions.reduce((sum, p) => {
          if (p.status === "won") return sum + (p.odds - 1) * p.kellyFraction;
          return sum - p.kellyFraction;
        }, 0) / settledPredictions.length
      : 0;

  const sportMap: Record<string, { won: number; settled: number }> = {};
  for (const p of allPredictions) {
    if (p.status === "won" || p.status === "lost") {
      if (!sportMap[p.sport]) sportMap[p.sport] = { won: 0, settled: 0 };
      sportMap[p.sport].settled++;
      if (p.status === "won") sportMap[p.sport].won++;
    }
  }

  let bestSport: string | null = null;
  let bestAccuracy = -1;
  for (const [sport, stats] of Object.entries(sportMap)) {
    const acc = stats.settled > 0 ? stats.won / stats.settled : 0;
    if (acc > bestAccuracy && stats.settled >= 3) {
      bestAccuracy = acc;
      bestSport = sport;
    }
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
