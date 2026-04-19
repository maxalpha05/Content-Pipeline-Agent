import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { episodesTable } from "./episodes";

export const pipelineRunsTable = pgTable("pipeline_runs", {
  id: serial("id").primaryKey(),
  episodeId: integer("episode_id").references(() => episodesTable.id, {
    onDelete: "cascade",
  }),
  type: text("type").notNull(),
  clipType: text("clip_type"),
  status: text("status").notNull().default("pending"),
  title: text("title"),
  episodeTranscript: text("episode_transcript").notNull(),
  clipTranscript: text("clip_transcript"),
  analystOutput: text("analyst_output"),
  writerOutput: text("writer_output"),
  editorOutput: text("editor_output"),
  feedbackHistory: text("feedback_history"),
  youtubeData: text("youtube_data"),
  researchOutput: text("research_output"),
  surgeryOutput: text("surgery_output"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPipelineRunSchema = createInsertSchema(pipelineRunsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPipelineRun = z.infer<typeof insertPipelineRunSchema>;
export type PipelineRun = typeof pipelineRunsTable.$inferSelect;
