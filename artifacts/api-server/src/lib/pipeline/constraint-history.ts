import { db, creativeConstraintsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";

export type ConstraintRow = typeof creativeConstraintsTable.$inferSelect;

export interface PatternCount {
  value: string;
  count: number;
}

export interface ConstraintPatterns {
  titleVerbRules: PatternCount[];
  titleFramingRules: PatternCount[];
  hookPatterns: PatternCount[];
  topTags: PatternCount[];
  topHashtags: PatternCount[];
  linkedinHookFormats: PatternCount[];
}

export interface ConstraintHistory {
  totalRuns: number;
  rows: ConstraintRow[];
  patterns: ConstraintPatterns;
}

export interface FetchConstraintHistoryOptions {
  episodeId?: number;
  topic?: string;
  topicCluster?: string;
  clipType?: "vertical" | "horizontal";
  limit?: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 3);
}

function topCounts(values: (string | null | undefined)[], topN = 5): PatternCount[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    if (!raw) continue;
    const v = raw.trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

function topTokens(values: (string | null | undefined)[], topN = 8): PatternCount[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    if (!raw) continue;
    const tokens = raw
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    for (const t of tokens) {
      const key = t.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= 1)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

export async function fetchConstraintHistory(
  options: FetchConstraintHistoryOptions = {},
): Promise<ConstraintHistory> {
  const { episodeId, topic, topicCluster, clipType, limit = 20 } = options;

  const conditions = [];
  if (typeof episodeId === "number") {
    conditions.push(eq(creativeConstraintsTable.episodeId, episodeId));
  }
  if (clipType) {
    conditions.push(eq(creativeConstraintsTable.clipType, clipType));
  }
  if (topicCluster && topicCluster.trim()) {
    conditions.push(
      sql`lower(${creativeConstraintsTable.topicCluster}) = ${topicCluster.trim().toLowerCase()}`,
    );
  }

  const tokens = topic ? tokenize(topic) : [];
  if (tokens.length > 0) {
    const ors = tokens.map(
      (t) => sql`lower(${creativeConstraintsTable.topicKeywords}) like ${"%" + t + "%"}`,
    );
    const combined = ors.reduce((acc, cur) => sql`${acc} OR ${cur}`);
    conditions.push(sql`(${combined})`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(creativeConstraintsTable)
    .where(where)
    .orderBy(desc(creativeConstraintsTable.createdAt))
    .limit(limit);

  const patterns: ConstraintPatterns = {
    titleVerbRules: topCounts(rows.map((r) => r.titleVerbRule)),
    titleFramingRules: topCounts(rows.map((r) => r.titleFramingRule)),
    hookPatterns: topCounts(rows.map((r) => r.hookPattern)),
    topTags: topTokens(rows.map((r) => r.finalTags ?? r.tagsMustInclude)),
    topHashtags: topTokens(rows.map((r) => r.finalHashtags ?? r.hashtagsMustInclude)),
    linkedinHookFormats: topCounts(rows.map((r) => r.linkedinHookFormat)),
  };

  return { totalRuns: rows.length, rows, patterns };
}

/**
 * Format a compact "what worked before" block to inject into the Research Analyst
 * prompt. Returns null when there's nothing meaningful to share.
 */
export function formatHistoricalContext(history: ConstraintHistory): string | null {
  if (history.totalRuns === 0) return null;
  const p = history.patterns;
  const lines: string[] = [
    `PRIOR CONSTRAINT PATTERNS (across ${history.totalRuns} past clip${history.totalRuns === 1 ? "" : "s"} on similar topics):`,
  ];
  const section = (label: string, items: PatternCount[]) => {
    if (items.length === 0) return;
    const formatted = items
      .slice(0, 5)
      .map((i) => `${i.value} (${i.count}×)`)
      .join("; ");
    lines.push(`- ${label}: ${formatted}`);
  };
  section("Title verb rules that recurred", p.titleVerbRules);
  section("Title framing patterns", p.titleFramingRules);
  section("Hook patterns", p.hookPatterns);
  section("Tags that repeated", p.topTags);
  section("Hashtags that repeated", p.topHashtags);
  section("LinkedIn hook formats", p.linkedinHookFormats);
  if (lines.length === 1) return null;
  lines.push(
    "Use these as a starting point, but only carry them forward if the YouTube data and current clip support them.",
  );
  return lines.join("\n");
}
