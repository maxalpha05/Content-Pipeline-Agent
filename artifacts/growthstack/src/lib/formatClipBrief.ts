import type { ParsedDiscoveryClip } from "@/lib/parseDiscovery";

export interface EpisodeBriefMeta {
  episodeName: string;
  guestName: string;
  exportDate: Date;
}

const DIVIDER = "=".repeat(70);
const SUBDIVIDER = "-".repeat(70);

function ratingLabel(rating: string | null): string {
  if (!rating) return "Not rated";
  return rating === "STRONG" ? "Strong" : "Needs work";
}

export function formatClipSection(clip: ParsedDiscoveryClip): string {
  const lines: string[] = [];
  lines.push(DIVIDER);
  lines.push(`CLIP ${clip.number}: ${clip.insight}`);
  lines.push(DIVIDER);
  lines.push("");
  lines.push(`Clip type:          ${clip.clipTypeRaw || clip.clipType}`);
  lines.push(`Lines:              ${clip.linesLabel ?? "Not specified"}`);
  lines.push(`Word count:         ${clip.wordCount ?? "Not specified"}`);
  lines.push(`Estimated duration: ${clip.durationLabel ?? "Not specified"}`);
  lines.push("");
  lines.push("RATINGS");
  if (clip.legacyFormat) {
    lines.push(`  Hook:  ${ratingLabel(clip.setupRating)}`);
    lines.push(`  Value: ${ratingLabel(clip.followThroughRating)}`);
    lines.push(`  Close: ${ratingLabel(clip.completionRating)}`);
  } else {
    lines.push(`  Setup:          ${ratingLabel(clip.setupRating)}`);
    lines.push(`  Follow-through: ${ratingLabel(clip.followThroughRating)}`);
    lines.push(`  Completion:     ${ratingLabel(clip.completionRating)}`);
    if (clip.emotionalTrigger) {
      lines.push(
        `  Hook trigger:   ${clip.emotionalTrigger}${clip.punchiness ? ` (${clip.punchiness.toLowerCase()})` : ""}`,
      );
    }
    if (clip.coldViewerVerdict) {
      lines.push(`  Cold viewer:    ${clip.coldViewerVerdict}`);
    }
  }
  lines.push("");
  lines.push("SURGERY NOTES (what to cut / keep)");
  lines.push(clip.surgeryNotes ?? "None provided");
  lines.push("");
  lines.push("TOPIC KEYWORDS");
  lines.push(clip.topicKeywords ?? "None provided");
  lines.push("");
  lines.push("TRANSCRIPT SEGMENT (verbatim)");
  lines.push(SUBDIVIDER);
  lines.push(clip.transcriptSegment || "No transcript segment available");
  lines.push(SUBDIVIDER);
  lines.push("");
  return lines.join("\n");
}

export function formatEditorBrief(
  meta: EpisodeBriefMeta,
  clips: ParsedDiscoveryClip[],
  summary: string | null,
): string {
  const parts: string[] = [];
  parts.push(DIVIDER);
  parts.push("CLIP CUTTING BRIEF — FOR VIDEO EDITOR");
  parts.push(DIVIDER);
  parts.push("");
  parts.push(`Episode:     ${meta.episodeName}`);
  parts.push(`Guest:       ${meta.guestName}`);
  parts.push(`Exported:    ${meta.exportDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`);
  parts.push(`Total clips: ${clips.length}`);
  parts.push("");
  parts.push(
    "Each clip below includes the exact verbatim transcript segment to locate",
  );
  parts.push(
    "in the footage, plus surgery notes describing what to cut or keep.",
  );
  parts.push("");

  for (const clip of clips) {
    parts.push(formatClipSection(clip));
  }

  if (summary) {
    parts.push(DIVIDER);
    parts.push("DISCOVERY SUMMARY");
    parts.push(DIVIDER);
    parts.push("");
    parts.push(summary);
    parts.push("");
  }

  return parts.join("\n");
}

export function formatRawDiscoveryBrief(
  meta: EpisodeBriefMeta,
  rawOutput: string,
): string {
  const parts: string[] = [];
  parts.push(DIVIDER);
  parts.push("CLIP CUTTING BRIEF — FOR VIDEO EDITOR");
  parts.push(DIVIDER);
  parts.push("");
  parts.push(`Episode:  ${meta.episodeName}`);
  parts.push(`Guest:    ${meta.guestName}`);
  parts.push(`Exported: ${meta.exportDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`);
  parts.push("");
  parts.push(
    "Note: structured clip parsing was unavailable for this discovery output.",
  );
  parts.push("The full raw discovery output is included below, verbatim.");
  parts.push("");
  parts.push(SUBDIVIDER);
  parts.push(rawOutput);
  parts.push(SUBDIVIDER);
  parts.push("");
  return parts.join("\n");
}

export function formatSingleClipBrief(
  meta: EpisodeBriefMeta,
  clip: ParsedDiscoveryClip,
): string {
  const parts: string[] = [];
  parts.push(`Episode: ${meta.episodeName}`);
  parts.push(`Guest:   ${meta.guestName}`);
  parts.push(`Exported: ${meta.exportDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`);
  parts.push("");
  parts.push(formatClipSection(clip));
  return parts.join("\n");
}

export function slugifyFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "episode";
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
