import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { pipelineRunsTable } from "./pipeline-runs";
import { episodesTable } from "./episodes";

export const competitiveIntelligenceTable = pgTable("competitive_intelligence", {
  id: serial("id").primaryKey(),
  pipelineRunId: integer("pipeline_run_id")
    .references(() => pipelineRunsTable.id, { onDelete: "cascade" })
    .notNull(),
  episodeId: integer("episode_id").references(() => episodesTable.id, {
    onDelete: "cascade",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),

  topicKeywords: text("topic_keywords").notNull(),
  topicCluster: text("topic_cluster"),
  clipType: text("clip_type").notNull(),

  youtubeShorts: text("youtube_shorts"),
  youtubeShortCount: integer("youtube_short_count"),
  youtubeTopViews: integer("youtube_top_views"),

  instagramData: text("instagram_data"),
  tiktokData: text("tiktok_data"),
  linkedinData: text("linkedin_data"),
  twitterData: text("twitter_data"),

  crossPlatformPatterns: text("cross_platform_patterns"),
  constraintsRaw: text("constraints_raw"),

  systemTitle: text("system_title"),
  systemTitleVariations: text("system_title_variations"),
  systemTags: text("system_tags"),
  systemHashtags: text("system_hashtags"),

  userSelectedTitle: text("user_selected_title"),
  userSelectedTitleIndex: integer("user_selected_title_index"),

  researchOutputRaw: text("research_output_raw"),

  dataQualityScore: integer("data_quality_score").notNull().default(1),
  sufficientData: boolean("sufficient_data").notNull().default(true),
});

export type CompetitiveIntelligence =
  typeof competitiveIntelligenceTable.$inferSelect;
