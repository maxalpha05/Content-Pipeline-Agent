import { describe, it, expect } from "vitest";
import {
  formatEditorBrief,
  formatRawDiscoveryBrief,
  formatSingleClipBrief,
  slugifyFilename,
} from "./formatClipBrief";
import type { ParsedDiscoveryClip } from "./parseDiscovery";

const meta = {
  episodeName: "Scaling B2B SaaS",
  guestName: "Jane Doe",
  exportDate: new Date("2026-07-13T12:00:00Z"),
};

const clip: ParsedDiscoveryClip = {
  number: 2,
  insight: "Why founders should niche down",
  linesLabel: "120-158",
  wordCount: "185 words",
  durationLabel: "~72 seconds",
  clipType: "vertical",
  clipTypeRaw: "Vertical (YouTube Shorts / Instagram Reels)",
  hookRating: "STRONG",
  valueRating: "NEEDS WORK",
  closeRating: null,
  surgeryNotes: "Cut the first two sentences.\nKeep the pause at line 130.",
  topicKeywords: "niche down, b2b saas, positioning",
  transcriptSegment: "  Speaker A: So here's the thing...  \n\nSpeaker B: right.  ",
};

describe("formatEditorBrief", () => {
  it("includes header metadata and all clip details", () => {
    const out = formatEditorBrief(meta, [clip], "## DISCOVERY SUMMARY\nGood episode.");
    expect(out).toContain("CLIP CUTTING BRIEF — FOR VIDEO EDITOR");
    expect(out).toContain("Episode:     Scaling B2B SaaS");
    expect(out).toContain("Guest:       Jane Doe");
    expect(out).toContain("Total clips: 1");
    expect(out).toContain("CLIP 2: Why founders should niche down");
    expect(out).toContain("Vertical (YouTube Shorts / Instagram Reels)");
    expect(out).toContain("Lines:              120-158");
    expect(out).toContain("Word count:         185 words");
    expect(out).toContain("Estimated duration: ~72 seconds");
    expect(out).toContain("Hook:  Strong");
    expect(out).toContain("Value: Needs work");
    expect(out).toContain("Close: Not rated");
    expect(out).toContain("Cut the first two sentences.\nKeep the pause at line 130.");
    expect(out).toContain("niche down, b2b saas, positioning");
    expect(out).toContain("DISCOVERY SUMMARY");
    expect(out).toContain("Good episode.");
  });

  it("preserves the transcript segment verbatim (no trimming)", () => {
    const out = formatEditorBrief(meta, [clip], null);
    expect(out).toContain(
      "  Speaker A: So here's the thing...  \n\nSpeaker B: right.  ",
    );
  });

  it("handles missing optional fields gracefully", () => {
    const bare: ParsedDiscoveryClip = {
      ...clip,
      linesLabel: null,
      wordCount: null,
      durationLabel: null,
      hookRating: null,
      valueRating: null,
      closeRating: null,
      surgeryNotes: null,
      topicKeywords: null,
      transcriptSegment: "",
    };
    const out = formatEditorBrief(meta, [bare], null);
    expect(out).toContain("Lines:              Not specified");
    expect(out).toContain("SURGERY NOTES (what to cut / keep)\nNone provided");
    expect(out).toContain("No transcript segment available");
    expect(out).not.toContain("DISCOVERY SUMMARY");
  });
});

describe("formatRawDiscoveryBrief", () => {
  it("includes metadata, a parse-failure note, and the raw output verbatim", () => {
    const raw = "  Some unstructured discovery text\nwith lines  ";
    const out = formatRawDiscoveryBrief(meta, raw);
    expect(out).toContain("CLIP CUTTING BRIEF — FOR VIDEO EDITOR");
    expect(out).toContain("Episode:  Scaling B2B SaaS");
    expect(out).toContain("structured clip parsing was unavailable");
    expect(out).toContain(raw);
  });
});

describe("formatSingleClipBrief", () => {
  it("includes episode metadata and the clip section", () => {
    const out = formatSingleClipBrief(meta, clip);
    expect(out).toContain("Episode: Scaling B2B SaaS");
    expect(out).toContain("CLIP 2: Why founders should niche down");
  });
});

describe("slugifyFilename", () => {
  it("slugifies episode names", () => {
    expect(slugifyFilename("Scaling B2B SaaS — with Jane!")).toBe(
      "scaling-b2b-saas-with-jane",
    );
  });

  it("falls back for empty or symbol-only names", () => {
    expect(slugifyFilename("###")).toBe("episode");
  });
});
