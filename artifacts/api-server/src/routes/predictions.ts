import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, predictionsTable, performanceMetricsTable } from "@workspace/db";
import { ai } from "@workspace/integrations-gemini-ai";
import {
  ListPredictionsQueryParams,
  CreatePredictionBody,
  GetPredictionParams,
  DeletePredictionParams,
  UpdatePredictionResultParams,
  UpdatePredictionResultBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SPORT_CONTEXT: Record<string, string> = {
  soccer: "Focus on form over last 5 matches, home/away record, goal difference, key injuries, and head-to-head. Consider expected goals (xG) trends.",
  football: "Focus on offensive/defensive DVOA, quarterback rating, injury report, weather conditions, spread movement, and home field advantage.",
  basketball: "Analyse pace-adjusted net rating, rest advantage, travel fatigue, back-to-back games, and three-point shooting variance.",
  baseball: "Starting pitcher ERA, FIP, WHIP, bullpen depth, park factor, weather, and recent offensive slump/streak.",
  tennis: "Surface win rate, recent form, head-to-head on surface, serve statistics, physical fatigue from recent tournaments.",
  hockey: "Save percentage, PDO, Corsi/Fenwick ratings, power play efficiency, goaltender matchup.",
};

function buildPredictionPrompt(
  sport: string,
  homeTeam: string,
  awayTeam: string,
  matchDate: string,
  homeOdds: number,
  drawOdds: number | null | undefined,
  awayOdds: number,
  recentOutcomes: string
): string {
  const sportKey = sport.toLowerCase().replace(/[^a-z]/g, "");
  const sportCtx =
    SPORT_CONTEXT[sportKey] ??
    "Consider recent form, head-to-head record, home advantage, and key player availability.";

  const impliedHomeProb = 1 / homeOdds;
  const impliedAwayProb = 1 / awayOdds;
  const impliedDrawProb = drawOdds != null ? 1 / drawOdds : 0;
  const overround = impliedHomeProb + impliedAwayProb + impliedDrawProb;
  const trueHomeProb = impliedHomeProb / overround;
  const trueAwayProb = impliedAwayProb / overround;
  const trueDrawProb = drawOdds != null ? impliedDrawProb / overround : 0;

  return `You are a professional quantitative sports betting analyst trained on thousands of historical match outcomes.

MATCH DETAILS
Sport: ${sport}
Match: ${homeTeam} (Home) vs ${awayTeam} (Away)
Date: ${matchDate}
Decimal Odds — Home: ${homeOdds}${drawOdds != null ? ` | Draw: ${drawOdds}` : ""} | Away: ${awayOdds}

MARKET-IMPLIED TRUE PROBABILITIES (margin-adjusted)
Home Win: ${(trueHomeProb * 100).toFixed(1)}%${trueDrawProb > 0 ? ` | Draw: ${(trueDrawProb * 100).toFixed(1)}%` : ""} | Away Win: ${(trueAwayProb * 100).toFixed(1)}%

ANALYSIS FRAMEWORK
${sportCtx}

${recentOutcomes ? `RECENT MODEL CALIBRATION NOTES\n${recentOutcomes}\n` : ""}
TASK
1. Estimate the TRUE probability of each outcome based on your knowledge.
2. Identify value: a bet has value when your true probability > implied probability.
3. Apply fractional Kelly criterion: f = (bp - q) / b where b = decimal_odds - 1, p = your true prob, q = 1 - p. Cap at 20%.
4. Only recommend a bet when confidence > 55% AND Kelly fraction > 2%.

Respond ONLY with a valid JSON object (no markdown fences, no commentary):
{
  "predictedOutcome": "Home Win" | "Draw" | "Away Win",
  "confidence": <your true probability for the predicted outcome, float 0.0–1.0>,
  "odds": <decimal odds for the predicted outcome>,
  "kellyFraction": <recommended Kelly stake as fraction of bankroll, float 0.0–0.20>,
  "reasoning": "<3–4 sentences: key factors driving prediction, where value lies vs implied odds, key risks>"
}`;
}

async function getCalibrationNotes(): Promise<string> {
  const recent = await db
    .select()
    .from(predictionsTable)
    .where(
      and(
        eq(predictionsTable.status, "won")
      )
    )
    .limit(5);
  const lost = await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.status, "lost"))
    .limit(5);

  if (recent.length + lost.length === 0) return "";

  const lines: string[] = [];
  for (const p of recent) {
    lines.push(`✓ WON: ${p.sport} ${p.homeTeam} vs ${p.awayTeam} — predicted ${p.predictedOutcome} @ ${p.confidence.toFixed(2)} confidence`);
  }
  for (const p of lost) {
    lines.push(`✗ LOST: ${p.sport} ${p.homeTeam} vs ${p.awayTeam} — predicted ${p.predictedOutcome} @ ${p.confidence.toFixed(2)} confidence, actual: ${p.actualOutcome}`);
  }
  return lines.join("\n");
}

