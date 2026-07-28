import { useGetConstraintHistory } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, TrendingUp } from "lucide-react";

interface Props {
  episodeId?: number;
  topic?: string;
  clipType?: "vertical" | "horizontal";
}

function PatternList({
  label,
  items,
}: {
  label: string;
  items: { value: string; count: number }[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.slice(0, 6).map((item, i) => (
          <Badge
            key={i}
            variant="secondary"
            className="text-xs font-normal gap-1 max-w-full"
          >
            <span className="truncate" title={item.value}>
              {item.value.length > 60 ? item.value.slice(0, 57) + "…" : item.value}
            </span>
            <span className="text-muted-foreground tabular-nums">×{item.count}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}

export default function ConstraintHistoryPanel({ episodeId, topic, clipType }: Props) {
  const params: Record<string, string | number> = { limit: 20 };
  if (typeof episodeId === "number") params.episodeId = episodeId;
  if (topic) params.topic = topic;
  if (clipType) params.clipType = clipType;

  const { data, isLoading, isError } = useGetConstraintHistory(params);

  if (isLoading || isError || !data || data.totalRuns === 0) return null;

  const p = data.patterns;
  const hasAny =
    p.titleVerbRules.length > 0 ||
    p.titleFramingRules.length > 0 ||
    p.hookPatterns.length > 0 ||
    p.topTags.length > 0 ||
    p.topHashtags.length > 0 ||
    p.linkedinHookFormats.length > 0;

  if (!hasAny) return null;

  // Dominant topic cluster across returned rows (e.g. "growth") — used to
  // personalize the header when past clips have been tagged.
  const clusterCounts = new Map<string, number>();
  for (const row of data.rows) {
    const c = row.topicCluster?.trim();
    if (c) clusterCounts.set(c, (clusterCounts.get(c) ?? 0) + 1);
  }
  const dominantCluster =
    Array.from(clusterCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    null;

  return (
    <Card className="border-border/50 shadow-sm bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <CardTitle className="text-base flex items-center gap-2">
            {dominantCluster
              ? `What's worked for ${dominantCluster} clips`
              : "What's worked for similar clips"}
            <span className="text-xs font-normal text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {data.totalRuns} past {data.totalRuns === 1 ? "run" : "runs"}
            </span>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <PatternList label="Title verb rules" items={p.titleVerbRules} />
        <PatternList label="Title framing patterns" items={p.titleFramingRules} />
        <PatternList label="Hook patterns" items={p.hookPatterns} />
        <PatternList label="Tags that repeat" items={p.topTags} />
        <PatternList label="Hashtags that repeat" items={p.topHashtags} />
        <PatternList label="LinkedIn hook formats" items={p.linkedinHookFormats} />
        <p className="text-xs text-muted-foreground pt-1 border-t border-border/40">
          Patterns auto-extracted from prior clip runs. The Research Analyst
          receives this context on every new clip.
        </p>
      </CardContent>
    </Card>
  );
}
