import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const episodesTable = pgTable("episodes", {
  id: serial("id").primaryKey(),
  episodeName: text("episode_name").notNull(),
  guestName: text("guest_name").notNull(),
  fullTranscript: text("full_transcript").notNull(),
  status: text("status").notNull().default("active"),
  clipCount: integer("clip_count").notNull().default(0),
  substackArticle: text("substack_article"),
  substackNote: text("substack_note"),
  linkedinPost: text("linkedin_post"),
  twitterPost: text("twitter_post"),
  youtubeDescription: text("youtube_description"),
  youtubeTags: text("youtube_tags"),
  titleVariations: text("title_variations"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEpisodeSchema = createInsertSchema(episodesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEpisode = z.infer<typeof insertEpisodeSchema>;
export type Episode = typeof episodesTable.$inferSelect;
