import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { PipelineRunDetail, getGetPipelineRunQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Copy, Check, ChevronDown, ChevronUp, Download,
  ArrowRight, RefreshCw, Loader2, Send, ExternalLink,
  Eye, ThumbsUp, MessageSquare,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface YouTubeShort {
  title: string; url: string; channel: string; views: number;
  likes: number; comments: number; tags: string[]; description: string; thumbnail: string;
}

interface TranscriptLine { type: "added" | "cut" | "normal"; text: string; }

interface SurgeryParsed {
  intrigue: string; value: string; close: string;
  transcriptLines: TranscriptLine[]; wordCount: string;
}

interface EditorParsed {
  title: string; tags: string; hashtags: string;
  youtubeDescription: string; titleVariations: string;
  linkedin: string; twitter: string; marketingAngle: string;
}

interface TitleVariation {
  angle: string;
  title: string;
  note: string;
}

interface ResearchParsed {
  youtube: string; instagram: string; tiktok: string;
  linkedin: string; twitter: string; crossPlatform: string; thumbnails: string;
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function sliceSection(text: string, startRe: RegExp, endRe: RegExp): string {
  const m = text.match(startRe);
  if (!m || m.index == null) return "";
  const after = text.slice(m.index + m[0].length);
  const end = after.search(endRe);
  return (end === -1 ? after : after.slice(0, end)).trim();
}

function parseSurgery(text: string | null | undefined): SurgeryParsed {
  const t = text || "";
  const intrigue = sliceSection(t, /^###\s*Intrigue/im, /^###|^##/m);
  const value    = sliceSection(t, /^###\s*Value/im,    /^###|^##/m);
  const close    = sliceSection(t, /^###\s*Close/im,    /^###|^##/m);

  const transcriptRaw = sliceSection(t, /^##\s*FINAL REVISED TRANSCRIPT/im, /^##(?!#)/m);
  const lines = transcriptRaw.split("\n");
  const transcriptLines: TranscriptLine[] = [];
  let wordCountLine = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^WORD COUNT:/i.test(trimmed)) { wordCountLine = trimmed; continue; }
    if (/^\[ADDED\]/i.test(trimmed)) {
      transcriptLines.push({ type: "added", text: trimmed.replace(/^\[ADDED\]\s*/i, "") });
    } else if (/^\[CUT\]/i.test(trimmed)) {
      transcriptLines.push({ type: "cut", text: trimmed.replace(/^\[CUT\]\s*/i, "") });
    } else {
      transcriptLines.push({ type: "normal", text: trimmed });
    }
  }

  return { intrigue, value, close, transcriptLines, wordCount: wordCountLine };
}

function findSection(text: string, labels: string[]): string {
  for (const label of labels) {
    const mdMatch = text.match(new RegExp(`^##\\s+${label}\\s*$`, "im"));
    if (mdMatch && mdMatch.index != null) {
      const after = text.slice(mdMatch.index + mdMatch[0].length);
      const next = after.search(/^##\s/im);
      return (next === -1 ? after : after.slice(0, next)).trim();
    }
    const labelRe = label.replace(/[()]/g, "\\$&");
    const inline = text.match(
      new RegExp(`(?:FINAL|REVISED)[^\\n]*?\\b${labelRe}\\b[^:]*:\\s*([\\s\\S]*?)(?=\\n(?:FINAL|REVISED)\\b|$)`, "i")
    );
    if (inline) return inline[1].trim();
  }
  return "";
}

function parseEditor(editorText: string | null | undefined, writerText: string | null | undefined): EditorParsed {
  const editor = editorText || "";
  const writer = writerText || "";

  // Tier 1: search within the ## FINAL CONTENT PACKAGE block (new editor format)
  const pkgMatch = editor.match(/^##\s+FINAL CONTENT PACKAGE\s*$/im);
  const pkg = pkgMatch && pkgMatch.index != null ? editor.slice(pkgMatch.index + pkgMatch[0].length) : "";

  function resolve(labels: string[]): string {
    if (pkg) {
      const v = findSection(pkg, labels);
      if (v) return v;
    }
    // Tier 2: search full editor output (backward compat with old format)
    const v2 = findSection(editor, labels);
    if (v2) return v2;
    // Tier 3: fall back to writer output (always has ## HEADING format)
    return findSection(writer, labels);
  }

  return {
    title:              resolve(["TITLE"]),
    tags:               resolve(["YOUTUBE TAGS", "YOUTUBE_TAGS", "TAGS"]),
    hashtags:           resolve(["INSTAGRAM HASHTAGS", "INSTAGRAM_HASHTAGS", "HASHTAGS"]),
    youtubeDescription: resolve(["YOUTUBE DESCRIPTION"]),
    titleVariations:    resolve(["TITLE VARIATIONS"]),
    linkedin:           resolve(["LINKEDIN POST", "LINKEDIN"]),
    twitter:            resolve(["TWITTER POST", "TWITTER", "TWEET"]),
    marketingAngle:     resolve(["MARKETING ANGLE", "MARKETING_ANGLE"]),
  };
}

function parseTitleVariations(text: string): TitleVariation[] {
  const variations: TitleVariation[] = [];
  if (!text) return variations;
  const lines = text.split("\n");
  let current: Partial<TitleVariation> | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Match numbered entries like "1. (SEO) Title text" or "1. (AEO) Something"
    const headerMatch = line.match(/^\d+\.\s+\(([^)]+)\)\s+(.+)$/);
    if (headerMatch) {
      if (current?.title) variations.push(current as TitleVariation);
      current = { angle: headerMatch[1], title: headerMatch[2], note: "" };
    } else if (current && !current.note) {
      current.note = line;
    }
  }
  if (current?.title) variations.push(current as TitleVariation);
  return variations;
}

function parseResearch(text: string | null | undefined): ResearchParsed {
  const t = text || "";
  return {
    youtube:      sliceSection(t, /^###\s*YouTube Shorts/im, /^###|^##(?!#)/m),
    instagram:    sliceSection(t, /^###\s*Instagram/im,      /^###|^##(?!#)/m),
    tiktok:       sliceSection(t, /^###\s*TikTok/im,         /^###|^##(?!#)/m),
    linkedin:     sliceSection(t, /^###\s*LinkedIn/im,        /^###|^##(?!#)/m),
    twitter:      sliceSection(t, /^###\s*Twitter/im,         /^###|^##(?!#)/m),
    crossPlatform:sliceSection(t, /^###\s*Cross-Platform/im,  /^###|^##(?!#)/m),
    thumbnails:   sliceSection(t, /^###\s*Thumbnail/im,       /^###|^##(?!#)/m),
  };
}

function youtubeThumbnailFromUrl(url: string): string | null {
  const patterns = [
    /youtube\.com\/(?:watch\?v=|shorts\/)([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) return `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
  }
  return null;
}

function parseThumbnailRefs(text: string): Array<{ url: string; note: string }> {
  const refs: Array<{ url: string; note: string }> = [];
  for (const line of text.split("\n")) {
    const urlMatch = line.match(/https?:\/\/\S+/);
    if (!urlMatch) continue;
    const url = urlMatch[0].replace(/[,.)]+$/, "");
    const note = line
      .replace(urlMatch[0], "")
      .replace(/^\s*[\d.)\-–]+\s*/, "")
      .replace(/^["\s–\-:]+|["\s]+$/g, "")
      .trim();
    refs.push({ url, note: note || "Visual reference" });
  }
  return refs;
}

function cleanTranscriptForCopy(lines: TranscriptLine[]): string {
  return lines
    .filter((l) => l.type !== "cut")
    .map((l) => l.text)
    .join("\n");
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

function buildExportMarkdown(run: PipelineRunDetail): string {
  const date = new Date(run.createdAt).toLocaleDateString();
  return [
    `# GrowthStack Content Brief`,
    `Run #${run.id} | ${run.type} ${run.clipType ? `(${run.clipType})` : ""} | ${date}`,
    run.title ? `\n**${run.title}**` : "",
    "\n---\n",
    "## Research Analyst Output",
    run.researchOutput || "_Not available_",
    "\n---\n",
    "## Surgery Analyst Output",
    run.surgeryOutput || "_Not available_",
    "\n---\n",
    "## Final Content Package (Editor)",
    run.editorOutput || "_Not available_",
  ].filter(Boolean).join("\n");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleCopy}>
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function StepCard({
  number, title, subtitle, dimmed = false, children,
}: {
  number: number; title: string; subtitle: string; dimmed?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`relative ${dimmed ? "opacity-90" : ""}`}>
      <div className="flex gap-4">
        <div className="flex flex-col items-center">
          <div className={`h-9 w-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 border-2 ${
            dimmed
              ? "border-border text-muted-foreground bg-muted/30"
              : "border-primary text-primary bg-primary/5"
          }`}>
            {number}
          </div>
          <div className="flex-1 w-[2px] bg-border mt-2 min-h-4" />
        </div>
        <div className="flex-1 pb-8 min-w-0">
          <div className="mb-4">
            <h2 className={`font-semibold text-base leading-tight ${dimmed ? "text-muted-foreground" : "text-foreground"}`}>
              {title}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function SurgerySection({ label, content }: { label: string; content: string }) {
  if (!content) return null;
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{content}</p>
    </div>
  );
}

function TranscriptLineRow({ line }: { line: TranscriptLine }) {
  if (line.type === "added") {
    return (
      <div className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-950/30 border-l-2 border-emerald-400 px-3 py-1.5 rounded-r">
        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase mt-0.5 shrink-0 w-6">ADD</span>
        <span className="text-sm text-emerald-900 dark:text-emerald-100">{line.text}</span>
      </div>
    );
  }
  if (line.type === "cut") {
    return (
      <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/30 border-l-2 border-red-400 px-3 py-1.5 rounded-r">
        <span className="text-[10px] font-bold text-red-500 uppercase mt-0.5 shrink-0 w-6">CUT</span>
        <span className="text-sm text-red-700 dark:text-red-400 line-through">{line.text}</span>
      </div>
    );
  }
  return (
    <div className="px-3 py-1 text-sm text-foreground">
      {line.text}
    </div>
  );
}

function PlatformCard({
  label, content, maxChars, badge,
}: {
  label: string; content: string; maxChars?: number; badge?: React.ReactNode;
}) {
  if (!content) return null;
  const charCount = content.length;
  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
            {badge}
          </div>
          <div className="flex items-center gap-2">
            {maxChars && (
              <span className={`text-xs tabular-nums ${charCount > maxChars ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                {charCount}/{maxChars}
              </span>
            )}
            <CopyButton text={content} />
          </div>
        </div>
        <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{content}</p>
      </CardContent>
    </Card>
  );
}

function PlatformBadge({ children, color }: { children: string; color: string }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${color}`}>{children}</span>
  );
}

function CollapsibleSection({
  number, title, subtitle, children,
}: {
  number: number; title: string; subtitle: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/60 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 border border-border text-muted-foreground bg-muted/40">
          {number}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-muted-foreground">{title}</p>
          <p className="text-xs text-muted-foreground/70">{subtitle}</p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-border/60 p-5">
          {children}
        </div>
      )}
    </div>
  );
}

function YouTubeCard({ short }: { short: YouTubeShort }) {
  return (
    <a
      href={short.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col bg-card border border-border rounded-lg overflow-hidden hover:border-primary/40 hover:shadow-md transition-all"
    >
      <div className="relative aspect-video bg-muted overflow-hidden">
        {short.thumbnail ? (
          <img src={short.thumbnail} alt={short.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No thumbnail</div>
        )}
        <div className="absolute top-1.5 right-1.5 bg-black/70 text-white text-[9px] font-bold px-1 py-0.5 rounded flex items-center gap-0.5">
          <ExternalLink className="h-2 w-2" /> Shorts
        </div>
      </div>
      <div className="p-2.5 flex flex-col gap-1.5 flex-1">
        <p className="text-[11px] font-semibold text-foreground leading-tight line-clamp-2">{short.title}</p>
        <p className="text-[10px] text-muted-foreground">{short.channel}</p>
        <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" />{formatCount(short.views)}</span>
          <span className="flex items-center gap-0.5"><ThumbsUp className="h-2.5 w-2.5" />{formatCount(short.likes)}</span>
        </div>
        {short.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {short.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="text-[9px] bg-muted px-1 py-0.5 rounded text-muted-foreground">{tag}</span>
            ))}
          </div>
        )}
      </div>
    </a>
  );
}

function ThumbnailRefCard({ item, index }: { item: { url: string; note: string }; index: number }) {
  const [imgError, setImgError] = useState(false);
  const [copied, setCopied] = useState(false);

  const ytThumb = youtubeThumbnailFromUrl(item.url);
  const isDirectImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(item.url);
  const imgSrc = ytThumb || (isDirectImage ? item.url : null);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText(item.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col bg-card border border-border rounded-lg overflow-hidden hover:border-primary/40 hover:shadow-md transition-all"
    >
      <div className="relative aspect-video bg-muted overflow-hidden">
        {imgSrc && !imgError ? (
          <img
            src={imgSrc}
            alt={item.note || `Reference ${index + 1}`}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-muted/60 text-muted-foreground px-4">
            <ExternalLink className="h-5 w-5 shrink-0" />
            <span className="text-[9px] text-center break-all line-clamp-3 leading-relaxed">{item.url}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
        <div className="absolute top-1.5 left-1.5 bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
          {index + 1}
        </div>
      </div>
      <div className="p-2.5 flex items-start justify-between gap-2">
        <p className="text-[11px] text-muted-foreground leading-tight flex-1 line-clamp-2">
          {item.note || "Visual reference"}
        </p>
        <button
          onClick={handleCopy}
          className="text-[10px] text-primary hover:underline shrink-0 font-medium"
        >
          {copied ? "Copied!" : "Copy URL"}
        </button>
      </div>
    </a>
  );
}

// ─── Intel parsing helpers ────────────────────────────────────────────────────

interface IntelEntry { headline: string; details: string[]; }
interface PatternEntry { label: string; body: string; }

function parseIntelBullets(text: string): IntelEntry[] {
  if (!text.trim()) return [];

  // Detect the structured format produced by the Task #6 research prompt
  // (Content: / URL: / Why picked: / Analysis: blocks separated by ---)
  if (/^Content:/im.test(text)) {
    const blocks = text.split(/\n-{3,}\n?/);
    const entries: IntelEntry[] = [];

    for (const block of blocks) {
      if (!block.trim()) continue;

      const extractField = (label: string): string => {
        const re = new RegExp(`^${label}:\\s*([\\s\\S]*?)(?=\\n(?:Content|URL|Why picked|Analysis):|\\n-{3,}|$)`, 'im');
        const m = block.match(re);
        return m ? m[1].trim() : '';
      };

      const content   = extractField('Content');
      const url       = extractField('URL');
      const whyPicked = extractField('Why picked');
      const analysis  = extractField('Analysis');

      if (!content && !url) continue;

      const details: string[] = [];
      if (url)       details.push(`URL: ${url}`);
      if (whyPicked) details.push(`Why picked: ${whyPicked}`);
      if (analysis)  details.push(`Analysis: ${analysis}`);

      entries.push({ headline: content || url, details });
    }

    if (entries.length > 0) return entries;
  }

  // Original bullet parser (unchanged)
  const lines = text.split("\n");
  const entries: IntelEntry[] = [];
  let current: IntelEntry | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Top-level bullet: line starts with "- " or "* " with no leading whitespace
    const isTopLevel = /^[-*]\s/.test(raw) && !/^\s+/.test(raw);
    // Indented bullet: leading whitespace then "- " or "* "
    const isSubBullet = /^\s+[-*]\s/.test(raw);

    if (isTopLevel) {
      current = { headline: trimmed.replace(/^[-*]\s+/, ""), details: [] };
      entries.push(current);
    } else if (isSubBullet && current) {
      current.details.push(trimmed.replace(/^[-*]\s+/, ""));
    } else if (current && trimmed) {
      // Continuation line — append to last detail or headline
      if (current.details.length > 0) {
        current.details[current.details.length - 1] += " " + trimmed;
      } else {
        current.headline += " " + trimmed;
      }
    }
  }

  return entries.filter((e) => e.headline.trim());
}

function parseCrossPlatformPatterns(text: string): PatternEntry[] {
  if (!text.trim()) return [];
  const results: PatternEntry[] = [];
  const lines = text.split("\n");
  let current: PatternEntry | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const isTopLevel = /^[-*]\s/.test(raw) && !/^\s+/.test(raw);
    const isSubBullet = /^\s+[-*]\s/.test(raw);

    // Strip markdown bold (**) so "**Hook patterns:**" matches as "Hook patterns:"
    const stripped = trimmed.replace(/\*\*/g, "");
    const labelMatch = stripped.match(/^[-*]?\s*([\w][^:]{2,50}):\s*(.*)$/);

    if (labelMatch && isTopLevel) {
      current = { label: labelMatch[1].trim(), body: labelMatch[2].trim() };
      results.push(current);
    } else if (isSubBullet && current) {
      const subText = trimmed.replace(/^[-*]\s+/, "");
      current.body += current.body ? " " + subText : subText;
    } else if (current && !isTopLevel && trimmed) {
      current.body += " " + trimmed;
    }
  }

  // Keep entries even with empty body — label-only rows are still useful
  return results.filter((e) => e.label);
}

// ─── Intel entry components ───────────────────────────────────────────────────

function IntelEntryCard({ headline, details }: IntelEntry) {
  // Strip markdown bold markers for display
  const clean = (s: string) => s.replace(/\*\*(.*?)\*\*/g, "$1");
  return (
    <div className="border border-border/60 rounded-md px-3.5 py-3 bg-card">
      <p className="text-sm font-medium text-foreground leading-snug">{clean(headline)}</p>
      {details.length > 0 && (
        <ul className="mt-2 space-y-1">
          {details.map((d, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="mt-[5px] h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
              <span className="leading-relaxed">{clean(d)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


const PATTERN_COLORS: Record<string, string> = {
  hook: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400",
  titl: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400",
  tag:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-400",
  clos: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-400",
  thum: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-400",
};

function PatternRow({ label, body }: PatternEntry) {
  // Use the first word to derive the color key ("Tag and hashtag..." → "tag")
  const key = label.toLowerCase().split(/\s+/)[0].slice(0, 4);
  const color = PATTERN_COLORS[key] || "bg-muted text-muted-foreground";
  const shortLabel = label.split(/\s+/).slice(0, 2).join(" ");
  return (
    <div className="flex items-start gap-3 border border-border/60 rounded-md px-3.5 py-3 bg-card">
      <span className={`text-[9px] font-bold px-2 py-0.5 rounded shrink-0 mt-0.5 uppercase tracking-wide whitespace-nowrap ${color}`}>
        {shortLabel}
      </span>
      {body ? (
        <p className="text-sm text-foreground leading-relaxed">{body}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">No detail captured.</p>
      )}
    </div>
  );
}

// ─── Competitive platform accordion ──────────────────────────────────────────

function CompetitivePlatform({
  label, color, content, youtubeShorts, isCrossPlatform,
}: {
  label: string; color: string; content: string;
  youtubeShorts?: YouTubeShort[] | null; isCrossPlatform?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasContent = content.trim() || (youtubeShorts && youtubeShorts.length > 0);
  if (!hasContent) return null;

  const intelEntries   = !isCrossPlatform ? parseIntelBullets(content) : [];
  const patternEntries = isCrossPlatform ? parseCrossPlatformPatterns(content) : [];

  return (
    <div className="border border-border/50 rounded-md overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
      >
        <PlatformBadge color={color}>{label}</PlatformBadge>
        <span className="text-sm font-medium text-foreground flex-1">
          {label === "YT" ? "YouTube Shorts" :
           label === "IG" ? "Instagram Reels" :
           label === "TK" ? "TikTok" :
           label === "LI" ? "LinkedIn Posts" :
           label === "X"  ? "Twitter / X" : "Cross-Platform Patterns"}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border/50 p-4 space-y-2">
          {/* YouTube API cards (always shown first for YT) */}
          {youtubeShorts && youtubeShorts.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-1">
              {youtubeShorts.map((s) => <YouTubeCard key={s.url} short={s} />)}
            </div>
          )}
          {/* Cross-platform patterns: labelled pattern rows */}
          {isCrossPlatform && patternEntries.length > 0 && (
            <div className="space-y-2">
              {patternEntries.map((p, i) => <PatternRow key={i} {...p} />)}
            </div>
          )}
          {/* Platform-specific entries: intel cards */}
          {!isCrossPlatform && intelEntries.length > 0 && (
            <div className="space-y-2">
              {intelEntries.map((e, i) => <IntelEntryCard key={i} {...e} />)}
            </div>
          )}
          {/* Fallback: raw text if parsing produced nothing */}
          {content && !isCrossPlatform && intelEntries.length === 0 && (
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{content}</p>
          )}
          {content && isCrossPlatform && patternEntries.length === 0 && (
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{content}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface ClipResultsProps {
  run: PipelineRunDetail;
  runId: number;
  isProcessing: boolean;
}

export default function ClipResults({ run, runId, isProcessing }: ClipResultsProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [feedbackText, setFeedbackText] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  const surgery  = parseSurgery(run.surgeryOutput);
  const editor   = parseEditor(run.editorOutput, run.writerOutput);
  const research = parseResearch(run.researchOutput);
  const thumbnailRefs = parseThumbnailRefs(research.thumbnails);

  const youtubeShorts: YouTubeShort[] | null = (() => {
    try { return run.youtubeData ? JSON.parse(run.youtubeData) : null; }
    catch { return null; }
  })();

  const isHorizontal = run.clipType === "horizontal";

  // Feedback submission
  const submitFeedback = async () => {
    if (!feedbackText.trim() || !run.editorOutput) return;
    setIsSubmittingFeedback(true);
    try {
      const res = await fetch(`/api/pipeline/runs/${runId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetOutput: run.editorOutput, feedback: feedbackText }),
      });
      if (!res.ok) throw new Error("Feedback failed");
      toast({ title: "Revision requested", description: "The Editor is revising your content..." });
      setFeedbackText("");
      queryClient.invalidateQueries({ queryKey: getGetPipelineRunQueryKey(runId) });
    } catch {
      toast({ title: "Error", description: "Failed to submit feedback.", variant: "destructive" });
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  // Export full brief
  const exportBrief = () => {
    const md = buildExportMarkdown(run);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `growthstack-brief-${runId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Loading state
  if (isProcessing || !run.editorOutput) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <RefreshCw className="h-8 w-8 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Pipeline is running — results will appear here when complete.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">

      {/* ── Step 1: Edit your clip ── */}
      <StepCard number={1} title="Edit your clip in Riverside" subtitle="What to add, cut, and rearrange">
        <div className="space-y-4">
          {/* Surgery assessment sections */}
          {(surgery.intrigue || surgery.value || surgery.close) ? (
            <Card className="border-border/60 shadow-sm">
              <CardContent className="p-5 space-y-4">
                <SurgerySection label="Opening (Intrigue)" content={surgery.intrigue} />
                {surgery.intrigue && surgery.value && <Separator />}
                <SurgerySection label="Middle (Value)" content={surgery.value} />
                {surgery.value && surgery.close && <Separator />}
                <SurgerySection label="Ending (Close)" content={surgery.close} />
              </CardContent>
            </Card>
          ) : (
            !run.surgeryOutput && (
              <p className="text-sm text-muted-foreground italic">Surgery analysis not yet available.</p>
            )
          )}

          {/* Revised transcript */}
          {surgery.transcriptLines.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revised Transcript</p>
                <CopyButton text={cleanTranscriptForCopy(surgery.transcriptLines)} label="Copy clean version" />
              </div>
              <div className="border border-border/60 rounded-lg overflow-hidden space-y-px bg-muted/10">
                {surgery.transcriptLines.map((line, i) => (
                  <TranscriptLineRow key={i} line={line} />
                ))}
              </div>
              {surgery.wordCount && (
                <p className="text-xs text-muted-foreground mt-2 text-right">{surgery.wordCount}</p>
              )}
            </div>
          )}

          {/* Fallback: show raw surgery output if parsing found nothing */}
          {!surgery.intrigue && !surgery.value && !surgery.close && surgery.transcriptLines.length === 0 && run.surgeryOutput && (
            <Card className="border-border/60 shadow-sm">
              <CardContent className="p-5">
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{run.surgeryOutput}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </StepCard>

      {/* ── Step 2: Copy and publish ── */}
      <StepCard number={2} title="Copy and publish" subtitle="Paste directly into each platform">
        <div className="space-y-3">
          {/* Title */}
          {editor.title && (
            <Card className="border-border/60 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Title</p>
                    <p className="text-xl font-bold text-foreground leading-tight">{editor.title}</p>
                    <p className={`text-xs mt-1 ${editor.title.length > 80 ? "text-destructive" : "text-muted-foreground"}`}>
                      {editor.title.length} chars {editor.title.length <= 60 ? "(under 60 ✓)" : editor.title.length <= 80 ? "(60-80)" : "(over 80 limit)"}
                    </p>
                  </div>
                  <CopyButton text={editor.title} />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Title Variations */}
          {editor.titleVariations && (() => {
            const variations = parseTitleVariations(editor.titleVariations);
            if (variations.length === 0) return (
              <PlatformCard
                label="Title Variations"
                badge={<PlatformBadge color="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">YT</PlatformBadge>}
                content={editor.titleVariations}
              />
            );
            return (
              <Card className="border-border/60 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Title Variations</span>
                      <PlatformBadge color="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">YT</PlatformBadge>
                    </div>
                    <CopyButton text={editor.titleVariations} label="Copy all" />
                  </div>
                  <div className="space-y-2">
                    {variations.map((v, i) => (
                      <div key={i} className="flex items-start gap-3 group">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-1 w-4 shrink-0 text-right">{i + 1}.</span>
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-1 w-16 shrink-0">{v.angle}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground leading-snug">{v.title}</p>
                          {v.note && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{v.note}</p>}
                          <p className={`text-[10px] mt-0.5 ${v.title.length > 80 ? "text-destructive" : "text-muted-foreground"}`}>
                            {v.title.length} chars
                          </p>
                        </div>
                        <CopyButton text={v.title} />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* YouTube Tags */}
          <PlatformCard
            label="YouTube Tags"
            badge={<PlatformBadge color="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">YT</PlatformBadge>}
            content={editor.tags}
          />

          {/* YouTube Description */}
          <PlatformCard
            label="YouTube Description"
            badge={<PlatformBadge color="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">YT</PlatformBadge>}
            content={editor.youtubeDescription}
          />

          {/* Instagram Hashtags */}
          <PlatformCard
            label="Instagram Hashtags"
            badge={<PlatformBadge color="bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-400">IG</PlatformBadge>}
            content={editor.hashtags}
          />

          {/* LinkedIn Post (horizontal only) */}
          {isHorizontal && (
            <PlatformCard
              label="LinkedIn Post (Arnav)"
              badge={<PlatformBadge color="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">LI</PlatformBadge>}
              content={editor.linkedin}
            />
          )}

          {/* Twitter Post (horizontal only) */}
          {isHorizontal && (
            <PlatformCard
              label="Twitter (GrowthStack)"
              badge={<PlatformBadge color="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">X</PlatformBadge>}
              content={editor.twitter}
              maxChars={220}
            />
          )}

          {/* Show raw editor output if nothing parsed */}
          {!editor.title && !editor.tags && !editor.hashtags && run.editorOutput && (
            <Card className="border-border/60 shadow-sm">
              <CardContent className="p-5">
                <div className="flex justify-end mb-3">
                  <CopyButton text={run.editorOutput} label="Copy all" />
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{run.editorOutput}</p>
              </CardContent>
            </Card>
          )}

          {/* Feedback section */}
          <div className="mt-4 pt-4 border-t border-border/60">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Request a revision</p>
            <Textarea
              placeholder='e.g. "Twitter hook too weak, make it more confrontational"'
              className="min-h-[80px] text-sm resize-y mb-2 bg-background"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                className="gap-2"
                onClick={submitFeedback}
                disabled={!feedbackText.trim() || isSubmittingFeedback}
              >
                {isSubmittingFeedback ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                {isSubmittingFeedback ? "Revising..." : "Revise"}
              </Button>
            </div>
          </div>
        </div>
      </StepCard>

      {/* ── Step 3: Send to designer ── */}
      {thumbnailRefs.length > 0 && (
        <StepCard number={3} title="Send to your designer" subtitle="Thumbnail and visual references">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {thumbnailRefs.map((ref, i) => (
              <ThumbnailRefCard key={i} item={ref} index={i} />
            ))}
          </div>
        </StepCard>
      )}

      {/* Spacer before collapsibles */}
      <div className="pb-2" />

      {/* ── Step 4: Competitive intel (collapsible) ── */}
      <CollapsibleSection
        number={thumbnailRefs.length > 0 ? 4 : 3}
        title="Competitive intel"
        subtitle="What's performing on each platform for this topic"
      >
        <div className="space-y-2">
          <CompetitivePlatform
            label="YT"
            color="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
            content={research.youtube}
            youtubeShorts={youtubeShorts}
          />
          <CompetitivePlatform
            label="IG"
            color="bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-400"
            content={research.instagram}
          />
          <CompetitivePlatform
            label="TK"
            color="bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400"
            content={research.tiktok}
          />
          <CompetitivePlatform
            label="LI"
            color="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
            content={research.linkedin}
          />
          <CompetitivePlatform
            label="X"
            color="bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
            content={research.twitter}
          />
          <CompetitivePlatform
            label="ALL"
            color="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
            content={research.crossPlatform}
            isCrossPlatform
          />
          {!research.youtube && !research.instagram && !research.tiktok && !research.linkedin && !research.twitter && !research.crossPlatform && run.researchOutput && (
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{run.researchOutput}</p>
          )}
        </div>
      </CollapsibleSection>

      {/* ── Step 5: Marketing angle (collapsible) ── */}
      {(editor.marketingAngle || run.editorOutput) && (
        <CollapsibleSection
          number={thumbnailRefs.length > 0 ? 5 : 4}
          title="Marketing angle"
          subtitle="Strategic positioning for this clip"
        >
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {editor.marketingAngle || "Marketing angle not found in Editor output."}
          </p>
        </CollapsibleSection>
      )}

      {/* ── Bottom action bar ── */}
      <div className="flex items-center justify-between pt-6 pb-2 mt-4 border-t border-border/60">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              sessionStorage.setItem("gs_episode_transcript", run.episodeTranscript);
              setLocation("/new");
            }}
          >
            <ArrowRight className="h-3.5 w-3.5" />
            Next Clip
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => {
              sessionStorage.removeItem("gs_episode_transcript");
              setLocation("/new");
            }}
          >
            New Episode
          </Button>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={exportBrief}>
          <Download className="h-3.5 w-3.5" />
          Export Full Brief
        </Button>
      </div>
    </div>
  );
}
