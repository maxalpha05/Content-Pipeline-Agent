import type { YouTubeShort } from "../pipeline/youtube";

export interface ScoringInput {
  youtubeShorts: YouTubeShort[];
  instagramData: string | null;
  tiktokData: string | null;
  linkedinData: string | null;
  twitterData: string | null;
  crossPlatformPatterns: string | null;
  constraintsRaw: string | null;
  topicKeywords: string;
}

export function computeDataQualityScore(data: ScoringInput): number {
  let score = 0;

  const ytCount = data.youtubeShorts.length;
  if (ytCount >= 6) score += 2;
  else if (ytCount >= 3) score += 1;

  const topViews =
    ytCount > 0 ? Math.max(...data.youtubeShorts.map((s) => s.views)) : 0;
  if (topViews >= 100_000) score += 2;
  else if (topViews >= 10_000) score += 1;

  const platforms = [
    data.instagramData,
    data.tiktokData,
    data.linkedinData,
    data.twitterData,
  ].filter((p): p is string => !!p && p.length > 50);
  const platformCount = platforms.length;
  if (platformCount >= 3) score += 3;
  else if (platformCount === 2) score += 2;
  else if (platformCount === 1) score += 1;

  if (data.crossPlatformPatterns && data.crossPlatformPatterns.length > 100) {
    score += 1;
  }

  if (data.constraintsRaw && data.constraintsRaw.length > 100) {
    score += 1;
  }

  const specificKeywords = data.topicKeywords
    .split(/\s+/)
    .filter((w) => w.length > 3).length;
  if (specificKeywords >= 3) score += 1;

  return Math.max(1, Math.min(10, score));
}

export function isSufficientData(data: ScoringInput): boolean {
  const strong = data.youtubeShorts.filter((s) => s.views >= 1000).length;
  return strong >= 2;
}
