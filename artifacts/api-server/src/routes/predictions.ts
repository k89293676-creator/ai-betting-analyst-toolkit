import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
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
import { sendMessage, getDefaultChatId, formatResultMessage } from "../lib/telegram-api";

const router: IRouter = Router();

const SPORT_CONTEXT: Record<string, string> = {
  soccer_epl: "Premier League — home advantage is modest (~55% retention). Focus on xG, press metrics (PPDA), set-piece threat, and defensive shape. High-tempo games with narrow margins.",
  soccer_bundesliga: "Bundesliga — higher-scoring. Consider attacking transitions, Gegenpressing quality, and away team's travel schedule.",
  soccer_spain_la_liga: "La Liga — tactically nuanced, low-scoring. Possession quality, progressive passes, and striker form.",
  soccer_italy_serie_a: "Serie A — defensive emphasis. Clean sheet probability, counter-attack quality, pressing resistance.",
  soccer_france_ligue1: "Ligue 1 — PSG-dominated but volatile lower table. Consider fixture difficulty and squad depth.",
  soccer: "Football/Soccer — analyse xG last 5 matches, home/away differentials, H2H, injury absences in key positions, and referee tendencies.",
  americanfootball_nfl: "NFL — offensive/defensive DVOA, QB rating under pressure, O-line run-blocking grade, CB shadow coverage, weather (wind > 15mph suppresses scoring), rest days, spread movement.",
  basketball_nba: "NBA — net rating (pace-adjusted), recent rest days, back-to-back, travel distance, three-point rate variance, injury to star players, closing line movement.",
  baseball_mlb: "MLB — starting pitcher ERA/FIP/xFIP, K-BB%, bullpen ERA, park factor, weather (temperature, wind direction), batting handedness vs pitcher.",
  tennis: "Tennis — surface win rate (clay/grass/hard), H2H on surface, serve dominance (ace rate, first serve %), recent fatigue from tournaments, break point conversion.",
  icehockey_nhl: "NHL — 5v5 Corsi% (CF%), save % (SV%), PDO regression risk, power play efficiency, goaltender matchup, back-to-back games.",
  mma: "MMA — striking accuracy, takedown defence %, submission rate, recent KO/TKO vulnerability, camp quality, reach advantage.",
};

function getSportContext(sport: string): string {
  const key = sport.toLowerCase().replace(/\s+/g, "_");
  for (const [k, v] of Object.entries(SPORT_CONTEXT)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return "Consider recent form (last 5–10 games), head-to-head record, home/away performance split, and key player availability.";
}

function calcExpectedValue(trueProbability: number, decimalOdds: number): number {
  return trueProbability * (decimalOdds - 1) - (1 - trueProbability);
}

function calcHalfKelly(trueProbability: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  const q = 1 - trueProbability;
  const fullKelly = (b * trueProbability - q) / b;
  return Math.max(0, Math.min(0.15, fullKelly * 0.5));
}

interface CalibrationState {
  minConfidence: number;
  maxKelly: number;
  brierScore: number | null;
  sportWinRates: Record<string, number>;
  confBias: "over" | "under" | "calibrated";
}

let cachedCalibration: CalibrationState | null = null;
let calibrationExpiry = 0;

async function getCalibration(): Promise<CalibrationState> {
  if (cachedCalibration && Date.now() < calibrationExpiry) {
    return cachedCalibration;
  }

  const all = await db.select().from(predictionsTable);
  const settled = all.filter((p) => p.status === "won" || p.status === "lost");

  if (settled.length < 5) {
    return {
      minConfidence: 0.55,
      maxKelly: 0.10,
      brierScore: null,
      sportWinRates: {},
      confBias: "calibrated",
    };
  }

  const brierScore =
    settled.reduce((sum, p) => {
      const outcome = p.status === "won" ? 1 : 0;
      return sum + (p.confidence - outcome) ** 2;
    }, 0) / settled.length;

  const avgConf = settled.reduce((s, p) => s + p.confidence, 0) / settled.length;
  const winRate = settled.filter((p) => p.status === "won").length / settled.length;
  const confBias: CalibrationState["confBias"] =
    avgConf - winRate > 0.05 ? "over" : winRate - avgConf > 0.05 ? "under" : "calibrated";

  const sportWinRates: Record<string, number> = {};
  const bySport: Record<string, { won: number; total: number }> = {};
  for (const p of settled) {
    if (!bySport[p.sport]) bySport[p.sport] = { won: 0, total: 0 };
    bySport[p.sport].total++;
    if (p.status === "won") bySport[p.sport].won++;
  }
  for (const [s, d] of Object.entries(bySport)) {
    if (d.total >= 3) sportWinRates[s] = d.won / d.total;
  }

  const minConfidence = confBias === "over" ? 0.62 : 0.55;
  const maxKelly = brierScore > 0.25 ? 0.06 : brierScore > 0.20 ? 0.08 : 0.12;

  cachedCalibration = { minConfidence, maxKelly, brierScore, sportWinRates, confBias };
  calibrationExpiry = Date.now() + 5 * 60 * 1000;
  return cachedCalibration;
}

async function getRecentOutcomeSummary(): Promise<string> {
  const won = await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.status, "won"))
    .orderBy(desc(predictionsTable.updatedAt))
    .limit(4);
  const lost = await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.status, "lost"))
    .orderBy(desc(predictionsTable.updatedAt))
    .limit(4);

  if (won.length + lost.length === 0) return "";

  const lines = [
    ...won.map((p) => `✓ WON [conf=${(p.confidence * 100).toFixed(0)}%]: ${p.sport} | ${p.homeTeam} vs ${p.awayTeam} | pred=${p.predictedOutcome} | odds=${p.odds.toFixed(2)}`),
    ...lost.map((p) => `✗ LOST [conf=${(p.confidence * 100).toFixed(0)}%]: ${p.sport} | ${p.homeTeam} vs ${p.awayTeam} | pred=${p.predictedOutcome} | actual=${p.actualOutcome}`),
  ];
  return lines.join("\n");
}

