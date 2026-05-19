import { Router, type IRouter } from "express";
import { GetOddsQueryParams } from "@workspace/api-zod";

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

const router: IRouter = Router();

router.get("/odds/sports", async (req, res): Promise<void> => {
  const apiKey = process.env.ODDS_API;
  if (!apiKey) {
    res.status(500).json({ error: "ODDS_API key not configured" });
    return;
  }

  const url = `${ODDS_API_BASE}/sports?apiKey=${apiKey}`;
  const response = await fetch(url);

  if (!response.ok) {
    req.log.error({ status: response.status }, "Odds API sports request failed");
    res.status(502).json({ error: "Failed to fetch sports from The Odds API" });
    return;
  }

  const data = await response.json();
  res.json(data);
});

router.get("/odds", async (req, res): Promise<void> => {
  const apiKey = process.env.ODDS_API;
  if (!apiKey) {
    res.status(500).json({ error: "ODDS_API key not configured" });
    return;
  }

  const query = GetOddsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const regions = query.data.regions ?? "uk,us,eu,au";
  const sport = query.data.sport;

  const url = `${ODDS_API_BASE}/sports/${sport}/odds?apiKey=${apiKey}&regions=${regions}&markets=h2h&oddsFormat=decimal`;
  const response = await fetch(url);

  if (!response.ok) {
    req.log.error({ status: response.status, sport }, "Odds API request failed");
    res.status(502).json({ error: "Failed to fetch odds from The Odds API" });
    return;
  }

  const data = (await response.json()) as Array<{
    id: string;
    sport_key: string;
    home_team: string;
    away_team: string;
    commence_time: string;
    bookmakers: Array<{
      key: string;
      title: string;
      markets: Array<{
        key: string;
        outcomes: Array<{ name: string; price: number }>;
      }>;
    }>;
  }>;

  const normalized = data.map((event) => ({
    id: event.id,
    sport: event.sport_key,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    commenceTime: event.commence_time,
    bookmakers: event.bookmakers,
  }));

  res.json(normalized);
});

export default router;