async function recomputeDailyMetrics(sport?: string): Promise<void> {
  try {
    const allSettled = await db
      .select()
      .from(predictionsTable);

    const settled = allSettled.filter(
      (p) => p.status === "won" || p.status === "lost"
    );

    if (settled.length === 0) return;

    const sportSettled = sport
      ? settled.filter((p) => p.sport === sport)
      : settled;

    const total = sportSettled.length;
    const correct = sportSettled.filter((p) => p.status === "won").length;
    const accuracy = total > 0 ? correct / total : 0;
    const roi =
      total > 0
        ? sportSettled.reduce((sum, p) => {
            if (p.status === "won") return sum + (p.odds - 1) * p.kellyFraction;
            return sum - p.kellyFraction;
          }, 0) / total
        : 0;
    const avgConfidence =
      total > 0
        ? sportSettled.reduce((sum, p) => sum + p.confidence, 0) / total
        : 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await db
      .insert(performanceMetricsTable)
      .values({
        date: today,
        sport: sport ?? null,
        totalPredictions: total,
        correctPredictions: correct,
        accuracy,
        roi,
        avgConfidence,
      })
      .onConflictDoNothing();
  } catch (err) {
    logger.warn({ err }, "Failed to recompute daily metrics");
  }
}

async function notifyTelegramResult(prediction: typeof predictionsTable.$inferSelect): Promise<void> {
  const token = process.env.TELEGRAM_BOTTOKEN;
  const chatId = process.env.TELEGRAM_CHATID;
  if (!token || !chatId) return;

  const statusEmoji = prediction.status === "won" ? "✅ WON" : prediction.status === "lost" ? "❌ LOST" : "⚪ VOID";
  const text = `<b>RESULT UPDATE — ${statusEmoji}</b>

<b>${prediction.sport.toUpperCase()}</b>: ${prediction.homeTeam} vs ${prediction.awayTeam}
Predicted: ${prediction.predictedOutcome} @ ${prediction.odds.toFixed(2)}
Actual: ${prediction.actualOutcome ?? "—"}
Confidence was: ${Math.round(prediction.confidence * 100)}%
Kelly used: ${(prediction.kellyFraction * 100).toFixed(1)}%`;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).catch(() => undefined);
}

router.get("/predictions", async (req, res): Promise<void> => {
  const query = ListPredictionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const all = await db
    .select()
    .from(predictionsTable)
    .orderBy(desc(predictionsTable.createdAt))
    .limit(query.data.limit ?? 100);

  const filtered = all.filter((p) => {
    if (query.data.status && p.status !== query.data.status) return false;
    if (query.data.sport && p.sport !== query.data.sport) return false;
    return true;
  });

  res.json(filtered);
});

router.post("/predictions", async (req, res): Promise<void> => {
  const body = CreatePredictionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { sport, homeTeam, awayTeam, matchDate, homeOdds, drawOdds, awayOdds } = body.data;

  const calibration = await getCalibrationNotes();
  const prompt = buildPredictionPrompt(
    sport, homeTeam, awayTeam, matchDate.toString(),
    homeOdds, drawOdds, awayOdds, calibration
  );

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0.3,
      topP: 0.9,
      maxOutputTokens: 512,
    },
  });

  const rawText = (response.text ?? "").trim();
  const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    req.log.error({ rawText }, "Gemini returned unparseable prediction");
    res.status(500).json({ error: "AI returned an unparseable response" });
    return;
  }

  let parsed: {
    predictedOutcome: string;
    confidence: number;
    odds: number;
    kellyFraction: number;
    reasoning: string;
  };

  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    req.log.error({ rawText }, "Failed to parse prediction JSON");
    res.status(500).json({ error: "Failed to parse AI response" });
    return;
  }

  const kellyFraction = Math.max(0, Math.min(0.20, parsed.kellyFraction ?? 0));
  const confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0));

  const [prediction] = await db
    .insert(predictionsTable)
    .values({
      sport,
      homeTeam,
      awayTeam,
      matchDate: new Date(matchDate),
      predictedOutcome: parsed.predictedOutcome,
      confidence,
      odds: parsed.odds,
      kellyFraction,
      reasoning: parsed.reasoning,
      status: "pending",
    })
    .returning();

  req.log.info({ id: prediction.id, sport, confidence }, "Prediction created");
  res.status(201).json(prediction);
});

router.get("/predictions/:id", async (req, res): Promise<void> => {
  const params = GetPredictionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [prediction] = await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.id, parseInt(rawId, 10)));

  if (!prediction) {
    res.status(404).json({ error: "Prediction not found" });
    return;
  }

  res.json(prediction);
});

router.patch("/predictions/:id/result", async (req, res): Promise<void> => {
  const params = UpdatePredictionResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdatePredictionResultBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [prediction] = await db
    .update(predictionsTable)
    .set({ actualOutcome: body.data.actualOutcome, status: body.data.status })
    .where(eq(predictionsTable.id, params.data.id))
    .returning();

  if (!prediction) {
    res.status(404).json({ error: "Prediction not found" });
    return;
  }

  Promise.all([
    recomputeDailyMetrics(),
    recomputeDailyMetrics(prediction.sport),
    notifyTelegramResult(prediction),
  ]).catch((err) => logger.warn({ err }, "Post-result hooks failed"));

  res.json(prediction);
});

router.delete("/predictions/:id", async (req, res): Promise<void> => {
  const params = DeletePredictionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [prediction] = await db
    .delete(predictionsTable)
    .where(eq(predictionsTable.id, params.data.id))
    .returning();

  if (!prediction) {
    res.status(404).json({ error: "Prediction not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
