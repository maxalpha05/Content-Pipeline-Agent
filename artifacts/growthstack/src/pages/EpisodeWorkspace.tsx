import { useState, useRef, useEffect } from "react";
import { useParams, Link, useLocation, useSearch } from "wouter";
import {
  useGetEpisode,
  getGetEpisodeQueryKey,
  getListEpisodesQueryKey,
  useUpdateEpisode,
  useDeleteEpisode,
  useDeletePipelineRun,
  useCreatePipelineRun,
  useDiscoverClips,
  useGetConstraintHistory,
  CreatePipelineRunBodyClipType,
  CreatePipelineRunBodyType,
  EpisodeRunCard,
} from "@workspace/api-client-react";
import ConstraintHistoryPanel from "@/components/ConstraintHistoryPanel";
import { useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  ArrowLeft, MoreHorizontal, Archive, Trash2, FileEdit, FileText,
  Video, Clock, AlertCircle, CheckCircle2, PlayCircle, Loader2,
  Copy, Check, Rocket, ChevronRight, Search, ChevronDown, ChevronUp, RefreshCw,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { parseDiscoveryOutput, type ParsedDiscoveryClip } from "@/lib/parseDiscovery";

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs gap-1.5"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "approved":
      return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200 text-xs">Approved</Badge>;
    case "failed":
      return <Badge variant="destructive" className="text-xs">Failed</Badge>;
    case "review":
      return <Badge className="bg-amber-500/15 text-amber-700 border-amber-200 text-xs">Review</Badge>;
    case "pending":
      return <Badge variant="outline" className="text-muted-foreground text-xs">Pending</Badge>;
    default:
      return <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">Processing</Badge>;
  }
}

function RunStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "approved": return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "failed": return <AlertCircle className="h-4 w-4 text-destructive" />;
    case "review": return <Clock className="h-4 w-4 text-amber-500" />;
    case "pending": return <Clock className="h-4 w-4 text-muted-foreground" />;
    default: return <PlayCircle className="h-4 w-4 text-primary animate-pulse" />;
  }
}


