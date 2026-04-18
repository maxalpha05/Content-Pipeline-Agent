export interface YouTubeShort {
  title: string;
  url: string;
  channel: string;
  views: number;
  likes: number;
  comments: number;
  tags: string[];
  description: string;
  thumbnail: string;
}

export async function searchYouTubeShorts(
  apiKey: string,
  query: string,
): Promise<YouTubeShort[]> {
  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoDuration=short&maxResults=8&order=viewCount&key=${apiKey}`;
    console.log("[YouTube] search query:", query);
    const searchRes = await fetch(searchUrl);
    console.log("[YouTube] search status:", searchRes.status, searchRes.statusText);
    if (!searchRes.ok) {
      const errBody = await searchRes.text();
      console.error("[YouTube] search error body:", errBody);
      return [];
    }
    const searchData = (await searchRes.json()) as {
      items?: { id: { videoId: string } }[];
    };
    if (!searchData.items || searchData.items.length === 0) {
      console.log("[YouTube] no items returned for query:", query);
      return [];
    }

    const videoIds = searchData.items
      .map((item) => item.id.videoId)
      .join(",");
    const detailUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds}&key=${apiKey}`;
    const detailRes = await fetch(detailUrl);
    if (!detailRes.ok) return [];
    const detailData = (await detailRes.json()) as {
      items?: {
        id: string;
        snippet: {
          title: string;
          channelTitle: string;
          tags?: string[];
          description?: string;
          thumbnails: { high?: { url: string } };
        };
        statistics: {
          viewCount?: string;
          likeCount?: string;
          commentCount?: string;
        };
      }[];
    };
    if (!detailData.items) return [];

    return detailData.items
      .map((v) => ({
        title: v.snippet.title,
        url: "https://youtube.com/shorts/" + v.id,
        channel: v.snippet.channelTitle,
        views: parseInt(v.statistics.viewCount || "0"),
        likes: parseInt(v.statistics.likeCount || "0"),
        comments: parseInt(v.statistics.commentCount || "0"),
        tags: (v.snippet.tags || []).slice(0, 15),
        description: (v.snippet.description || "").substring(0, 300),
        thumbnail: v.snippet.thumbnails.high
          ? v.snippet.thumbnails.high.url
          : "",
      }))
      .sort((a, b) => b.views - a.views);
  } catch (e) {
    console.error("[YouTube] exception:", e);
    return [];
  }
}

export function formatYouTubeData(results: YouTubeShort[]): string {
  if (!results || results.length === 0)
    return "No YouTube Shorts data available.";
  return results
    .map(function (r, i) {
      const viewStr =
        r.views >= 1000000
          ? (r.views / 1000000).toFixed(1) + "M"
          : r.views >= 1000
            ? (r.views / 1000).toFixed(0) + "K"
            : r.views.toString();
      return [
        i + 1 + ". " + r.title,
        "   URL: " + r.url,
        "   Channel: " + r.channel,
        "   Views: " +
          viewStr +
          " | Likes: " +
          r.likes +
          " | Comments: " +
          r.comments,
        "   Tags: " + (r.tags.length > 0 ? r.tags.join(", ") : "none visible"),
        "   Thumbnail: " + r.thumbnail,
      ].join("\n");
    })
    .join("\n\n");
}

export function extractTopicKeywords(clipText: string): string {
  // Strip metadata label lines (e.g. "Talia Wolf | Getuplift (00:00)")
  // These contain guest names and company names that pollute the keyword query.
  const lines = clipText.split("\n");
  const contentLines = lines.filter((line) => {
    const trimmed = line.trim();
    // Skip lines that look like guest/timestamp labels
    if (trimmed.includes("|")) return false;
    if (/\(\d{2}:\d{2}\)/.test(trimmed)) return false;
    // Skip lines that look like "Speaker N:" prefixes
    if (/^Speaker\s*\d+\s*:/i.test(trimmed)) return false;
    return true;
  });
  const content = contentLines.join(" ");

  const stopwords = new Set([
    "that", "this", "with", "from", "have", "been", "they", "their", "them",
    "what", "when", "where", "which", "will", "would", "could", "should",
    "about", "after", "before", "between", "through", "during", "also",
    "just", "like", "more", "most", "much", "some", "than", "then", "very",
    "well", "were", "your", "into", "over", "only", "other", "such", "know",
    "think", "going", "right", "people", "really", "because", "something",
    "actually", "want", "need", "make", "does", "doing", "done",
    "said", "says", "saying", "gets", "getting", "come", "coming", "back",
    "there", "these", "those", "here", "even", "every", "being", "using",
    "things", "thing", "kind", "ways", "means", "look", "looks", "feel",
    "start", "stop", "says", "talk", "talking", "tell", "told",
  ]);

  const words = content
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !stopwords.has(w));

  const freq: Record<string, number> = {};
  words.forEach((w) => {
    freq[w] = (freq[w] || 0) + 1;
  });

  const keywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map((e) => e[0])
    .join(" ");

  console.log("[YouTube] extracted keywords:", keywords);
  return keywords || "marketing growth strategy";
}
