import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, predictionsTable } from "@workspace/db";
import { SendTelegramPredictionBody } from "@workspace/api-zod";

const router: IRouter = Router();

async function sendTelegramMessage(text: string): Promise<{ ok: boolean; result?: { message_id: number } }> {
  const token = process.env.TELEGRAM_BOTTOKEN;
  const chatId = process.env.TELEGRAM_CHATID;

  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOTTOKEN or TELEGRAM_CHATID not configured");
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });

  return response.json() as Promise<{ ok: boolean; result?: { message_id: number } }>;
}

router.post("/telegram/test", async (req, res): Promise<void> => {
  const result = await sendTelegramMessage(
    "<b>AI Betting Analyst</b>\n\nTest message from your betting dashboard. All systems operational."
  );

  res.json({
    success: result.ok,
    messageId: result.result?.message_id ?? null,
  });
});

router.post("/telegram/send", async (req, res): Promise<void> => {
  const body = SendTelegramPredictionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [prediction] = await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.id, body.data.predictionId));

  if (!prediction) {
    res.status(404).json({ error: "Prediction not found" });
    return;
  }

  const matchDate = new Date(prediction.matchDate).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const confidencePct = Math.round(prediction.confidence * 100);
  const kellyPct = (prediction.kellyFraction * 100).toFixed(1);

  const text = `<b>AI BETTING SIGNAL</b>

<b>${prediction.sport.toUpperCase()}</b>
${prediction.homeTeam} vs ${prediction.awayTeam}
${matchDate}

<b>Prediction:</b> ${prediction.predictedOutcome}
<b>Confidence:</b> ${confidencePct}%
<b>Odds:</b> ${prediction.odds.toFixed(2)}
<b>Kelly Fraction:</b> ${kellyPct}% of bankroll

<b>Reasoning:</b>
${prediction.reasoning}`;

  const result = await sendTelegramMessage(text);

  if (result.ok) {
    await db
      .update(predictionsTable)
      .set({ sentToTelegram: true })
      .where(eq(predictionsTable.id, prediction.id));
  }

  res.json({
    success: result.ok,
    messageId: result.result?.message_id ?? null,
  });
});

export default router;
