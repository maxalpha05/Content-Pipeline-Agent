export interface ParsedDiscoveryClip {
  number: number;
  insight: string;
  linesLabel: string | null;
  wordCount: string | null;
  durationLabel: string | null;
  clipType: "vertical" | "horizontal";
  clipTypeRaw: string;
  /** New format: Setup / Follow-through / Completion ratings. Legacy Hook/Value/Close outputs map onto these. */
  setupRating: string | null;
  followThroughRating: string | null;
  completionRating: string | null;
  /** e.g. "RISK AVERSION", "CONTRARIAN" — new format only */
  emotionalTrigger: string | null;
  /** "PUNCHY" | "NEEDS WORK" — new format only */
  punchiness: string | null;
  /** "PASSES" | "PASSES WITH SURGERY" | "FAILS" — new format only */
  coldViewerVerdict: string | null;
  /** True when ratings came from the legacy Hook/Value/Close format */
  legacyFormat: boolean;
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

const TRIGGER_TYPES = [
  "RISK AVERSION",
  "FOMO",
  "CONTRARIAN",
  "STAKES",
  "IDENTITY CHALLENGE",
  "CURIOSITY GAP",
  "EDUCATIONAL",
];

function extractEmotionalTrigger(block: string): {
  trigger: string | null;
  punchiness: string | null;
} {
  const raw = extractMultilineField(block, "Emotional trigger");
  if (!raw) return { trigger: null, punchiness: null };
  const upper = raw.toUpperCase();
  let trigger: string | null = null;
  for (const t of TRIGGER_TYPES) {
    if (upper.includes(t)) {
      trigger = t;
      break;
    }
  }
  let punchiness: string | null = null;
  if (/\bPUNCHY\b/i.test(raw)) punchiness = "PUNCHY";
  else if (/\bNEEDS WORK\b/i.test(raw)) punchiness = "NEEDS WORK";
  return { trigger, punchiness };
}

function extractColdViewerVerdict(block: string): string | null {
  const raw =
    extractMultilineField(block, "Cold[- ]?viewer verdict") ??
    extractMultilineField(block, "Cold[- ]?viewer");
  if (!raw) return null;
  if (/PASSES WITH SURGERY/i.test(raw)) return "PASSES WITH SURGERY";
  if (/\bPASSES\b/i.test(raw)) return "PASSES";
  if (/\bFAILS\b/i.test(raw)) return "FAILS";
  return null;
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

    // New format ratings
    let setupRating = extractRating(block, "Setup");
    let followThroughRating = extractRating(block, "Follow-through");
    let completionRating = extractRating(block, "Completion");
    let legacyFormat = false;

    // Legacy Hook/Value/Close outputs — map onto the new structure so older
    // stored discovery runs still render.
    if (!setupRating && !followThroughRating && !completionRating) {
      const hook = extractRating(block, "Hook");
      const value = extractRating(block, "Value");
      const close = extractRating(block, "Close");
      if (hook || value || close) {
        legacyFormat = true;
        setupRating = hook;
        followThroughRating = value;
        completionRating = close;
      }
    }

    const { trigger, punchiness } = extractEmotionalTrigger(block);

    clips.push({
      number,
      insight,
      linesLabel: lines,
      wordCount,
      durationLabel,
      clipType,
      clipTypeRaw,
      setupRating,
      followThroughRating,
      completionRating,
      emotionalTrigger: trigger,
      punchiness,
      coldViewerVerdict: extractColdViewerVerdict(block),
      legacyFormat,
      surgeryNotes: surgery,
      topicKeywords: topicKw,
      transcriptSegment,
    });
  }

  return { clips, summary };
}
