import { useListEpisodes, useListPipelineRuns } from "@workspace/api-client-react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Link } from "wouter";
import { PlusCircle, Mic, ArrowRight, FileText, Clock, Archive } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

function getStatusBadge(status: string) {
  if (status === "archived") {
    return (
      <Badge variant="outline" className="text-muted-foreground gap-1 text-xs">
        <Archive className="h-3 w-3" /> Archived
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-200 text-xs">
      Active
    </Badge>
  );
}

function getPipelineStatusBadge(status: string) {
  switch (status) {
    case "approved":
      return <Badge variant="default" className="bg-emerald-500/15 text-emerald-700 border-emerald-200 text-xs">Approved</Badge>;
    case "failed":
      return <Badge variant="destructive" className="text-xs">Failed</Badge>;
    case "review":
      return <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 border-amber-200 text-xs">Review</Badge>;
    case "pending":
      return <Badge variant="outline" className="text-muted-foreground text-xs">Pending</Badge>;
    default:
      return <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-xs">Processing</Badge>;
  }
}

export default function Dashboard() {
  const { data: episodes, isLoading: episodesLoading } = useListEpisodes();
  const { data: allRuns, isLoading: runsLoading } = useListPipelineRuns();

  const legacyRuns = (allRuns ?? []).filter((r) => !r.episodeId);

  return (
    <AppLayout>
      <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Episodes</h1>
            <p className="text-muted-foreground mt-1">Paste once, repurpose forever.</p>
          </div>
          <Link href="/episodes/new">
            <Button className="shrink-0 gap-2">
              <PlusCircle className="h-4 w-4" />
              New Episode
            </Button>
          </Link>
        </div>

        <div className="space-y-3">
          {episodesLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="border-border/50 shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <Skeleton className="h-8 w-8" />
                  </div>
                </CardContent>
              </Card>
            ))
          ) : episodes?.length === 0 ? (
            <Card className="border-border/50 shadow-sm border-dashed">
              <CardContent className="p-12 flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Mic className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-1">No episodes yet</h3>
                <p className="text-muted-foreground text-sm max-w-xs mb-6">
                  Create your first episode to start repurposing your podcast content into clips, newsletters, and social posts.
                </p>
                <Link href="/episodes/new">
                  <Button className="gap-2">
                    <PlusCircle className="h-4 w-4" />
                    Create First Episode
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            episodes?.map((episode) => (
              <Link key={episode.id} href={`/episodes/${episode.id}`}>
                <Card className="border-border/50 shadow-sm hover:border-primary/30 hover:shadow-md transition-all cursor-pointer group">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-start gap-4 min-w-0">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <Mic className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-foreground truncate">
                              {episode.episodeName}
                            </h3>
                            {getStatusBadge(episode.status)}
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            with {episode.guestName}
                          </p>
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {episode.clipCount} {episode.clipCount === 1 ? "clip" : "clips"}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {format(new Date(episode.updatedAt), "MMM d, yyyy")}
                            </span>
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </div>

        {!runsLoading && legacyRuns.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-muted-foreground">Legacy Runs</h2>
              <Badge variant="outline" className="text-xs text-muted-foreground">
                {legacyRuns.length}
              </Badge>
            </div>
            <Card className="border-border/50 shadow-sm">
              <div className="divide-y divide-border/40">
                {legacyRuns.map((run) => (
                  <Link key={run.id} href={`/runs/${run.id}`}>
                    <div className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors cursor-pointer group">
                      <div className="flex items-center gap-3 min-w-0">
                        {getPipelineStatusBadge(run.status)}
                        <span className="text-sm text-foreground truncate">
                          {run.title || `Run #${run.id} — ${run.type} ${run.clipType ? `(${run.clipType})` : ""}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-muted-foreground hidden sm:block">
                          {format(new Date(run.createdAt), "MMM d, h:mm a")}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
