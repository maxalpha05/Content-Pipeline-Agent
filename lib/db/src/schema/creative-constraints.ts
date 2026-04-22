import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { pipelineRunsTable } from "./pipeline-runs";
import { episodesTable } from "./episodes";

export const creativeConstraintsTable = pgTable("creative_constraints", {
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

  constraintsRaw: text("constraints_raw").notNull(),

  titleVerbRule: text("title_verb_rule"),
  titleStatRule: text("title_stat_rule"),
  titleLengthRule: text("title_length_rule"),
  titleFramingRule: text("title_framing_rule"),
  titleAvoid: text("title_avoid"),

  hookPattern: text("hook_pattern"),
  hookFirstWords: text("hook_first_words"),

  tagsMustInclude: text("tags_must_include"),
  tagsPairWith: text("tags_pair_with"),
  tagsAvoid: text("tags_avoid"),

  hashtagsMustInclude: text("hashtags_must_include"),
  hashtagsPairWith: text("hashtags_pair_with"),
  hashtagsFormatRule: text("hashtags_format_rule"),

  linkedinHookFormat: text("linkedin_hook_format"),
  linkedinLength: text("linkedin_length"),
  linkedinCtaPattern: text("linkedin_cta_pattern"),

  twitterFormat: text("twitter_format"),
  twitterHashtagRule: text("twitter_hashtag_rule"),

  finalTitle: text("final_title"),
  finalTags: text("final_tags"),
  finalHashtags: text("final_hashtags"),
});

export type CreativeConstraints =
  typeof creativeConstraintsTable.$inferSelect;
