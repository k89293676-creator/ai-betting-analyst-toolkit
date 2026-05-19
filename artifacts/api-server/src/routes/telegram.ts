import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, predictionsTable } from "@workspace/db";
import { SendTelegramPredictionBody } from "@workspace/api-zod";
import { ai } from "@workspace/integrations-gemini-ai";
import {
  sendMessage,
  answerCallbackQuery,
  editMessageText,
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
  getDefaultChatId,
  formatSignalMessage,
  confidenceBar,
} from "../lib/telegram-api";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const HELP_TEXT = `<b>QUANT_AI Betting Analyst</b>

Available commands:

/stats — Overall performance summary
/pending — Open positions (pending predictions)
/today — Today's signals
/recent — Last 10 settled results
/ask [question] — Ask the AI analyst anything
/signal [id] — Resend a specific prediction signal
/help — Show this menu

Results are marked automatically from the dashboard, or reply to any signal with <code>won</code>, <code>lost</code>, or <code>void</code>.`;

async function handleStart(chatId: number | string): Promise<void> {
  await sendMessage(chatId, `<b>QUANT_AI — AI Betting Analyst</b>

Precision sports betting intelligence powered by Gemini AI.

I track predictions, compute Expected Value, apply Kelly criterion, and learn from every result.

Type /help to see all commands.`);
}

async function handleStats(chatId: number | string): Promise<void> {
  const all = await db.select().from(predictionsTable);
  const settled = all.filter((p) => p.status === "won" || p.status === "lost");
  const total = all.length;
  const pending = all.filter((p) => p.status === "pending").length;
  const won = settled.filter((p) => p.status === "won").length;
  const lost = settled.filter((p) => p.status === "lost").length;
  const accuracy = settled.length > 0 ? won / settled.length : 0;
  const roi = settled.length > 0
    ? settled.reduce((sum, p) =>
        p.status === "won" ? sum + (p.odds - 1) * p.kellyFraction : sum - p.kellyFraction, 0
      ) / settled.length
    : 0;
  const avgConf = total > 0 ? all.reduce((s, p) => s + p.confidence, 0) / total : 0;

  const ordered = [...settled].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  let streak = 0;
  if (ordered.length > 0) {
    const st = ordered[0]!.status;
    for (const p of ordered) { if (p.status === st) streak++; else break; }
    if (st === "lost") streak = -streak;
  }
  const streakStr = streak > 0 ? `🔥 ${streak}W streak` : streak < 0 ? `❄️ ${Math.abs(streak)}L streak` : "—";
  const roiStr = roi >= 0 ? `+${(roi * 100).toFixed(2)}%` : `${(roi * 100).toFixed(2)}%`;
  const bar = confidenceBar(accuracy);

  await sendMessage(chatId, `<b>━━━ PERFORMANCE DASHBOARD ━━━</b>

<b>ACCURACY</b>  ${bar}  ${(accuracy * 100).toFixed(1)}%
<b>ROI:</b> ${roiStr}  |  <b>Streak:</b> ${streakStr}
<b>Avg Confidence:</b> ${(avgConf * 100).toFixed(1)}%

<b>Predictions:</b> ${total} total
  ✅ Won: ${won}  |  ❌ Lost: ${lost}  |  ⏳ Pending: ${pending}

${total === 0 ? "No predictions yet — generate your first signal from the dashboard." : ""}`);
}

async function handlePending(chatId: number | string): Promise<void> {
  const pending = await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.status, "pending"))
    .orderBy(desc(predictionsTable.matchDate))
    .limit(8);

  if (pending.length === 0) {
    await sendMessage(chatId, "No open positions. All predictions have been settled.");
    return;
  }

  for (const p of pending) {
    const date = new Date(p.matchDate).toLocaleDateString("en-GB", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
    const text = `<b>⏳ OPEN POSITION #${p.id}</b>
<b>${p.sport.toUpperCase()}</b>  |  ${date}
${p.homeTeam} vs ${p.awayTeam}
Pick: <b>${p.predictedOutcome}</b> @ ${p.odds.toFixed(2)}
Confidence: ${confidenceBar(p.confidence)} ${Math.round(p.confidence * 100)}%
Kelly: ${(p.kellyFraction * 100).toFixed(1)}%`;

    await sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Won", callback_data: `result_won_${p.id}` },
          { text: "❌ Lost", callback_data: `result_lost_${p.id}` },
          { text: "⚪ Void", callback_data: `result_void_${p.id}` },
        ]],
      },
    });
  }
}

