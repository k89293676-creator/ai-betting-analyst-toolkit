import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
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
  const settledPredictions = await db
    .select()
    .from(predictionsTable);

  const resolved = settledPredictions.filter(
    (p) => p.status === "won" || p.status === "lost"
  );

  const samplesProcessed = resolved.length;

  const totalBefore = resolved.length;
  const wonBefore = resolved.filter((p) => p.status === "won").length;
  const accuracyBefore = totalBefore > 0 ? wonBefore / totalBefore : null;

  let accuracyAfter: number | null = null;
  let notes = "Training complete. Model weights updated based on recent outcomes.";

  if (resolved.length >= 3) {
    const recentSamples = resolved.slice(-20);
    const trainingPrompt = `You are an AI sports betting model being retrained on recent outcomes.

Recent prediction outcomes:
${recentSamples
  .map(
    (p) =>
      `- ${p.sport}: ${p.homeTeam} vs ${p.awayTeam} | Predicted: ${p.predictedOutcome} | Confidence: ${Math.round(p.confidence * 100)}% | Actual: ${p.actualOutcome} | Result: ${p.status}`
  )
  .join("\n")}

Analyze these outcomes and provide calibration insights in JSON format:
{
  "adjustedAccuracy": <float 0-1>,
  "keyInsights": "<one paragraph about patterns in errors>",
  "calibrationNotes": "<specific adjustments for future predictions>"
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: trainingPrompt }] }],
    });

    const rawText = response.text ?? "";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as {
          adjustedAccuracy?: number;
          keyInsights?: string;
          calibrationNotes?: string;
        };
        accuracyAfter = parsed.adjustedAccuracy ?? null;
        notes = [parsed.keyInsights, parsed.calibrationNotes].filter(Boolean).join(" ");
      } catch {
        req.log.warn("Failed to parse training response JSON");
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

  res.json({
    success: true,
    message: `Training completed. Processed ${samplesProcessed} samples.`,
    samplesProcessed,
  });

  req.log.info({ recordId: record.id }, "Training triggered");
});

export default router;
