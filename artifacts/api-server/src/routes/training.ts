import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, predictionsTable, trainingRecordsTable } from "@workspace/db";
import { ai } from "@workspace/integrations-gemini-ai";

const router: IRouter = Router();

function brierScore(predictions: Array<{ confidence: number; status: string }>): number {
  if (predictions.length === 0) return 0;
  return (
    predictions.reduce((sum, p) => {
      const outcome = p.status === "won" ? 1 : 0;
      return sum + (p.confidence - outcome) ** 2;
    }, 0) / predictions.length
  );
}

function calibrationCurve(predictions: Array<{ confidence: number; status: string }>): string {
  const buckets: Record<string, { won: number; total: number; midpoint: number }> = {
    "50–60%": { won: 0, total: 0, midpoint: 0.55 },
    "60–70%": { won: 0, total: 0, midpoint: 0.65 },
    "70–80%": { won: 0, total: 0, midpoint: 0.75 },
    "80%+":   { won: 0, total: 0, midpoint: 0.85 },
  };
  for (const p of predictions) {
    const key =
      p.confidence < 0.60 ? "50–60%" :
      p.confidence < 0.70 ? "60–70%" :
      p.confidence < 0.80 ? "70–80%" : "80%+";
    buckets[key]!.total++;
    if (p.status === "won") buckets[key]!.won++;
  }
  return Object.entries(buckets)
    .filter(([, d]) => d.total > 0)
    .map(([label, d]) => {
      const actual = d.won / d.total;
      const expected = d.midpoint;
      const bias = actual > expected + 0.05 ? "↑under" : actual < expected - 0.05 ? "↑over" : "✓ok";
      return `  ${label}: ${d.won}/${d.total} actual=${(actual * 100).toFixed(0)}% expected≈${(expected * 100).toFixed(0)}% ${bias}`;
    })
    .join("\n");
}