async function handleToday(chatId: number | string): Promise<void> {
  const all = await db
    .select()
    .from(predictionsTable)
    .orderBy(desc(predictionsTable.createdAt))
    .limit(50);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const today = all.filter((p) => new Date(p.createdAt) >= todayStart);

  if (today.length === 0) {
    await sendMessage(chatId, "No signals generated today yet. Use the dashboard to scan live odds and create predictions.");
    return;
  }

  const lines = today.map((p) => {
    const icon = p.status === "won" ? "✅" : p.status === "lost" ? "❌" : "⏳";
    return `${icon} #${p.id} | <b>${p.sport}</b> | ${p.homeTeam} vs ${p.awayTeam} | <b>${p.predictedOutcome}</b> @ ${p.odds.toFixed(2)} [${Math.round(p.confidence * 100)}%]`;
  });

  await sendMessage(chatId, `<b>TODAY'S SIGNALS (${today.length})</b>\n\n${lines.join("\n")}`);
}

async function handleRecent(chatId: number | string): Promise<void> {
  const recent = await db
    .select()
    .from(predictionsTable)
    .orderBy(desc(predictionsTable.updatedAt))
    .limit(10);

  const settled = recent.filter((p) => p.status === "won" || p.status === "lost");
  if (settled.length === 0) {
    await sendMessage(chatId, "No settled results yet.");
    return;
  }

  const pnlLines = settled.map((p) => {
    const icon = p.status === "won" ? "✅" : "❌";
    const pnl = p.status === "won"
      ? `+${((p.odds - 1) * p.kellyFraction * 100).toFixed(2)}%`
      : `-${(p.kellyFraction * 100).toFixed(2)}%`;
    return `${icon} ${p.sport} | ${p.homeTeam} vs ${p.awayTeam} | ${p.predictedOutcome} | <b>${pnl}</b>`;
  });

  const totalPnl = settled.reduce((sum, p) =>
    p.status === "won" ? sum + (p.odds - 1) * p.kellyFraction : sum - p.kellyFraction, 0);
  const pnlStr = totalPnl >= 0 ? `+${(totalPnl * 100).toFixed(2)}%` : `${(totalPnl * 100).toFixed(2)}%`;

  await sendMessage(chatId, `<b>RECENT RESULTS</b>\n\n${pnlLines.join("\n")}\n\n<b>Net P&amp;L (shown): ${pnlStr}</b>`);
}

