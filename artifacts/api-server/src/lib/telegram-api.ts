const BASE = "https://api.telegram.org";

export function getToken(): string {
  const token = process.env.TELEGRAM_BOTTOKEN;
  if (!token) throw new Error("TELEGRAM_BOTTOKEN not configured");
  return token;
}

export function getDefaultChatId(): string {
  const id = process.env.TELEGRAM_CHATID;
  if (!id) throw new Error("TELEGRAM_CHATID not configured");
  return id;
}

async function call<T>(token: string, method: string, body: object): Promise<T> {
  const res = await fetch(`${BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`);
  return json.result;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface SendMessageOptions {
  parse_mode?: "HTML" | "Markdown";
  reply_markup?: {
    inline_keyboard?: InlineKeyboardButton[][];
    remove_keyboard?: boolean;
  };
  disable_web_page_preview?: boolean;
}

export async function sendMessage(
  chatId: string | number,
  text: string,
  opts: SendMessageOptions = {}
): Promise<{ message_id: number }> {
  return call(getToken(), "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...opts,
  });
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await call(getToken(), "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text ?? "",
  });
}

export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  opts: SendMessageOptions = {}
): Promise<void> {
  await call(getToken(), "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...opts,
  }).catch(() => undefined);
}

export async function setWebhook(url: string): Promise<void> {
  await call(getToken(), "setWebhook", {
    url,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

export async function deleteWebhook(): Promise<void> {
  await call(getToken(), "deleteWebhook", { drop_pending_updates: false });
}

export async function getWebhookInfo(): Promise<{
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_message?: string;
}> {
  return call(getToken(), "getWebhookInfo", {});
}

export function confidenceBar(confidence: number, length = 10): string {
  const filled = Math.round(confidence * length);
  return "█".repeat(filled) + "░".repeat(length - filled);
}

export function formatSignalMessage(prediction: {
  sport: string;
  homeTeam: string;
  awayTeam: string;
  matchDate: Date | string;
  predictedOutcome: string;
  confidence: number;
  odds: number;
  kellyFraction: number;
  expectedValue: number;
  reasoning: string;
}): string {
  const date = new Date(prediction.matchDate).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
  const confPct = Math.round(prediction.confidence * 100);
  const kellyPct = (prediction.kellyFraction * 100).toFixed(1);
  const ev = prediction.expectedValue;
  const evStr = ev >= 0 ? `+${(ev * 100).toFixed(1)}%` : `${(ev * 100).toFixed(1)}%`;
  const evLabel = ev > 0 ? "✅ POSITIVE EV" : "⚠️ LOW EV";
  const bar = confidenceBar(prediction.confidence);

  return `<b>━━━ AI BETTING SIGNAL ━━━</b>

<b>${prediction.sport.toUpperCase()}</b>  |  ${date}
<b>${prediction.homeTeam}</b> vs <b>${prediction.awayTeam}</b>

<b>PICK:</b> ${prediction.predictedOutcome}
<b>ODDS:</b> ${prediction.odds.toFixed(2)}  |  <b>KELLY:</b> ${kellyPct}%
<b>CONFIDENCE:</b> ${bar} ${confPct}%
<b>EXP. VALUE:</b> ${evStr}  ${evLabel}

<b>ANALYSIS:</b>
<i>${prediction.reasoning}</i>`;
}

export function formatResultMessage(prediction: {
  sport: string;
  homeTeam: string;
  awayTeam: string;
  predictedOutcome: string;
  actualOutcome: string | null;
  odds: number;
  confidence: number;
  kellyFraction: number;
  status: string;
}): string {
  const icon = prediction.status === "won" ? "✅" : prediction.status === "lost" ? "❌" : "⚪";
  const pnl = prediction.status === "won"
    ? `+${((prediction.odds - 1) * prediction.kellyFraction * 100).toFixed(2)}%`
    : prediction.status === "lost"
    ? `-${(prediction.kellyFraction * 100).toFixed(2)}%`
    : "—";

  return `<b>${icon} RESULT: ${prediction.status.toUpperCase()}</b>

<b>${prediction.sport.toUpperCase()}</b>
${prediction.homeTeam} vs ${prediction.awayTeam}

Predicted: <b>${prediction.predictedOutcome}</b>
Actual: <b>${prediction.actualOutcome ?? "—"}</b>
Confidence: ${Math.round(prediction.confidence * 100)}%  |  P&amp;L: <b>${pnl}</b>`;
}
