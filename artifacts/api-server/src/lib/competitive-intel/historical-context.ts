import { and, desc, eq, gte } from "drizzle-orm";
import {
  db,
  competitiveIntelligenceTable,
  type CompetitiveIntelligence,
} from "@workspace/db";
import type { YouTubeShort } from "../pipeline/youtube";
import { logger } from "../logger";

interface ScoredRecord {
  record: CompetitiveIntelligence;
  relevance: number;
  shorts: YouTubeShort[];
}

function parseShorts(raw: string | null): YouTubeShort[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as YouTubeShort[]) : [];
  } catch {
    return [];
  }
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

function scoreRelevance(
  currentKeywords: string,
  record: CompetitiveIntelligence,
): number {
  const current = new Set(tokenize(currentKeywords));
  const stored = new Set(tokenize(record.topicKeywords));
  let overlap = 0;
  for (const w of current) if (stored.has(w)) overlap++;
  let score = overlap * 2;

  const cluster = (record.topicCluster ?? "").toLowerCase().trim();
  if (cluster) {
    let clusterKeywordHit = false;
    for (const w of current) {
      if (cluster.includes(w)) {
        clusterKeywordHit = true;
        break;
      }
    }
    if (clusterKeywordHit) score += 3;
    if (cluster === currentKeywords.toLowerCase().trim()) score += 5;
  }

  return score;
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return n.toString();
}

function computeTrend(orderedTopViews: number[]): string {
  if (orderedTopViews.length < 3) return "";
  const first = orderedTopViews[0];
  const last = orderedTopViews[orderedTopViews.length - 1];
  if (first <= 0) return "stable";
  const ratio = last / first;
  if (ratio >= 1.25) return "trending up";
  if (ratio <= 0.8) return "trending down";
  return "stable";
}

function parseVerbRule(constraints: string): string | null {
  const m = constraints.match(/VERB RULE:\s*([^\n]+)/i);
  if (!m) return null;
  const line = m[1].toLowerCase();
  if (line.includes("imperative")) return "imperative";
  if (line.includes("question")) return "question";
  if (line.includes("declarative")) return "declarative";
  return null;
}

function parseMustIncludeTags(constraints: string): string[] {
  const tagBlock = constraints.match(
    /###\s*TAG CONSTRAINTS[\s\S]*?MUST INCLUDE:\s*([^\n]+)/i,
  );
  if (!tagBlock) return [];
  return tagBlock[1]
    .split(/[,;]/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length < 50);
}