async function handleAsk(chatId: number | string, question: string): Promise<void> {
  if (!question.trim()) {
    await sendMessage(chatId, "Usage: /ask [your betting question]\nExample: /ask What is the Kelly criterion?");
    return;
  }

  await sendMessage(chatId, "🔍 Analysing...");

  const all = await db.select().from(predictionsTable);
  const settled = all.filter((p) => p.status === "won" || p.status === "lost");
  const winRate = settled.length > 0
    ? (settled.filter((p) => p.status === "won").length / settled.length * 100).toFixed(1)
    : "N/A";

  const systemContext = `You are QUANT_AI, a concise sports betting analyst. User's model stats: ${settled.length} settled predictions, ${winRate}% win rate. Answer clearly and practically. Keep responses under 200 words. Format for Telegram HTML: use <b>bold</b> for key terms only.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      { role: "user", parts: [{ text: systemContext + "\n\nQuestion: " + question }] },
    ],
    config: { temperature: 0.4, maxOutputTokens: 300 },
  });

  const answer = (response.text ?? "I couldn't generate an analysis right now.").trim();
  await sendMessage(chatId, `<b>AI ANALYST</b>\n\n${answer}`);
}

async function handleSignal(chatId: number | string, idStr: string): Promise<void> {
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    await sendMessage(chatId, "Usage: /signal [prediction_id]\nExample: /signal 42");
    return;
  }

  const [p] = await db.select().from(predictionsTable).where(eq(predictionsTable.id, id));
  if (!p) {
    await sendMessage(chatId, `Prediction #${id} not found.`);
    return;
  }

  const ev = p.confidence * (p.odds - 1) - (1 - p.confidence);
  const text = formatSignalMessage({
    sport: p.sport,
    homeTeam: p.homeTeam,
    awayTeam: p.awayTeam,
    matchDate: p.matchDate,
    predictedOutcome: p.predictedOutcome,
    confidence: p.confidence,
    odds: p.odds,
    kellyFraction: p.kellyFraction,
    expectedValue: ev,
    reasoning: p.reasoning,
  });

  await sendMessage(chatId, text, {
    reply_markup: p.status === "pending" ? {
      inline_keyboard: [[
        { text: "✅ Won", callback_data: `result_won_${p.id}` },
        { text: "❌ Lost", callback_data: `result_lost_${p.id}` },
        { text: "⚪ Void", callback_data: `result_void_${p.id}` },
      ]],
    } : undefined,
  });
}

async function handleCallbackResult(
  callbackQueryId: string,
  chatId: number | string,
  messageId: number,
  predictionId: number,
  status: "won" | "lost" | "void"
): Promise<void> {
  const outcomeMap: Record<string, string> = {
    won: "Home Win",
    lost: "Away Win",
    void: "Void",
  };

  const [existing] = await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.id, predictionId));

  if (!existing) {
    await answerCallbackQuery(callbackQueryId, "Prediction not found.");
    return;
  }

  if (existing.status !== "pending") {
    await answerCallbackQuery(callbackQueryId, `Already marked as ${existing.status}.`);
    return;
  }

  const [updated] = await db
    .update(predictionsTable)
    .set({ status, actualOutcome: outcomeMap[status] ?? status })
    .where(eq(predictionsTable.id, predictionId))
    .returning();

  if (!updated) {
    await answerCallbackQuery(callbackQueryId, "Failed to update.");
    return;
  }

  const icon = status === "won" ? "✅" : status === "lost" ? "❌" : "⚪";
  const pnl = status === "won"
    ? `+${((updated.odds - 1) * updated.kellyFraction * 100).toFixed(2)}%`
    : status === "lost"
    ? `-${(updated.kellyFraction * 100).toFixed(2)}%`
    : "—";

  await answerCallbackQuery(callbackQueryId, `${icon} Marked as ${status.toUpperCase()}. P&L: ${pnl}`);

  await editMessageText(chatId, messageId,
    `${icon} <b>SETTLED: ${status.toUpperCase()}</b>  |  P&amp;L: ${pnl}\n\n` +
    `<b>${updated.sport.toUpperCase()}</b>: ${updated.homeTeam} vs ${updated.awayTeam}\n` +
    `Predicted: ${updated.predictedOutcome} @ ${updated.odds.toFixed(2)}\n` +
    `Confidence was: ${Math.round(updated.confidence * 100)}%`
  );
}

