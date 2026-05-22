export interface ParsedDiscoveryClip {
  number: number;
  insight: string;
  linesLabel: string | null;
  wordCount: string | null;
  durationLabel: string | null;
  clipType: "vertical" | "horizontal";
  clipTypeRaw: string;
  hookRating: string | null;
  valueRating: string | null;
  closeRating: string | null;
  surgeryNotes: string | null;
  topicKeywords: string | null;
  transcriptSegment: string;
}

export interface ParsedDiscoveryOutput {
  clips: ParsedDiscoveryClip[];
  summary: string | null;
}

function extractRating(block: string, label: string): string | null {
  const re = new RegExp(
    `\\*\\*${label} assessment:\\*\\*[\\s\\S]*?\\b(STRONG|NEEDS WORK)\\b`,
    "i",
  );
  const m = block.match(re);
  return m ? m[1].toUpperCase() : null;
}

function extractField(block: string, label: string): string | null {
  const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+)`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function extractMultilineField(block: string, label: string): string | null {
  const re = new RegExp(
    `\\*\\*${label}:\\*\\*\\s*\\n?([\\s\\S]*?)(?=\\n\\*\\*|\\n\`\`\`|$)`,
    "i",
  );
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

export function parseDiscoveryOutput(raw: string): ParsedDiscoveryOutput {
  if (!raw || !raw.trim()) return { clips: [], summary: null };

  const summaryMatch = raw.match(/##\s*DISCOVERY SUMMARY[\s\S]*$/i);
  const summary = summaryMatch ? summaryMatch[0].trim() : null;
  const beforeSummary = summary ? raw.slice(0, raw.indexOf(summary)) : raw;

  const clipSplit = beforeSummary.split(/\n(?=##\s*CLIP\s+\d+)/);
  const clips: ParsedDiscoveryClip[] = [];

  for (const block of clipSplit) {
    const header = block.match(/^##\s*CLIP\s+(\d+):\s*(.+)/i);
    if (!header) continue;
    const number = parseInt(header[1], 10);
    const insight = header[2].trim();

    const lines = extractField(block, "Lines");
    const duration = extractField(block, "Estimated duration");
    const clipTypeRaw = extractField(block, "Clip type") ?? "";
    const topicKw = extractField(block, "Topic keywords");
    const surgery = extractMultilineField(block, "Surgery notes");

    let wordCount: string | null = null;
    let durationLabel: string | null = null;
    if (duration) {
      const wm = duration.match(/(\d+)\s*words?/i);
      if (wm) wordCount = `${wm[1]} words`;
      const dm = duration.match(/(~?\s*\d+\s*sec(?:ond)?s?)/i);
      if (dm) durationLabel = dm[1].replace(/\s+/g, " ").trim();
    }

    const clipType: "vertical" | "horizontal" = /horizontal/i.test(clipTypeRaw)
      ? "horizontal"
      : "vertical";

    const tsMatch = block.match(
      /\*\*Transcript segment:\*\*\s*\n```\s*\n?([\s\S]*?)\n?```/i,
    );
    const transcriptSegment = tsMatch ? tsMatch[1] : "";

    clips.push({
      number,
      insight,
      linesLabel: lines,
      wordCount,
      durationLabel,
      clipType,
      clipTypeRaw,
      hookRating: extractRating(block, "Hook"),
      valueRating: extractRating(block, "Value"),
      closeRating: extractRating(block, "Close"),
      surgeryNotes: surgery,
      topicKeywords: topicKw,
      transcriptSegment,
    });
  }

  return { clips, summary };
}
