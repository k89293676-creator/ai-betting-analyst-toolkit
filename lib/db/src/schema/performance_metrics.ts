import { pgTable, serial, timestamp, real, integer, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const performanceMetricsTable = pgTable("performance_metrics", {
  id: serial("id").primaryKey(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  sport: text("sport"),
  totalPredictions: integer("total_predictions").notNull().default(0),
  correctPredictions: integer("correct_predictions").notNull().default(0),
  accuracy: real("accuracy").notNull().default(0),
  roi: real("roi").notNull().default(0),
  avgConfidence: real("avg_confidence").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPerformanceMetricSchema = createInsertSchema(performanceMetricsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPerformanceMetric = z.infer<typeof insertPerformanceMetricSchema>;
export type PerformanceMetric = typeof performanceMetricsTable.$inferSelect;