router.post("/telegram/webhook", async (req, res): Promise<void> => {
  res.sendStatus(200);

  const update = req.body as {
    message?: {
      chat: { id: number };
      from?: { id: number };
      message_id: number;
      text?: string;
      reply_to_message?: { message_id: number };
    };
    callback_query?: {
      id: string;
      from: { id: number };
      message: { chat: { id: number }; message_id: number };
      data: string;
    };
  };

  try {
    if (update.callback_query) {
      const cq = update.callback_query;
      const data = cq.data;
      const chatId = cq.message.chat.id;
      const msgId = cq.message.message_id;

      const resultMatch = data.match(/^result_(won|lost|void)_(\d+)$/);
      if (resultMatch) {
        const status = resultMatch[1] as "won" | "lost" | "void";
        const predId = parseInt(resultMatch[2]!, 10);
        await handleCallbackResult(cq.id, chatId, msgId, predId, status);
      } else {
        await answerCallbackQuery(cq.id, "Unknown action.");
      }
      return;
    }

    if (update.message?.text) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const text = (msg.text ?? "").trim();

      if (text === "/start" || text.startsWith("/start ")) {
        await handleStart(chatId);
      } else if (text === "/help" || text.startsWith("/help ")) {
        await sendMessage(chatId, HELP_TEXT);
      } else if (text === "/stats" || text.startsWith("/stats ")) {
        await handleStats(chatId);
      } else if (text === "/pending" || text.startsWith("/pending ")) {
        await handlePending(chatId);
      } else if (text === "/today" || text.startsWith("/today ")) {
        await handleToday(chatId);
      } else if (text === "/recent" || text.startsWith("/recent ")) {
        await handleRecent(chatId);
      } else if (text.startsWith("/ask")) {
        const question = text.replace(/^\/ask\s*/, "").trim();
        await handleAsk(chatId, question);
      } else if (text.startsWith("/signal")) {
        const idStr = text.replace(/^\/signal\s*/, "").trim();
        await handleSignal(chatId, idStr);
      } else if (/^(won|lost|void)$/i.test(text) && msg.reply_to_message) {
        await sendMessage(chatId, "Use the ✅ ❌ ⚪ buttons on the signal to mark results, or use the dashboard.");
      } else {
        await sendMessage(chatId, `Unknown command. Type /help for available commands.`);
      }
    }
  } catch (err) {
    logger.error({ err }, "Telegram webhook handler error");
  }
});

router.post("/telegram/setup-webhook", async (req, res): Promise<void> => {
  const domains = process.env.REPLIT_DOMAINS ?? process.env.REPLIT_DEV_DOMAIN ?? "";
  const primaryDomain = domains.split(",")[0]?.trim();

  if (!primaryDomain) {
    res.status(500).json({ error: "REPLIT_DOMAINS not available — cannot determine webhook URL" });
    return;
  }

  const webhookUrl = `https://${primaryDomain}/api/telegram/webhook`;
  await setWebhook(webhookUrl);
  req.log.info({ webhookUrl }, "Telegram webhook configured");
  res.json({ success: true, webhookUrl });
});

router.post("/telegram/delete-webhook", async (req, res): Promise<void> => {
  await deleteWebhook();
  res.json({ success: true });
});

router.get("/telegram/webhook-info", async (req, res): Promise<void> => {
  const info = await getWebhookInfo();
  res.json(info);
});

router.post("/telegram/test", async (req, res): Promise<void> => {
  const chatId = getDefaultChatId();
  const result = await sendMessage(chatId,
    "<b>QUANT_AI — System Check</b>\n\nAll systems operational. Type /help to see available commands."
  );
  res.json({ success: true, messageId: result.message_id });
});

router.post("/telegram/send", async (req, res): Promise<void> => {
  const body = SendTelegramPredictionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [p] = await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.id, body.data.predictionId));

  if (!p) {
    res.status(404).json({ error: "Prediction not found" });
    return;
  }

  const chatId = getDefaultChatId();
  const ev = p.confidence * (p.odds - 1) - (1 - p.confidence);

  const text = formatSignalMessage({
    sport: p.sport,
    homeTeam: p.homeTeam,
    awayTeam: p.awayTeam,
    matchDate: p.matchDate,
    predictedOutcome: p.predictedOutcome,
    confidence: p.confidence,
    odds: p.odds,
    kellyFraction: p.kellyFraction,
    expectedValue: ev,
    reasoning: p.reasoning,
  });

  const result = await sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Won", callback_data: `result_won_${p.id}` },
        { text: "❌ Lost", callback_data: `result_lost_${p.id}` },
        { text: "⚪ Void", callback_data: `result_void_${p.id}` },
      ]],
    },
  });

  await db.update(predictionsTable)
    .set({ sentToTelegram: true })
    .where(eq(predictionsTable.id, p.id));

  res.json({ success: true, messageId: result.message_id });
});

export default router;