function RatingBadge({ label, rating }: { label: string; rating: string | null }) {
  if (!rating) return null;
  const strong = rating === "STRONG";
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded ${
        strong
          ? "bg-emerald-500/10 text-emerald-700 border border-emerald-200"
          : "bg-amber-500/10 text-amber-700 border border-amber-200"
      }`}
    >
      {label}: {strong ? "Strong" : "Needs work"}
    </span>
  );
}

function PlatformCard({ label, content, maxChars }: { label: string; content: string; maxChars?: number }) {
  if (!content) return null;
  const charCount = content.length;
  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
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

export default function EpisodeWorkspace() {
  const { id } = useParams<{ id: string }>();
  const episodeId = parseInt(id || "0", 10);
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateEpisode = useUpdateEpisode();
  const deleteEpisode = useDeleteEpisode();
  const deleteRun = useDeletePipelineRun();
  const createRun = useCreatePipelineRun();
  const discoverClips = useDiscoverClips();

  const { data: episode, isLoading, isError } = useGetEpisode(episodeId);

  const clipFormRef = useRef<HTMLDivElement>(null);

  const [clipType, setClipType] = useState<"vertical" | "horizontal">("vertical");
  const [clipTranscript, setClipTranscript] = useState("");
  const [clipError, setClipError] = useState("");

  const [showDeleteEpisodeDialog, setShowDeleteEpisodeDialog] = useState(false);
  const [showEditTranscriptDialog, setShowEditTranscriptDialog] = useState(false);
  const [editTranscriptValue, setEditTranscriptValue] = useState("");
  const [deleteRunId, setDeleteRunId] = useState<number | null>(null);

  const [fullEpisodeRunning, setFullEpisodeRunning] = useState(false);
  const [fullEpisodeStage, setFullEpisodeStage] = useState<string>("");

  const [expandedClipIdx, setExpandedClipIdx] = useState<number | null>(null);
  const [suggestedKeywords, setSuggestedKeywords] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("reanalyze") === "true") {
      setClipTranscript("");
      setClipError("");
      setTimeout(() => {
        clipFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
    }
  }, [search]);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppLayout>
    );
  }

  if (isError || !episode) {
    return (
      <AppLayout>
        <div className="p-6 max-w-4xl mx-auto text-center mt-20">
          <h2 className="text-xl font-bold text-destructive mb-2">Episode Not Found</h2>
          <p className="text-muted-foreground mb-6">This episode may have been deleted or doesn't exist.</p>
          <Link href="/"><Button variant="outline">Return to Dashboard</Button></Link>
        </div>
      </AppLayout>
    );
  }

  const wordCount = episode.fullTranscript.trim().split(/\s+/).length;
  const clipRuns = episode.runs.filter((r) => r.type === "clip");

  function handleArchiveToggle() {
    const newStatus = episode!.status === "active" ? "archived" : "active";
    updateEpisode.mutate(
      { id: episodeId, data: { status: newStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEpisodeQueryKey(episodeId) });
          queryClient.invalidateQueries({ queryKey: getListEpisodesQueryKey() });
          toast({ title: newStatus === "archived" ? "Episode archived" : "Episode restored" });
        },
      }
    );
  }

  function handleDeleteEpisode() {
    deleteEpisode.mutate(
      { id: episodeId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEpisodesQueryKey() });
          toast({ title: "Episode deleted" });
          setLocation("/");
        },
        onError: () => {
          toast({ title: "Error", description: "Could not delete episode.", variant: "destructive" });
        },
      }
    );
  }

  function handleOpenEditTranscript() {
    setEditTranscriptValue(episode!.fullTranscript);
    setShowEditTranscriptDialog(true);
  }

  function handleSaveTranscript() {
    updateEpisode.mutate(
      { id: episodeId, data: { fullTranscript: editTranscriptValue } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEpisodeQueryKey(episodeId) });
          setShowEditTranscriptDialog(false);
          toast({ title: "Transcript updated" });
        },
        onError: () => {
          toast({ title: "Error", description: "Could not save transcript.", variant: "destructive" });
        },
      }
    );
  }

  function handleDeleteRun(runId: number) {
    deleteRun.mutate(
      { id: runId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEpisodeQueryKey(episodeId) });
          setDeleteRunId(null);
          toast({ title: "Clip analysis deleted" });
        },
        onError: () => {
          toast({ title: "Error", description: "Could not delete run.", variant: "destructive" });
        },
      }
    );
  }

  function handleSubmitClip() {
    if (clipTranscript.trim().length < 50) {
      setClipError("Clip transcript must be at least 50 characters.");
      return;
    }
    setClipError("");
    createRun.mutate(
      {
        data: {
          type: CreatePipelineRunBodyType.clip,
          clipType: clipType === "vertical"
            ? CreatePipelineRunBodyClipType.vertical
            : CreatePipelineRunBodyClipType.horizontal,
          clipTranscript: suggestedKeywords ? clipTranscript : clipTranscript.trim(),
          episodeId,
          ...(suggestedKeywords ? { suggestedTopicKeywords: suggestedKeywords } : {}),
        },
      },
      {
        onSuccess: (run) => {
          toast({ title: "Clip analysis started" });
          setLocation(`/runs/${run.id}`);
        },
        onError: () => {
          toast({ title: "Error", description: "Could not start clip analysis.", variant: "destructive" });
        },
      }
    );
  }

  function handleDiscoverClips() {
    discoverClips.mutate(
      { id: episodeId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEpisodeQueryKey(episodeId) });
          toast({ title: "Discovery complete" });
        },
        onError: () => {
          toast({
            title: "Discovery failed",
            description: "Could not scan the transcript. Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  }

  function handleAnalyzeDiscoveredClip(clip: ParsedDiscoveryClip) {
    setClipType(clip.clipType);
    setClipTranscript(clip.transcriptSegment);
    setSuggestedKeywords(clip.topicKeywords || null);
    setClipError("");
    setTimeout(() => {
      clipFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  async function handleRunFullEpisode() {
    setFullEpisodeRunning(true);
    setFullEpisodeStage("Starting...");
    try {
      const response = await fetch(`/api/episodes/${episodeId}/full-episode`, { method: "POST" });
      if (!response.ok) {
        throw new Error("Failed to start full episode pipeline");
      }
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response stream");

      let buffer = "";
      let streamComplete = false;
      while (!streamComplete) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.stage) {
              const stageLabels: Record<string, string> = {
                analyzing: "Analyst working...",
                writing: "Writer working...",
                editing: "Editor working...",
                complete: "Done!",
              };
              setFullEpisodeStage(stageLabels[data.stage] ?? data.stage);
            }
            if (data.type === "done" || data.stage === "complete") {
              streamComplete = true;
              break;
            }
          } catch {}
        }
      }
      await queryClient.invalidateQueries({ queryKey: getGetEpisodeQueryKey(episodeId) });
      toast({ title: "Full episode content generated" });
    } catch (err) {
      toast({ title: "Error", description: "Could not generate full episode content.", variant: "destructive" });
    } finally {
      setFullEpisodeRunning(false);
      setFullEpisodeStage("");
    }
  }

  const hasFullEpisodeContent = !!episode.substackArticle;
  // Use dedicated DB fields; these are always parsed from the FINAL CONTENT PACKAGE block
  const substackContent = episode.substackArticle || null;
  const linkedinContent = episode.linkedinPost || null;
  const youtubeContent = episode.youtubeDescription || null;
  const youtubeTagsContent = episode.youtubeTags || null;
  const titleVariationsContent = episode.titleVariations || null;

  return (
    <AppLayout>
      <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-8">
        {/* Top bar */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full shrink-0 mt-0.5">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight text-foreground truncate">
                  {episode.episodeName}
                </h1>
                {episode.status === "archived" && (
                  <Badge variant="outline" className="text-muted-foreground text-xs shrink-0">Archived</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">with {episode.guestName}</p>
              <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                <span>{wordCount.toLocaleString()} words</span>
                <span>{episode.clipCount} {episode.clipCount === 1 ? "clip" : "clips"} analyzed</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-11 sm:ml-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleArchiveToggle}
              disabled={updateEpisode.isPending}
            >
              <Archive className="h-3.5 w-3.5" />
              {episode.status === "active" ? "Archive" : "Restore"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleOpenEditTranscript}>
                  <FileEdit className="h-4 w-4 mr-2" />
                  Edit Transcript
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setShowDeleteEpisodeDialog(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Episode
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Section: Clip Discovery */}
        {(() => {
          const { clips: discoveryClips, summary: discoverySummary } =
            parseDiscoveryOutput(episode.discoveryOutput || "");
          const isDiscovering = discoverClips.isPending;
          const hasDiscovery = !!episode.discoveryOutput;

          if (isDiscovering) {
            return (
              <Card className="shadow-sm border-border/50">
                <CardContent className="p-8 flex flex-col items-center text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary mb-3" />
                  <h3 className="font-medium text-sm mb-1">
                    Scanning transcript for clip-worthy moments...
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    This usually takes 30-60 seconds.
                  </p>
                </CardContent>
              </Card>
            );
          }

          if (!hasDiscovery) {
            return (
              <Card className="shadow-sm border-border/50 border-dashed">
                <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Search className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm mb-0.5">Discover Clips</h3>
                    <p className="text-xs text-muted-foreground">
                      Scan the full transcript to find the 4-6 strongest clip-worthy moments.
                    </p>
                  </div>
                  <Button onClick={handleDiscoverClips} className="gap-2 shrink-0">
                    <Search className="h-4 w-4" />
                    Discover Clips
                  </Button>
                </CardContent>
              </Card>
            );
          }

          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Search className="h-4 w-4 text-primary" />
                  Discovered Clip Moments
                  {discoveryClips.length > 0 && (
                    <span className="text-xs text-muted-foreground font-normal">
                      ({discoveryClips.length})
                    </span>
                  )}
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={handleDiscoverClips}
                  disabled={discoverClips.isPending}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Re-discover
                </Button>
              </div>

              {discoveryClips.length === 0 ? (
                <Card className="border-border/50 shadow-sm">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-2">
                      Could not parse structured clips from the discovery output. Showing raw text:
                    </p>
                    <pre className="text-xs whitespace-pre-wrap font-mono text-foreground/80 max-h-[300px] overflow-y-auto">
                      {episode.discoveryOutput}
                    </pre>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {discoveryClips.map((clip, idx) => {
                    const isExpanded = expandedClipIdx === idx;
                    return (
                      <Card key={idx} className="border-border/50 shadow-sm">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-mono text-muted-foreground mb-0.5">
                                CLIP {clip.number}
                              </div>
                              <h3 className="font-medium text-sm text-foreground leading-snug">
                                {clip.insight}
                              </h3>
                            </div>
                            <span className="text-xs uppercase tracking-wide px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 shrink-0">
                              {clip.clipType}
                            </span>
                          </div>

                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {clip.linesLabel && <span>Lines {clip.linesLabel}</span>}
                            {clip.wordCount && <span>· {clip.wordCount}</span>}
                            {clip.durationLabel && <span>· {clip.durationLabel}</span>}
                          </div>

                          <div className="flex flex-wrap gap-1.5">
                            <RatingBadge label="Hook" rating={clip.hookRating} />
                            <RatingBadge label="Value" rating={clip.valueRating} />
                            <RatingBadge label="Close" rating={clip.closeRating} />
                          </div>

                          {clip.transcriptSegment && !isExpanded && (
                            <p className="text-xs text-foreground/70 font-mono line-clamp-2 leading-relaxed">
                              {clip.transcriptSegment.split("\n").slice(0, 2).join(" ")}
                            </p>
                          )}

                          {isExpanded && (
                            <div className="space-y-3 pt-1">
                              {clip.surgeryNotes && (
                                <div>
                                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                                    Surgery Notes
                                  </div>
                                  <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
                                    {clip.surgeryNotes}
                                  </p>
                                </div>
                              )}
                              {clip.topicKeywords && (
                                <div>
                                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                                    Topic Keywords
                                  </div>
                                  <p className="text-xs text-foreground/80">{clip.topicKeywords}</p>
                                </div>
                              )}
                              <div>
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                                  Full Transcript Segment
                                </div>
                                <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/40 rounded p-3 max-h-[280px] overflow-y-auto border border-border/40 text-foreground/90 leading-relaxed">
                                  {clip.transcriptSegment}
                                </pre>
                              </div>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs gap-1.5"
                              onClick={() => setExpandedClipIdx(isExpanded ? null : idx)}
                            >
                              {isExpanded ? (
                                <><ChevronUp className="h-3 w-3" /> Hide segment</>
                              ) : (
                                <><ChevronDown className="h-3 w-3" /> View full segment</>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1.5"
                              onClick={() => handleAnalyzeDiscoveredClip(clip)}
                              disabled={!clip.transcriptSegment}
                            >
                              <Rocket className="h-3 w-3" />
                              Analyze This Clip
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {discoverySummary && (
                <Card className="border-border/50 shadow-sm bg-muted/20">
                  <CardContent className="p-4">
                    <pre className="text-xs whitespace-pre-wrap font-sans text-foreground/80 leading-relaxed">
                      {discoverySummary}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </div>
          );
        })()}

        {/* Section A: Clip Input */}
        <div ref={clipFormRef}>
        <Card className="shadow-sm border-border/50">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Video className="h-3.5 w-3.5 text-primary" />
              </div>
              <CardTitle className="text-base">Analyze a Clip</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Clip Orientation</Label>
              <RadioGroup
                value={clipType}
                onValueChange={(v) => setClipType(v as "vertical" | "horizontal")}
                className="flex flex-wrap gap-3"
              >
                <div className="flex items-center space-x-2 border rounded-md px-4 py-3 cursor-pointer hover:bg-accent transition-colors flex-1 min-w-[180px]">
                  <RadioGroupItem value="vertical" id="vertical" />
                  <Label htmlFor="vertical" className="font-normal cursor-pointer flex-1">
                    Vertical — TikTok, Reels, Shorts
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border rounded-md px-4 py-3 cursor-pointer hover:bg-accent transition-colors flex-1 min-w-[180px]">
                  <RadioGroupItem value="horizontal" id="horizontal" />
                  <Label htmlFor="horizontal" className="font-normal cursor-pointer flex-1">
                    Horizontal — YouTube, LinkedIn
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="clip-transcript" className="text-sm font-medium">
                Clip Transcript
              </Label>
              <p className="text-xs text-muted-foreground">
                Paste just the segment that corresponds to this video clip.
              </p>
              <Textarea
                id="clip-transcript"
                placeholder={"Speaker 1: The key to product-led growth is..."}
                className="min-h-[140px] font-mono text-sm resize-y"
                value={clipTranscript}
                onChange={(e) => {
                  setClipTranscript(e.target.value);
                  if (clipError) setClipError("");
                  if (suggestedKeywords) setSuggestedKeywords(null);
                }}
              />
              {clipError && <p className="text-sm text-destructive">{clipError}</p>}
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSubmitClip}
                disabled={createRun.isPending}
                className="gap-2"
              >
                {createRun.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Starting...</>
                ) : (
                  <><Rocket className="h-4 w-4" /> Run Clip Analysis</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
        </div>

        {/* Constraint history — what's worked across past clips */}
        <ConstraintHistoryPanel episodeId={episodeId} clipType={clipType} />

        {/* Section B: Previous Clip Runs */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Previous Clip Analyses</h2>
          {clipRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No clips analyzed yet. Run your first clip above.
            </p>
          ) : (
            <div className="space-y-2">
              {clipRuns.map((run: EpisodeRunCard) => (
                <Card key={run.id} className="border-border/50 shadow-sm hover:border-primary/30 transition-all group">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/runs/${run.id}`} className="flex items-start gap-3 min-w-0 flex-1">
                        <RunStatusIcon status={run.status} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-foreground truncate">
                              {run.title || `Clip #${run.id}`}
                            </span>
                            <RunStatusBadge status={run.status} />
                            {run.clipType && (
                              <span className="text-xs text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded-sm capitalize">
                                {run.clipType}
                              </span>
                            )}
                          </div>
                          {run.clipTranscript && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                              {run.clipTranscript.slice(0, 120)}{run.clipTranscript.length > 120 ? "…" : ""}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(run.createdAt), "MMM d, h:mm a")}
                          </p>
                        </div>
                      </Link>
                      <div className="flex items-center gap-1 shrink-0">
                        <Link href={`/runs/${run.id}`}>
                          <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => setDeleteRunId(run.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Full Episode Content Panel */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Full Episode Content</h2>
            {hasFullEpisodeContent && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                onClick={handleRunFullEpisode}
                disabled={fullEpisodeRunning}
              >
                {fullEpisodeRunning
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />{fullEpisodeStage || "Running..."}</>
                  : "Regenerate"
                }
              </Button>
            )}
          </div>

          {hasFullEpisodeContent ? (
            <div className="space-y-3">
              {substackContent && (
                <PlatformCard label="Substack Article" content={substackContent} />
              )}
              {linkedinContent && (
                <PlatformCard label="LinkedIn Post" content={linkedinContent} maxChars={3000} />
              )}
              {youtubeContent && (
                <PlatformCard label="YouTube Description" content={youtubeContent} />
              )}
              {youtubeTagsContent && (
                <PlatformCard label="YouTube Tags" content={youtubeTagsContent} />
              )}
              {titleVariationsContent && (
                <PlatformCard label="Title Variations" content={titleVariationsContent} />
              )}
            </div>
          ) : (
            <Card className="border-border/50 shadow-sm border-dashed">
              <CardContent className="p-8 flex flex-col items-center text-center">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-medium text-sm mb-1">No full episode content yet</h3>
                <p className="text-xs text-muted-foreground max-w-xs mb-5">
                  Generate show notes, a newsletter article, and social posts for the entire episode in one click.
                </p>
                <Button
                  onClick={handleRunFullEpisode}
                  disabled={fullEpisodeRunning}
                  className="gap-2"
                >
                  {fullEpisodeRunning ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />{fullEpisodeStage || "Running..."}</>
                  ) : (
                    <><Rocket className="h-4 w-4" /> Generate Full Episode Content</>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Delete Episode Dialog */}
      <AlertDialog open={showDeleteEpisodeDialog} onOpenChange={setShowDeleteEpisodeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this episode?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{episode.episodeName}" and all{" "}
              {clipRuns.length} clip {clipRuns.length === 1 ? "analysis" : "analyses"}.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteEpisode}
              disabled={deleteEpisode.isPending}
            >
              {deleteEpisode.isPending ? "Deleting..." : "Delete Episode"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Run Dialog */}
      <AlertDialog open={deleteRunId !== null} onOpenChange={(open) => !open && setDeleteRunId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this clip analysis?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteRunId && handleDeleteRun(deleteRunId)}
              disabled={deleteRun.isPending}
            >
              {deleteRun.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Transcript Dialog */}
      <Dialog open={showEditTranscriptDialog} onOpenChange={setShowEditTranscriptDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Transcript</DialogTitle>
            <DialogDescription>
              Update the full episode transcript. All future clip analyses will use this updated version.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto py-2">
            <Textarea
              value={editTranscriptValue}
              onChange={(e) => setEditTranscriptValue(e.target.value)}
              className="min-h-[340px] font-mono text-sm resize-none"
            />
            <p className="text-xs text-muted-foreground mt-1 text-right">
              {editTranscriptValue.trim() ? editTranscriptValue.trim().split(/\s+/).length.toLocaleString() : 0} words
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditTranscriptDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveTranscript}
              disabled={updateEpisode.isPending || editTranscriptValue.trim().length < 100}
            >
              {updateEpisode.isPending ? "Saving..." : "Save Transcript"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
