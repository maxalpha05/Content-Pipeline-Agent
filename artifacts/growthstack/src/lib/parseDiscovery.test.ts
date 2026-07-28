import { describe, it, expect } from "vitest";
import { parseDiscoveryOutput } from "./parseDiscovery";

const NEW_FORMAT = `## CLIP 1: Why most SaaS onboarding fails in week one
**Lines:** 142 to 198
**Estimated duration:** 175 words (~70 seconds)
**Clip type:** VERTICAL (under 60 sec, single tight insight, strong standalone hook)

**Setup assessment:**
"90% of churn happens before users hit value." Establishes the subject instantly. STRONG

**Emotional trigger:** RISK AVERSION — you're losing customers before they even start. Punchiness: PUNCHY

**Follow-through assessment:**
Guest walks through the 3-step activation loop with no missing beats. STRONG

**Completion assessment:**
"Fix week one and you fix the funnel." STRONG

**Cold-viewer verdict:**
A brand-new viewer fully understands the concept end-to-end. PASSES

**Surgery notes:**
Trim the 10s lead-in. Cut filler "you know" at line 165.

**Topic keywords:** saas onboarding, activation, week-one churn

**Transcript segment:**
\`\`\`
142: So here's the thing about onboarding...
198: ...and that's how you fix it.
\`\`\`

---

## CLIP 2: The pricing mistake every founder makes
**Lines:** 410 to 470
**Estimated duration:** 200 words (~80 seconds)
**Clip type:** HORIZONTAL (60-180 sec, conversational back-and-forth)

**Setup assessment:**
Opens mid-thought; needs the setup line from 405. NEEDS WORK

**Emotional trigger:** CONTRARIAN — challenges standard pricing advice. Punchiness: NEEDS WORK. A sharper stat exists at line 407.

**Follow-through assessment:**
Concrete tiering example with numbers. STRONG

**Completion assessment:**
Lands on a clear takeaway. STRONG

**Cold-viewer verdict:**
Understandable once the setup line is added. PASSES WITH SURGERY

**Surgery notes:**
Add setup line 405. Keep the host reaction at line 455.

**Topic keywords:** pricing, tiering, founder mistakes

**Transcript segment:**
\`\`\`
410: Most founders get pricing wrong because...
470: ...and that's the lesson.
\`\`\`

---

## DISCOVERY SUMMARY
- Total clips found: 2
- Strongest overall: Clip 1 — clearest setup + completion
- Topic clusters covered: onboarding, pricing
`;

const LEGACY_FORMAT = `## CLIP 1: Legacy clip
**Lines:** 10 to 60
**Estimated duration:** 160 words (~65 seconds)
**Clip type:** VERTICAL

**Hook assessment:**
"A big claim." STRONG

**Value assessment:**
Clear insight. STRONG

**Close assessment:**
Trails off a bit. NEEDS WORK

**Topic keywords:** legacy, topics

**Transcript segment:**
\`\`\`
10: Legacy line one
60: Legacy line two
\`\`\`
`;

describe("parseDiscoveryOutput (new format)", () => {
  it("parses setup/follow-through/completion, trigger, punchiness, and verdict", () => {
    const { clips, summary } = parseDiscoveryOutput(NEW_FORMAT);

    expect(clips).toHaveLength(2);

    const c1 = clips[0];
    expect(c1.number).toBe(1);
    expect(c1.insight).toBe("Why most SaaS onboarding fails in week one");
    expect(c1.linesLabel).toBe("142 to 198");
    expect(c1.wordCount).toBe("175 words");
    expect(c1.clipType).toBe("vertical");
    expect(c1.setupRating).toBe("STRONG");
    expect(c1.followThroughRating).toBe("STRONG");
    expect(c1.completionRating).toBe("STRONG");
    expect(c1.emotionalTrigger).toBe("RISK AVERSION");
    expect(c1.punchiness).toBe("PUNCHY");
    expect(c1.coldViewerVerdict).toBe("PASSES");
    expect(c1.legacyFormat).toBe(false);
    expect(c1.surgeryNotes).toMatch(/Trim the 10s lead-in/);
    expect(c1.transcriptSegment).toContain("142: So here's the thing");

    const c2 = clips[1];
    expect(c2.clipType).toBe("horizontal");
    expect(c2.setupRating).toBe("NEEDS WORK");
    expect(c2.emotionalTrigger).toBe("CONTRARIAN");
    expect(c2.punchiness).toBe("NEEDS WORK");
    expect(c2.coldViewerVerdict).toBe("PASSES WITH SURGERY");
    expect(c2.topicKeywords).toBe("pricing, tiering, founder mistakes");

    expect(summary).toContain("## DISCOVERY SUMMARY");
    expect(summary).toContain("Total clips found: 2");
  });
});

