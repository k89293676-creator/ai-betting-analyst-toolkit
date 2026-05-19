import { pgTable, serial, timestamp, integer, real, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const trainingRecordsTable = pgTable("training_records", {
  id: serial("id").primaryKey(),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
  samplesProcessed: integer("samples_processed").notNull().default(0),
  accuracyBefore: real("accuracy_before"),
  accuracyAfter: real("accuracy_after"),
  status: text("status").notNull().default("completed"),
  notes: text("notes"),
});

export const insertTrainingRecordSchema = createInsertSchema(trainingRecordsTable).omit({
  id: true,
});
export type InsertTrainingRecord = z.infer<typeof insertTrainingRecordSchema>;
export type TrainingRecord = typeof trainingRecordsTable.$inferSelect;