export async function getHistoricalContext(
  topicKeywords: string,
  clipType: string,
): Promise<string> {
  if (!topicKeywords || !topicKeywords.trim()) return "";

  const candidates = await db
    .select()
    .from(competitiveIntelligenceTable)
    .where(
      and(
        eq(competitiveIntelligenceTable.sufficientData, true),
        gte(competitiveIntelligenceTable.dataQualityScore, 5),
        eq(competitiveIntelligenceTable.clipType, clipType),
      ),
    )
    .orderBy(
      desc(competitiveIntelligenceTable.dataQualityScore),
      desc(competitiveIntelligenceTable.createdAt),
    )
    .limit(10);

  if (candidates.length === 0) return "";

  const scored: ScoredRecord[] = candidates
    .map((record) => ({
      record,
      relevance: scoreRelevance(topicKeywords, record),
      shorts: parseShorts(record.youtubeShorts),
    }))
    .filter((s) => s.relevance >= 3)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 8);

  if (scored.length === 0) return "";

  const totalShorts = scored.reduce(
    (acc, s) => acc + (s.record.youtubeShortCount ?? s.shorts.length),
    0,
  );

  const topViewsList = scored
    .map((s) => s.record.youtubeTopViews ?? 0)
    .filter((n) => n > 0);
  const avgTopViews =
    topViewsList.length > 0
      ? Math.round(
          topViewsList.reduce((a, b) => a + b, 0) / topViewsList.length,
        )
      : 0;

  let highestShort: YouTubeShort | null = null;
  for (const s of scored) {
    for (const sh of s.shorts) {
      if (!highestShort || sh.views > highestShort.views) highestShort = sh;
    }
  }

  const chronological = [...scored].sort(
    (a, b) =>
      new Date(a.record.createdAt).getTime() -
      new Date(b.record.createdAt).getTime(),
  );
  const trend = computeTrend(
    chronological.map((s) => s.record.youtubeTopViews ?? 0),
  );

  const tagRunCount: Record<string, number> = {};
  for (const s of scored) {
    const tagsInRun = new Set<string>();
    for (const sh of s.shorts) {
      for (const t of sh.tags || []) {
        const key = t.toLowerCase().trim();
        if (key) tagsInRun.add(key);
      }
    }
    for (const t of tagsInRun) tagRunCount[t] = (tagRunCount[t] || 0) + 1;
  }
  const topTags = Object.entries(tagRunCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const allTitles: { title: string; views: number; url: string }[] = [];
  for (const s of scored) {
    for (const sh of s.shorts) {
      allTitles.push({ title: sh.title, views: sh.views, url: sh.url });
    }
  }
  const topTitles = allTitles
    .sort((a, b) => b.views - a.views)
    .slice(0, 8);

  const userSelectedTitles = scored
    .filter((s) => s.record.userSelectedTitle)
    .map((s) => ({
      title: s.record.userSelectedTitle!,
      at: new Date(s.record.createdAt),
    }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const recentByDate = [...scored].sort(
    (a, b) =>
      new Date(b.record.createdAt).getTime() -
      new Date(a.record.createdAt).getTime(),
  );

  const recentPatterns = recentByDate
    .slice(0, 3)
    .map((s) => s.record.crossPlatformPatterns)
    .filter((p): p is string => !!p && p.trim().length > 0);

  const constraintTexts = recentByDate
    .slice(0, 3)
    .map((s) => s.record.constraintsRaw)
    .filter((c): c is string => !!c && c.trim().length > 0);

  const verbRules: Record<string, number> = {};
  const mandatedTagCounts: Record<string, number> = {};
  for (const c of constraintTexts) {
    const v = parseVerbRule(c);
    if (v) verbRules[v] = (verbRules[v] || 0) + 1;
    const tags = parseMustIncludeTags(c);
    const uniq = new Set(tags);
    for (const t of uniq) mandatedTagCounts[t] = (mandatedTagCounts[t] || 0) + 1;
  }
  const topVerbRule = Object.entries(verbRules).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const recurringMandatedTags = Object.entries(mandatedTagCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // --- Build block ---
  const lines: string[] = [];
  lines.push("HISTORICAL COMPETITIVE INTELLIGENCE");
  lines.push(
    `Based on ${scored.length} prior clip run${scored.length === 1 ? "" : "s"} in this topic area:`,
  );
  lines.push("");

  lines.push("## YouTube Shorts Performance");
  lines.push(`- Total Shorts analyzed across prior runs: ${totalShorts}`);
  if (avgTopViews > 0) {
    lines.push(
      `- Average top-view count per run: ${formatViews(avgTopViews)} views`,
    );
  }
  if (highestShort) {
    lines.push(
      `- Highest-performing Short ever seen: "${highestShort.title}" — ${formatViews(highestShort.views)} views (${highestShort.url})`,
    );
  }
  if (trend) lines.push(`- View-count trend across runs: ${trend}`);
  lines.push("");

  if (topTags.length > 0) {
    lines.push("## Top Competitor Tags (by run frequency)");
    for (const [tag, count] of topTags) {
      lines.push(`- ${tag} (appeared in ${count} of ${scored.length} runs)`);
    }
    lines.push("");
  }

  if (topTitles.length > 0) {
    lines.push("## Top Competitor Titles (by views)");
    for (const t of topTitles) {
      lines.push(`- "${t.title}" — ${formatViews(t.views)} views`);
    }
    lines.push("");
  }

  if (userSelectedTitles.length > 0) {
    lines.push("## Titles Previously Selected By User");
    for (const t of userSelectedTitles) {
      lines.push(`- "${t.title}"`);
    }
    lines.push("");
  }

  if (recentPatterns.length > 0) {
    lines.push("## Most Recent Cross-Platform Patterns");
    lines.push(recentPatterns[0]);
    if (recentPatterns.length > 1) {
      lines.push("");
      lines.push(
        "(Older runs may show different patterns; treat the above as the most current signal.)",
      );
    }
    lines.push("");
  }

  if (topVerbRule || recurringMandatedTags.length > 0) {
    lines.push("## Recurring Creative Constraint Patterns");
    if (topVerbRule) {
      lines.push(
        `- Title verb rule: ${topVerbRule[0]} dominated in ${topVerbRule[1]} of ${constraintTexts.length} recent runs`,
      );
    }
    if (recurringMandatedTags.length > 0) {
      const tagList = recurringMandatedTags
        .map(([t, c]) => `${t} (${c}x)`)
        .join(", ");
      lines.push(`- Frequently mandated tags across runs: ${tagList}`);
    }
    lines.push("");
  }

  if (scored.length < 3) {
    lines.push(
      `Limited historical data (${scored.length} run${scored.length === 1 ? "" : "s"}). Patterns may not be reliable yet.`,
    );
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  const block = lines.join("\n");
  logger.info(
    {
      matchedRuns: scored.length,
      totalShorts,
      tagsSurfaced: topTags.length,
      titlesSurfaced: topTitles.length,
      userSelectedTitles: userSelectedTitles.length,
    },
    "[historical-context] block built",
  );
  return block;
}