function evAccuracy(predictions: Array<{ confidence: number; odds: number; status: string }>): { positiveEvWin: number; positiveEvTotal: number; negativeEvWin: number; negativeEvTotal: number } {
  const result = { positiveEvWin: 0, positiveEvTotal: 0, negativeEvWin: 0, negativeEvTotal: 0 };
  for (const p of predictions) {
    const ev = p.confidence * (p.odds - 1) - (1 - p.confidence);
    if (ev > 0) {
      result.positiveEvTotal++;
      if (p.status === "won") result.positiveEvWin++;
    } else {
      result.negativeEvTotal++;
      if (p.status === "won") result.negativeEvWin++;
    }
  }
  return result;
}

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
    const recent = [...resolved]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 40);

    const bs = brierScore(recent);
    const calCurve = calibrationCurve(recent);
    const evStats = evAccuracy(recent);

    const sportMap: Record<string, { won: number; total: number; avgConf: number; avgOdds: number }> = {};
    for (const p of recent) {
      if (!sportMap[p.sport]) sportMap[p.sport] = { won: 0, total: 0, avgConf: 0, avgOdds: 0 };
      sportMap[p.sport]!.total++;
      sportMap[p.sport]!.avgConf += p.confidence;
      sportMap[p.sport]!.avgOdds += p.odds;
      if (p.status === "won") sportMap[p.sport]!.won++;
    }
    for (const s of Object.values(sportMap)) {
      s.avgConf = s.avgConf / s.total;
      s.avgOdds = s.avgOdds / s.total;
    }

    const outcomeBreakdown: Record<string, { won: number; total: number }> = {};
    for (const p of recent) {
      if (!outcomeBreakdown[p.predictedOutcome]) outcomeBreakdown[p.predictedOutcome] = { won: 0, total: 0 };
      outcomeBreakdown[p.predictedOutcome]!.total++;
      if (p.status === "won") outcomeBreakdown[p.predictedOutcome]!.won++;
    }

    const prompt = `You are a quantitative betting model calibrator. Evaluate this model's performance rigorously.

═══ OVERALL ═══
Resolved: ${samplesProcessed} | Won: ${won} | Raw accuracy: ${accuracyBefore != null ? (accuracyBefore * 100).toFixed(1) : "N/A"}%
Brier Score: ${bs.toFixed(4)} (0.00=perfect, 0.25=random, 1.00=inverted)

═══ CALIBRATION CURVE ═══
${calCurve || "  Not enough data per bucket."}

═══ EV TRACKING ═══
Positive-EV bets: ${evStats.positiveEvWin}/${evStats.positiveEvTotal} won${evStats.positiveEvTotal > 0 ? ` (${((evStats.positiveEvWin / evStats.positiveEvTotal) * 100).toFixed(0)}%)` : ""}
Negative-EV bets: ${evStats.negativeEvWin}/${evStats.negativeEvTotal} won${evStats.negativeEvTotal > 0 ? ` (${((evStats.negativeEvWin / evStats.negativeEvTotal) * 100).toFixed(0)}%)` : ""}

═══ BY SPORT ═══
${Object.entries(sportMap)
  .map(([s, d]) => `${s}: ${d.won}/${d.total} (${((d.won / d.total) * 100).toFixed(0)}%) | avg_conf=${(d.avgConf * 100).toFixed(0)}% | avg_odds=${d.avgOdds.toFixed(2)}`)
  .join("\n")}

═══ BY OUTCOME TYPE ═══
${Object.entries(outcomeBreakdown)
  .map(([o, d]) => `${o}: ${d.won}/${d.total} (${((d.won / d.total) * 100).toFixed(0)}%)`)
  .join("\n")}

═══ RECENT 20 (newest first) ═══
${recent.slice(0, 20).map((p) => {
  const ev = (p.confidence * (p.odds - 1) - (1 - p.confidence)).toFixed(3);
  return `[${p.status.toUpperCase()}] ${p.sport} | ${p.homeTeam} vs ${p.awayTeam} | pred=${p.predictedOutcome} | actual=${p.actualOutcome ?? "?"} | conf=${(p.confidence * 100).toFixed(0)}% | odds=${p.odds.toFixed(2)} | EV=${ev}`;
}).join("\n")}

═══ TASK ═══
Provide calibration guidance. Respond ONLY with valid JSON:
{
  "adjustedAccuracy": <float 0.0–1.0, calibrated true accuracy estimate>,
  "brierInterpretation": "<1 sentence on Brier score quality>",
  "keyFindings": "<2–3 sentences: biggest patterns, systematic errors, where edge exists or is lost>",
  "calibrationAction": "<1–2 sentences: specific fix — e.g. 'reduce confidence by 8% on away dogs', 'avoid low-odds favourites'>",
  "recommendedMinConfidence": <float 0.50–0.75>,
  "recommendedMaxKelly": <float 0.03–0.15>,
  "sportsToFocus": ["<sport1>", "<sport2>"],
  "sportsToAvoid": ["<sport3>"]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.15, maxOutputTokens: 700 },
    });

    const rawText = (response.text ?? "").trim();
    const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as {
          adjustedAccuracy?: number;
          brierInterpretation?: string;
          keyFindings?: string;
          calibrationAction?: string;
          recommendedMinConfidence?: number;
          recommendedMaxKelly?: number;
          sportsToFocus?: string[];
          sportsToAvoid?: string[];
        };
        accuracyAfter = parsed.adjustedAccuracy ?? null;

        const parts: string[] = [];
        if (parsed.brierInterpretation) parts.push(`Brier: ${parsed.brierInterpretation}`);
        if (parsed.keyFindings) parts.push(parsed.keyFindings);
        if (parsed.calibrationAction) parts.push(`Action: ${parsed.calibrationAction}`);
        if (parsed.recommendedMinConfidence != null)
          parts.push(`Min confidence: ${(parsed.recommendedMinConfidence * 100).toFixed(0)}%`);
        if (parsed.recommendedMaxKelly != null)
          parts.push(`Max Kelly: ${(parsed.recommendedMaxKelly * 100).toFixed(1)}%`);
        if (parsed.sportsToFocus?.length)
          parts.push(`Focus: ${parsed.sportsToFocus.join(", ")}`);
        if (parsed.sportsToAvoid?.length)
          parts.push(`Avoid: ${parsed.sportsToAvoid.join(", ")}`);

        notes = parts.join(" | ");
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

  req.log.info({ recordId: record.id, samplesProcessed, accuracyBefore, accuracyAfter }, "Training completed");

  res.json({
    success: true,
    message: `Training completed. ${samplesProcessed} samples. Calibrated accuracy: ${accuracyAfter != null ? (accuracyAfter * 100).toFixed(1) + "%" : "N/A"}.`,
    samplesProcessed,
  });
});

export default router;
