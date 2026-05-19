import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, predictionsTable } from "@workspace/db";
import { ai } from "@workspace/integrations-gemini-ai";
import {
  ListPredictionsQueryParams,
  CreatePredictionBody,
  GetPredictionParams,
  DeletePredictionParams,
  UpdatePredictionResultParams,
  UpdatePredictionResultBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/predictions", async (req, res): Promise<void> => {
  const query = ListPredictionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let dbQuery = db.select().from(predictionsTable);
  const conditions = [];

  if (query.data.status) {
    conditions.push(eq(predictionsTable.status, query.data.status));
  }
  if (query.data.sport) {
    conditions.push(eq(predictionsTable.sport, query.data.sport));
  }

  const results = await dbQuery.orderBy(desc(predictionsTable.createdAt)).limit(query.data.limit ?? 100);
  const filtered = results.filter((p) => {
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

  const prompt = `You are an expert sports betting analyst. Analyze this match and provide a prediction.

Sport: ${sport}
Match: ${homeTeam} vs ${awayTeam}
Date: ${matchDate}
Odds: Home ${homeOdds}${drawOdds != null ? `, Draw ${drawOdds}` : ""}, Away ${awayOdds}

Respond ONLY with a JSON object in this exact format (no markdown, no explanation):
{
  "predictedOutcome": "Home Win" | "Draw" | "Away Win",
  "confidence": <number between 0 and 1>,
  "odds": <the odds for the predicted outcome as a decimal>,
  "kellyFraction": <recommended kelly criterion fraction, 0 to 0.25>,
  "reasoning": "<concise 2-3 sentence analysis explaining your prediction>"
}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const rawText = response.text ?? "";
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    req.log.error({ rawText }, "Gemini returned unparseable response");
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
    req.log.error({ rawText }, "Failed to parse Gemini JSON");
    res.status(500).json({ error: "Failed to parse AI response" });
    return;
  }

  const [prediction] = await db
    .insert(predictionsTable)
    .values({
      sport,
      homeTeam,
      awayTeam,
      matchDate: new Date(matchDate),
      predictedOutcome: parsed.predictedOutcome,
      confidence: parsed.confidence,
      odds: parsed.odds,
      kellyFraction: parsed.kellyFraction,
      reasoning: parsed.reasoning,
      status: "pending",
    })
    .returning();

  res.status(201).json(prediction);
});

router.get("/predictions/:id", async (req, res): Promise<void> => {
  const params = GetPredictionParams.safeParse(req.params);
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
    .set({
      actualOutcome: body.data.actualOutcome,
      status: body.data.status,
    })
    .where(eq(predictionsTable.id, params.data.id))
    .returning();

  if (!prediction) {
    res.status(404).json({ error: "Prediction not found" });
    return;
  }

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
