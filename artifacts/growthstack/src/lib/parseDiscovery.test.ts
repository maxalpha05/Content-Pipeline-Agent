import { describe, it, expect } from "vitest";
import { parseDiscoveryOutput } from "./parseDiscovery";

const WELL_FORMED = `## CLIP 1: Why most SaaS onboarding fails in week one
**Lines:** 142 to 198
**Estimated duration:** 175 words (~70 seconds)
**Clip type:** VERTICAL (under 60 sec, single tight insight, strong standalone hook)

**Hook assessment:**
"90% of churn happens before users hit value." STRONG

**Value assessment:**
Guest walks through the 3-step activation loop. STRONG

**Close assessment:**
"Fix week one and you fix the funnel." STRONG

**Surgery notes:**
Trim the 10s lead-in. Cut filler "you know" at line 165.
Consider tightening the middle beat.

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

**Hook assessment:**
"Founders price for themselves, not the market." NEEDS WORK

**Value assessment:**
Concrete tiering example with numbers. STRONG

**Close assessment:**
Lands on a clear takeaway. STRONG

**Surgery notes:**
Keep the host reaction at line 455 — adds energy.

**Topic keywords:** pricing, tiering, founder mistakes

**Transcript segment:**
\`\`\`
410: Most founders get pricing wrong because...
470: ...and that's the lesson.
\`\`\`

---

## DISCOVERY SUMMARY
- Total clips found: 2
- Strongest overall: Clip 1 — clearest hook + close
- Most likely to perform on YouTube Shorts: Clip 1
- Most likely to perform on LinkedIn: Clip 2
- Topic clusters covered: onboarding, pricing
`;

describe("parseDiscoveryOutput", () => {
  it("parses the documented CLIP block format end-to-end", () => {
    const { clips, summary } = parseDiscoveryOutput(WELL_FORMED);

    expect(clips).toHaveLength(2);

    const c1 = clips[0];
    expect(c1.number).toBe(1);
    expect(c1.insight).toBe("Why most SaaS onboarding fails in week one");
    expect(c1.linesLabel).toBe("142 to 198");
    expect(c1.wordCount).toBe("175 words");
    expect(c1.durationLabel).toMatch(/70\s*sec/i);
    expect(c1.clipType).toBe("vertical");
    expect(c1.clipTypeRaw).toMatch(/^VERTICAL/);
    expect(c1.hookRating).toBe("STRONG");
    expect(c1.valueRating).toBe("STRONG");
    expect(c1.closeRating).toBe("STRONG");
    expect(c1.topicKeywords).toBe("saas onboarding, activation, week-one churn");
    expect(c1.surgeryNotes).toMatch(/Trim the 10s lead-in/);
    expect(c1.transcriptSegment).toContain("142: So here's the thing");
    expect(c1.transcriptSegment).toContain("198: ...and that's how you fix it.");

    const c2 = clips[1];
    expect(c2.number).toBe(2);
    expect(c2.clipType).toBe("horizontal");
    expect(c2.hookRating).toBe("NEEDS WORK");
    expect(c2.topicKeywords).toBe("pricing, tiering, founder mistakes");

    expect(summary).toContain("## DISCOVERY SUMMARY");
    expect(summary).toContain("Total clips found: 2");
  });

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
    expect(clips[0].insight).toBe("Bare-bones clip with only required header");
    expect(clips[0].linesLabel).toBeNull();
    expect(clips[0].wordCount).toBeNull();
    expect(clips[0].topicKeywords).toBeNull();
    expect(clips[0].transcriptSegment).toBe("");
    expect(clips[0].clipType).toBe("vertical");
  });
});