describe("parseDiscoveryOutput (legacy backward compatibility)", () => {
  it("maps legacy Hook/Value/Close ratings onto the new fields", () => {
    const { clips } = parseDiscoveryOutput(LEGACY_FORMAT);
    expect(clips).toHaveLength(1);
    const c = clips[0];
    expect(c.legacyFormat).toBe(true);
    expect(c.setupRating).toBe("STRONG");
    expect(c.followThroughRating).toBe("STRONG");
    expect(c.completionRating).toBe("NEEDS WORK");
    expect(c.emotionalTrigger).toBeNull();
    expect(c.punchiness).toBeNull();
    expect(c.coldViewerVerdict).toBeNull();
  });
});

describe("parseDiscoveryOutput (edge cases)", () => {
  it("returns empty clips and null summary for malformed/empty input", () => {
    expect(parseDiscoveryOutput("")).toEqual({ clips: [], summary: null });
    expect(parseDiscoveryOutput("   \n  \n")).toEqual({
      clips: [],
      summary: null,
    });

    const malformed = `Some pre-amble that doesn't follow the format.

The model returned prose instead of CLIP blocks. No headings, no fields.
Just a few sentences explaining why it couldn't comply.`;

    const parsed = parseDiscoveryOutput(malformed);
    expect(parsed.clips).toEqual([]);
    expect(parsed.summary).toBeNull();
  });

  it("still captures partial clips when optional fields are missing", () => {
    const partial = `## CLIP 1: Bare-bones clip with only required header
some prose follows but none of the labelled fields appear here.
`;
    const { clips } = parseDiscoveryOutput(partial);
    expect(clips).toHaveLength(1);
    expect(clips[0].number).toBe(1);
    expect(clips[0].setupRating).toBeNull();
    expect(clips[0].followThroughRating).toBeNull();
    expect(clips[0].completionRating).toBeNull();
    expect(clips[0].emotionalTrigger).toBeNull();
    expect(clips[0].legacyFormat).toBe(false);
    expect(clips[0].transcriptSegment).toBe("");
    expect(clips[0].clipType).toBe("vertical");
  });
});

import { readinessScore, sortClipsByReadiness, isTopPick, type ParsedDiscoveryClip } from "./parseDiscovery";

function makeClip(overrides: Partial<ParsedDiscoveryClip>): ParsedDiscoveryClip {
  return {
    number: 1,
    insight: "x",
    linesLabel: null,
    wordCount: null,
    durationLabel: null,
    clipType: "vertical",
    clipTypeRaw: "",
    setupRating: null,
    followThroughRating: null,
    completionRating: null,
    emotionalTrigger: null,
    punchiness: null,
    coldViewerVerdict: null,
    legacyFormat: false,
    surgeryNotes: null,
    topicKeywords: null,
    transcriptSegment: "",
    ...overrides,
  };
}

describe("readiness sorting", () => {
  it("orders passes+punchy first, fails last, unknown between surgery and fails", () => {
    const fails = makeClip({ number: 1, coldViewerVerdict: "FAILS" });
    const surgery = makeClip({ number: 2, coldViewerVerdict: "PASSES WITH SURGERY" });
    const passesPunchy = makeClip({ number: 3, coldViewerVerdict: "PASSES", punchiness: "PUNCHY" });
    const passes = makeClip({ number: 4, coldViewerVerdict: "PASSES" });
    const unknown = makeClip({ number: 5 });
    const sorted = sortClipsByReadiness([fails, surgery, passesPunchy, passes, unknown]);
    expect(sorted.map((c) => c.number)).toEqual([3, 4, 2, 5, 1]);
  });

  it("uses strong section ratings as tiebreak and keeps stable order otherwise", () => {
    const a = makeClip({ number: 1, coldViewerVerdict: "PASSES" });
    const b = makeClip({ number: 2, coldViewerVerdict: "PASSES", setupRating: "STRONG" });
    const c = makeClip({ number: 3, coldViewerVerdict: "PASSES" });
    const sorted = sortClipsByReadiness([a, b, c]);
    expect(sorted.map((x) => x.number)).toEqual([2, 1, 3]);
  });

  it("marks top pick only for passes + punchy", () => {
    expect(isTopPick(makeClip({ coldViewerVerdict: "PASSES", punchiness: "PUNCHY" }))).toBe(true);
    expect(isTopPick(makeClip({ coldViewerVerdict: "PASSES" }))).toBe(false);
    expect(isTopPick(makeClip({ coldViewerVerdict: "PASSES WITH SURGERY", punchiness: "PUNCHY" }))).toBe(false);
  });

  it("scores punchiness needs-work as a penalty", () => {
    const punchy = makeClip({ coldViewerVerdict: "PASSES", punchiness: "PUNCHY" });
    const needsWork = makeClip({ coldViewerVerdict: "PASSES", punchiness: "NEEDS WORK" });
    expect(readinessScore(punchy)).toBeGreaterThan(readinessScore(needsWork));
  });
});