function buildPredictionPrompt(
  sport: string,
  homeTeam: string,
  awayTeam: string,
  matchDate: string,
  homeOdds: number,
  drawOdds: number | null | undefined,
  awayOdds: number,
  recentOutcomes: string,
  calibration: CalibrationState
): string {
  const sportCtx = getSportContext(sport);

  const impliedH = 1 / homeOdds;
  const impliedA = 1 / awayOdds;
  const impliedD = drawOdds != null ? 1 / drawOdds : 0;
  const overround = impliedH + impliedA + impliedD;
  const trueH = (impliedH / overround * 100).toFixed(1);
  const trueA = (impliedA / overround * 100).toFixed(1);
  const trueD = drawOdds != null ? (impliedD / overround * 100).toFixed(1) : null;

  const calibrationNote = calibration.confBias === "over"
    ? "⚠️ Model has been OVERCONFIDENT recently — apply downward pressure on confidence estimates."
    : calibration.confBias === "under"
    ? "⚠️ Model has been UNDERCONFIDENT recently — you may increase confidence estimates slightly."
    : "Model confidence is well-calibrated.";

  const sportNote = calibration.sportWinRates[sport] != null
    ? `Recent ${sport} model win rate: ${(calibration.sportWinRates[sport]! * 100).toFixed(0)}%.`
    : "";

  return `You are a sharp quantitative sports betting analyst. Your predictions are measured by Brier score and tracked for value. Be precise, not verbose.

═══ MATCH ═══
Sport: ${sport}
${homeTeam} (Home) vs ${awayTeam} (Away)
Kickoff: ${matchDate}

═══ MARKET ODDS ═══
Home: ${homeOdds}${drawOdds != null ? `  |  Draw: ${drawOdds}` : ""}  |  Away: ${awayOdds}
Market-implied (vig-free): Home ${trueH}%${trueD != null ? ` | Draw ${trueD}%` : ""} | Away ${trueA}%

═══ ANALYTICAL FRAMEWORK ═══
${sportCtx}

═══ CALIBRATION STATE ═══
${calibrationNote}${sportNote ? `\n${sportNote}` : ""}
Min confidence threshold: ${(calibration.minConfidence * 100).toFixed(0)}%
Max Kelly stake: ${(calibration.maxKelly * 100).toFixed(0)}%
${calibration.brierScore != null ? `Current Brier score: ${calibration.brierScore.toFixed(3)} (lower is better, 0.25 = random)` : ""}

═══ RECENT OUTCOMES (for context) ═══
${recentOutcomes || "No settled predictions yet."}

═══ TASK ═══
1. Estimate TRUE outcome probabilities using your knowledge of these teams and this sport.
2. Compare your estimates to the market — identify where you diverge and WHY (this is where edge lives).
3. Pick the outcome with the most positive Expected Value: EV = p×(odds-1) − (1−p).
4. Apply HALF-Kelly: stake = 0.5 × (b×p − q) / b. Cap at ${(calibration.maxKelly * 100).toFixed(0)}%.
5. Only recommend if your confidence ≥ ${(calibration.minConfidence * 100).toFixed(0)}% AND EV > 0.

Output ONLY valid JSON (no markdown, no text outside the JSON):
{
  "predictedOutcome": "Home Win" | "Draw" | "Away Win",
  "confidence": <float 0.0–1.0, your TRUE probability estimate for this outcome>,
  "odds": <decimal odds for the predicted outcome, copied from market>,
  "expectedValue": <float, EV = confidence×(odds−1)−(1−confidence)>,
  "kellyFraction": <float 0.0–${calibration.maxKelly.toFixed(2)}, half-Kelly stake>,
  "reasoning": "<3–4 sentences: your edge vs market, key factors, main risk>"
}`;
}

