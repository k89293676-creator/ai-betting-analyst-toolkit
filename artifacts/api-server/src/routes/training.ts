import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, predictionsTable, trainingRecordsTable } from "@workspace/db";
import { ai } from "@workspace/integrations-gemini-ai";

const router: IRouter = Router();

router.get("/training/history", async (req, res): Promise<void> => {
  const records = await db
    .select()
    .from(trainingRecordsTable)
    .orderBy(desc(trainingRecordsTable.triggeredAt));

  res.json(records);
});

router.post("/training/trigger", async (req, res): Promise<void> => {
  const all = await db.select().from(predictionsTable);
  const resolved = all.filter((p) => p.status === "won" || p.status === "lost");

  const samplesProcessed = resolved.length;
  const won = resolved.filter((p) => p.status === "won").length;
  const accuracyBefore = samplesProcessed > 0 ? won / samplesProcessed : null;

  let accuracyAfter: number | null = null;
  let notes = "Insufficient data for calibration (need ≥ 5 resolved predictions).";

  if (resolved.length >= 5) {
    const recentSamples = [...resolved]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 30);

    const sportBreakdown: Record<string, { won: number; total: number; avgConf: number }> = {};
    for (const p of recentSamples) {
      if (!sportBreakdown[p.sport]) sportBreakdown[p.sport] = { won: 0, total: 0, avgConf: 0 };
      sportBreakdown[p.sport].total++;
      sportBreakdown[p.sport].avgConf += p.confidence;
      if (p.status === "won") sportBreakdown[p.sport].won++;
    }
    for (const s of Object.values(sportBreakdown)) {
      s.avgConf = s.avgConf / s.total;
    }

    const confBuckets = { high: { won: 0, total: 0 }, mid: { won: 0, total: 0 }, low: { won: 0, total: 0 } };
    for (const p of recentSamples) {
      const bucket = p.confidence >= 0.7 ? "high" : p.confidence >= 0.55 ? "mid" : "low";
      confBuckets[bucket].total++;
      if (p.status === "won") confBuckets[bucket].won++;
    }

    const prompt = `You are a quantitative sports betting model calibrator. Analyse these recent prediction outcomes and provide calibration insights.

OVERALL PERFORMANCE
Total resolved: ${samplesProcessed}
Won: ${won} (${accuracyBefore != null ? (accuracyBefore * 100).toFixed(1) : "N/A"}% accuracy)

SPORT BREAKDOWN (recent 30)
${Object.entries(sportBreakdown)
  .map(([s, d]) => `${s}: ${d.won}/${d.total} (${((d.won / d.total) * 100).toFixed(1)}%) avg_conf=${(d.avgConf * 100).toFixed(1)}%`)
  .join("\n")}

CONFIDENCE CALIBRATION
High (≥70%): ${confBuckets.high.won}/${confBuckets.high.total} won
Mid (55–70%): ${confBuckets.mid.won}/${confBuckets.mid.total} won
Low (<55%):  ${confBuckets.low.won}/${confBuckets.low.total} won

RECENT OUTCOMES (last 20, newest first)
${recentSamples.slice(0, 20).map((p) =>
  `[${p.status.toUpperCase()}] ${p.sport} | ${p.homeTeam} vs ${p.awayTeam} | pred=${p.predictedOutcome} | actual=${p.actualOutcome ?? "?"} | conf=${(p.confidence * 100).toFixed(0)}% | odds=${p.odds.toFixed(2)}`
).join("\n")}

Based on this data, provide calibration insights and an adjusted accuracy estimate. Respond ONLY with valid JSON:
{
  "adjustedAccuracy": <float 0.0–1.0, your calibrated estimate of true model accuracy>,
  "keyInsights": "<2-3 sentences on patterns in wins/losses, calibration issues>",
  "calibrationNotes": "<specific adjustments — e.g. overconfident on aways, underperforms on low-odds favourites>",
  "recommendedMinConfidence": <float 0.50–0.75, suggested minimum confidence threshold>,
  "recommendedMaxKelly": <float 0.05–0.20, suggested max Kelly fraction given variance>
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.2, maxOutputTokens: 512 },
    });

    const rawText = (response.text ?? "").trim();
    const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as {
          adjustedAccuracy?: number;
          keyInsights?: string;
          calibrationNotes?: string;
          recommendedMinConfidence?: number;
          recommendedMaxKelly?: number;
        };
        accuracyAfter = parsed.adjustedAccuracy ?? null;
        const parts = [parsed.keyInsights, parsed.calibrationNotes];
        if (parsed.recommendedMinConfidence != null) {
          parts.push(`Recommended min confidence: ${(parsed.recommendedMinConfidence * 100).toFixed(0)}%`);
        }
        if (parsed.recommendedMaxKelly != null) {
          parts.push(`Recommended max Kelly: ${(parsed.recommendedMaxKelly * 100).toFixed(1)}%`);
        }
        notes = parts.filter(Boolean).join(" | ");
      } catch {
        req.log.warn("Failed to parse training calibration JSON");
      }
    }
  }

  const [record] = await db
    .insert(trainingRecordsTable)
    .values({
      triggeredAt: new Date(),
      samplesProcessed,
      accuracyBefore,
      accuracyAfter,
      status: "completed",
      notes,
    })
    .returning();

  req.log.info({ recordId: record.id, samplesProcessed, accuracyBefore, accuracyAfter }, "Training triggered");

  res.json({
    success: true,
    message: `Training completed. Processed ${samplesProcessed} resolved predictions. Calibrated accuracy: ${accuracyAfter != null ? (accuracyAfter * 100).toFixed(1) + "%" : "N/A"}`,
    samplesProcessed,
  });
});

export default router;
