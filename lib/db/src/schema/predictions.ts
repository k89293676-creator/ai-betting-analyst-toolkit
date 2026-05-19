import { pgTable, serial, text, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const predictionsTable = pgTable("predictions", {
  id: serial("id").primaryKey(),
  sport: text("sport").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  matchDate: timestamp("match_date", { withTimezone: true }).notNull(),
  predictedOutcome: text("predicted_outcome").notNull(),
  confidence: real("confidence").notNull(),
  odds: real("odds").notNull(),
  kellyFraction: real("kelly_fraction").notNull(),
  reasoning: text("reasoning").notNull(),
  status: text("status").notNull().default("pending"),
  actualOutcome: text("actual_outcome"),
  sentToTelegram: boolean("sent_to_telegram").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPredictionSchema = createInsertSchema(predictionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;
export type Prediction = typeof predictionsTable.$inferSelect;