async function recomputeDailyMetrics(sport?: string): Promise<void> {
  try {
    cachedCalibration = null;
    const all = await db.select().from(predictionsTable);
    const settled = all.filter((p) => p.status === "won" || p.status === "lost");
    const sportSettled = sport ? settled.filter((p) => p.sport === sport) : settled;
    if (sportSettled.length === 0) return;

    const total = sportSettled.length;
    const correct = sportSettled.filter((p) => p.status === "won").length;
    const accuracy = correct / total;
    const roi = sportSettled.reduce((sum, p) => {
      if (p.status === "won") return sum + (p.odds - 1) * p.kellyFraction;
      return sum - p.kellyFraction;
    }, 0) / total;
    const avgConfidence = sportSettled.reduce((s, p) => s + p.confidence, 0) / total;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await db
      .insert(performanceMetricsTable)
      .values({ date: today, sport: sport ?? null, totalPredictions: total, correctPredictions: correct, accuracy, roi, avgConfidence })
      .onConflictDoNothing();
  } catch (err) {
    logger.warn({ err }, "Failed to recompute daily metrics");
  }
}

async function notifyTelegramResult(prediction: typeof predictionsTable.$inferSelect): Promise<void> {
  const chatId = process.env.TELEGRAM_CHATID;
  if (!chatId) return;
  try {
    const text = formatResultMessage({
      sport: prediction.sport,
      homeTeam: prediction.homeTeam,
      awayTeam: prediction.awayTeam,
      predictedOutcome: prediction.predictedOutcome,
      actualOutcome: prediction.actualOutcome,
      odds: prediction.odds,
      confidence: prediction.confidence,
      kellyFraction: prediction.kellyFraction,
      status: prediction.status,
    });
    await sendMessage(chatId, text);
  } catch {
    logger.warn("Failed to send Telegram result notification");
  }
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

  const [calibration, recentOutcomes] = await Promise.all([
    getCalibration(),
    getRecentOutcomeSummary(),
  ]);

  const prompt = buildPredictionPrompt(
    sport, homeTeam, awayTeam, matchDate.toString(),
    homeOdds, drawOdds, awayOdds,
    recentOutcomes, calibration
  );

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { temperature: 0.25, topP: 0.85, maxOutputTokens: 600 },
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
    expectedValue?: number;
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

  const confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0));
  const kellyFraction = Math.max(0, Math.min(calibration.maxKelly, parsed.kellyFraction ?? 0));
  const expectedValue = parsed.expectedValue ?? calcExpectedValue(confidence, parsed.odds);

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

  req.log.info(
    { id: prediction.id, sport, confidence, ev: expectedValue.toFixed(3), kelly: kellyFraction.toFixed(3) },
    "Prediction created"
  );
  res.status(201).json({ ...prediction, expectedValue });
});

router.get("/predictions/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetPredictionParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [prediction] = await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.id, params.data.id));

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
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeletePredictionParams.safeParse({ id: parseInt(raw, 10) });
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
