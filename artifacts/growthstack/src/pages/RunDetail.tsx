import { useState, useEffect, useRef } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useGetPipelineRun, getGetPipelineRunQueryKey, useApprovePipelineRun, useDeletePipelineRun, PipelineRunDetail } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, CheckCircle2, Clock, Terminal, PenTool, Edit3, PlayCircle, Loader2, Send, RefreshCw, Trash2, Eye, ThumbsUp, MessageSquare, ExternalLink } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface YouTubeShort {
  title: string;
  url: string;
  channel: string;
  views: number;
  likes: number;
  comments: number;
  tags: string[];
  description: string;
  thumbnail: string;
}

function formatViewCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return n.toString();
}

function YouTubeShortCard({ short }: { short: YouTubeShort }) {
  return (
    <a
      href={short.url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={`youtube-short-card-${short.url}`}
      className="group flex flex-col bg-card border border-border rounded-lg overflow-hidden hover:border-primary/40 hover:shadow-md transition-all duration-200"
    >
      <div className="relative aspect-video bg-muted overflow-hidden">
        {short.thumbnail ? (
          <img
            src={short.thumbnail}
            alt={short.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No thumbnail</div>
        )}
        <div className="absolute top-2 right-2 bg-black/70 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1">
          <ExternalLink className="h-2.5 w-2.5" />
          Shorts
        </div>
      </div>
      <div className="p-3 flex flex-col gap-2 flex-1">
        <p className="text-xs font-semibold text-foreground leading-snug line-clamp-2">{short.title}</p>
        <p className="text-[10px] text-muted-foreground">{short.channel}</p>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Eye className="h-2.5 w-2.5" />
            {formatViewCount(short.views)}
          </span>
          <span className="flex items-center gap-1">
            <ThumbsUp className="h-2.5 w-2.5" />
            {formatViewCount(short.likes)}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-2.5 w-2.5" />
            {formatViewCount(short.comments)}
          </span>
        </div>
        {short.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-auto pt-1">
            {short.tags.slice(0, 5).map((tag) => (
              <span key={tag} className="text-[9px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </a>
  );
}

// Helper to parse the AI output if it comes back as stringified JSON or plain text
const renderFormattedOutput = (output: string | null | undefined, type: string) => {
  if (!output) return <p className="text-muted-foreground italic text-sm">No output yet.</p>;
  
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none font-sans whitespace-pre-wrap leading-relaxed text-foreground">
      {output}
    </div>
  );
};

export default function RunDetail() {
  const { id } = useParams();
  const runId = parseInt(id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const approveRun = useApprovePipelineRun();
  const deleteRun = useDeletePipelineRun();
  const [, setLocation] = useLocation();

  // Real-time state that updates via SSE before the query refetches
  const [liveOutputs, setLiveOutputs] = useState<{
    analystOutput?: string | null;
    writerOutput?: string | null;
    editorOutput?: string | null;
    status?: string;
  }>({});
  
  const [feedbackTarget, setFeedbackTarget] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  const { data: run, isLoading, isError } = useGetPipelineRun(runId, {
    query: {
      enabled: !!runId,
      queryKey: getGetPipelineRunQueryKey(runId),
      // Poll if not completed
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return (status && ['pending', 'researching', 'analyzing', 'writing', 'editing'].includes(status)) ? 5000 : false;
      }
    }
  });

  // Setup SSE stream for live updates
  useEffect(() => {
    if (!runId) return;

    // Only connect SSE if the run is currently processing
    const isProcessing = run?.status && ['pending', 'researching', 'analyzing', 'writing', 'editing'].includes(run.status);
    if (!isProcessing && !isSubmittingFeedback) return;

    const eventSource = new EventSource(`/api/pipeline/runs/${runId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.stage === "complete") {
          // Re-fetch final data
          queryClient.invalidateQueries({ queryKey: getGetPipelineRunQueryKey(runId) });
          eventSource.close();
        } else {
          // Optimistically update the UI based on stage
          setLiveOutputs(prev => ({
            ...prev,
            status: data.stage,
            ...(data.stage === 'analyzing' && { analystOutput: data.content }),
            ...(data.stage === 'writing' && { writerOutput: data.content }),
            ...(data.stage === 'editing' && { editorOutput: data.content })
          }));
        }
      } catch (err) {
        console.error("Error parsing SSE data", err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [runId, run?.status, isSubmittingFeedback, queryClient]);

  // Sync live state with query data when query data updates
  useEffect(() => {
    if (run) {
      setLiveOutputs(prev => ({
        analystOutput: prev.analystOutput || run.analystOutput,
        writerOutput: prev.writerOutput || run.writerOutput,
        editorOutput: prev.editorOutput || run.editorOutput,
        status: run.status
      }));
    }
  }, [run]);

  const displayData = {
    ...run,
    ...liveOutputs,
  };

  const handleApprove = () => {
    approveRun.mutate(
      { id: runId },
      {
        onSuccess: (updatedRun) => {
          queryClient.setQueryData(getGetPipelineRunQueryKey(runId), updatedRun);
          toast({
            title: "Approved!",
            description: "Content package has been marked as approved.",
            className: "bg-emerald-50 text-emerald-900 border-emerald-200",
          });
        }
      }
    );
  };

  const submitFeedback = async (target: string) => {
    if (!feedbackText.trim()) return;
    
    setIsSubmittingFeedback(true);
    setFeedbackTarget(null); // Close the feedback input
    
    try {
      toast({
        title: "Feedback submitted",
        description: "The Editor is revising the content based on your feedback...",
      });

      // Update status optimistically
      setLiveOutputs(prev => ({ ...prev, status: 'editing' }));

      // Use native fetch for SSE response handling
      const res = await fetch(`/api/pipeline/runs/${runId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetOutput: target, feedback: feedbackText })
      });

      if (!res.ok) throw new Error("Failed to submit feedback");
      
      setFeedbackText("");
      
      // Re-fetch after submission initiates the stream processing server-side
      queryClient.invalidateQueries({ queryKey: getGetPipelineRunQueryKey(runId) });
      
    } catch (err) {
      console.error(err);
      toast({
        title: "Error",
        description: "Failed to submit feedback.",
        variant: "destructive"
      });
      setIsSubmittingFeedback(false);
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-6 max-w-5xl mx-auto space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-96" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
          <Skeleton className="h-[400px] w-full" />
        </div>
      </AppLayout>
    );
  }

  if (isError || !run) {
    return (
      <AppLayout>
        <div className="p-6 max-w-5xl mx-auto text-center mt-20">
          <h2 className="text-xl font-bold text-destructive mb-2">Run Not Found</h2>
          <p className="text-muted-foreground mb-6">This pipeline run might have been deleted or doesn't exist.</p>
          <Link href="/">
            <Button variant="outline">Return to Dashboard</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const getStatusDisplay = (status: string | undefined) => {
    switch (status) {
      case "researching": return { label: "Researching", icon: Terminal, color: "text-sky-500", bg: "bg-sky-500/10 border-sky-200" };
      case "analyzing": return { label: "Evaluating Clip", icon: Terminal, color: "text-blue-500", bg: "bg-blue-500/10 border-blue-200" };
      case "writing": return { label: "Writer Working", icon: PenTool, color: "text-purple-500", bg: "bg-purple-500/10 border-purple-200" };
      case "editing": return { label: "Editor Working", icon: Edit3, color: "text-pink-500", bg: "bg-pink-500/10 border-pink-200" };
      case "review": return { label: "Needs Review", icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10 border-amber-200" };
      case "approved": return { label: "Approved", icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-200" };
      case "failed": return { label: "Failed", icon: Trash2, color: "text-destructive", bg: "bg-destructive/10 border-destructive/20" };
      default: return { label: "Pending", icon: PlayCircle, color: "text-muted-foreground", bg: "bg-muted border-border" };
    }
  };

  const statusInfo = getStatusDisplay(displayData.status);
  const StatusIcon = statusInfo.icon;
  const isProcessing = ['pending', 'researching', 'analyzing', 'writing', 'editing'].includes(displayData.status || '');

  // Pipeline Stages Visualization — clip runs have 4 stages, episode runs have 3
  const isClipRun = run.type === 'clip';
  const stages = isClipRun ? [
    { id: 'researching', name: 'Research', complete: ['analyzing', 'writing', 'editing', 'review', 'approved'].includes(displayData.status || ''), active: displayData.status === 'researching' },
    { id: 'analyzing', name: 'Analyst', complete: ['writing', 'editing', 'review', 'approved'].includes(displayData.status || ''), active: displayData.status === 'analyzing' },
    { id: 'writing', name: 'Writer', complete: ['editing', 'review', 'approved'].includes(displayData.status || ''), active: displayData.status === 'writing' },
    { id: 'editing', name: 'Editor', complete: ['review', 'approved'].includes(displayData.status || ''), active: displayData.status === 'editing' },
  ] : [
    { id: 'analyzing', name: 'Analyst', complete: ['writing', 'editing', 'review', 'approved'].includes(displayData.status || ''), active: displayData.status === 'analyzing' },
    { id: 'writing', name: 'Writer', complete: ['editing', 'review', 'approved'].includes(displayData.status || ''), active: displayData.status === 'writing' },
    { id: 'editing', name: 'Editor', complete: ['review', 'approved'].includes(displayData.status || ''), active: displayData.status === 'editing' },
  ];

  return (
    <AppLayout>
      <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <Badge variant="outline" className={`capitalize px-2.5 py-0.5 text-xs font-medium border ${statusInfo.bg} ${statusInfo.color}`}>
                <StatusIcon className="h-3 w-3 mr-1.5" />
                {statusInfo.label}
              </Badge>
              <Badge variant="secondary" className="capitalize px-2.5 py-0.5 text-xs font-medium">
                {run.type} {run.clipType && `· ${run.clipType}`}
              </Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground ml-11">
              {run.title || `Pipeline Run #${run.id}`}
            </h1>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button 
              variant="outline" 
              size="icon"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => {
                if (window.confirm("Are you sure you want to delete this run?")) {
                  deleteRun.mutate({ id: runId }, {
                    onSuccess: () => {
                      toast({ title: "Run deleted" });
                      setLocation("/");
                    }
                  });
                }
              }}
              disabled={deleteRun.isPending}
            >
              {deleteRun.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
            {displayData.status === 'review' && (
              <Button 
                onClick={handleApprove} 
                disabled={approveRun.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                {approveRun.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve Package
              </Button>
            )}
            {displayData.status === 'approved' && (
              <Button variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 pointer-events-none gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Approved
              </Button>
            )}
          </div>
        </div>

        {/* Pipeline Progress Indicator */}
        <Card className="shadow-sm border-border/50 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 bg-muted/20">
            {stages.map((stage, i) => (
              <div key={stage.id} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-2">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center border-2 transition-colors duration-500
                    ${stage.complete ? 'bg-primary border-primary text-primary-foreground' : 
                      stage.active ? 'border-primary text-primary bg-background shadow-[0_0_10px_rgba(var(--primary),0.3)] animate-pulse' : 
                      'border-muted-foreground/30 text-muted-foreground/50 bg-background'}`}
                  >
                    {stage.complete ? <CheckCircle2 className="h-4 w-4" /> : 
                     stage.active ? <RefreshCw className="h-4 w-4 animate-spin" /> : 
                     <span className="text-xs font-medium">{i + 1}</span>}
                  </div>
                  <span className={`text-xs font-medium ${stage.active || stage.complete ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {stage.name}
                  </span>
                </div>
                {i < stages.length - 1 && (
                  <div className="flex-1 h-[2px] mx-4 overflow-hidden bg-muted rounded-full">
                    <div className={`h-full bg-primary transition-all duration-1000 ease-in-out ${stage.complete ? 'w-full' : stage.active ? 'w-1/2 animate-pulse' : 'w-0'}`} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Outputs Area */}
        <div className="mt-8">
          <Tabs defaultValue="editor" className="w-full">
            <div className="flex items-center justify-between border-b pb-px mb-6">
              <TabsList className="bg-transparent h-auto p-0 space-x-6 justify-start rounded-none">
                <TabsTrigger 
                  value="editor" 
                  className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3 pt-2 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground"
                >
                  Final Package (Editor)
                </TabsTrigger>
                <TabsTrigger 
                  value="writer" 
                  className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3 pt-2 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground"
                >
                  Drafts (Writer)
                </TabsTrigger>
                <TabsTrigger 
                  value="analyst" 
                  className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3 pt-2 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground"
                >
                  Brief (Analyst)
                </TabsTrigger>
                <TabsTrigger 
                  value="source" 
                  className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3 pt-2 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground"
                >
                  Source Transcripts
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Output Tab Contents */}
            {['editor', 'writer', 'analyst'].map((stage) => {
              const outputKey = `${stage}Output` as keyof typeof displayData;
              const content = displayData[outputKey];
              const isStageActive = displayData.status === stage;

              // Parse YouTube data for the analyst tab on clip runs
              let youtubeShorts: YouTubeShort[] | null = null;
              if (stage === 'analyst' && run.type === 'clip' && run.youtubeData) {
                try {
                  youtubeShorts = JSON.parse(run.youtubeData) as YouTubeShort[];
                } catch {
                  youtubeShorts = null;
                }
              }
              
              return (
                <TabsContent key={stage} value={stage} className="mt-0 focus-visible:outline-none focus-visible:ring-0">
                  <Card className="shadow-sm border-border/50 overflow-hidden relative">
                    {/* Live Processing Overlay */}
                    {isStageActive && (
                      <div className="absolute inset-0 bg-background/50 backdrop-blur-[1px] z-10 flex flex-col items-center justify-center">
                        <RefreshCw className="h-8 w-8 text-primary animate-spin mb-4" />
                        <p className="text-sm font-medium text-foreground bg-background px-4 py-2 rounded-full shadow-sm border border-primary/20">
                          {stage.charAt(0).toUpperCase() + stage.slice(1)} is thinking...
                        </p>
                      </div>
                    )}
                    
                    <CardHeader className="bg-muted/10 border-b py-4">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">
                          {stage === 'editor' && 'Final Content Package'}
                          {stage === 'writer' && 'Draft Outputs'}
                          {stage === 'analyst' && 'Strategic Brief'}
                        </CardTitle>
                        {(stage === 'editor' || stage === 'writer') && content && !isProcessing && (
                          <Button 
                            variant="secondary" 
                            size="sm" 
                            className="h-8 text-xs font-medium"
                            onClick={() => setFeedbackTarget(stage === 'feedback')}
                          >
                            <PenTool className="h-3 w-3 mr-2" />
                            Request Revision
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
                      {/* YouTube Shorts Section (analyst tab, clip runs only) */}
                      {stage === 'analyst' && youtubeShorts && youtubeShorts.length > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                            Top-Performing YouTube Shorts — Topic Reference
                          </h3>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {youtubeShorts.map((short) => (
                              <YouTubeShortCard key={short.url} short={short} />
                            ))}
                          </div>
                          <Separator className="mt-6" />
                        </div>
                      )}

                      {content ? (
                        <div className="relative group">
                          {renderFormattedOutput(content as string, stage)}
                          
                          {/* Inline Feedback Prompt (appears on hover over content block if not active) */}
                          {(!isProcessing && displayData.status !== 'approved' && stage === 'editor' && !feedbackTarget) && (
                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="bg-background shadow-sm h-8 border-dashed"
                                onClick={() => setFeedbackTarget('editorOutput')}
                              >
                                <Edit3 className="h-3 w-3 mr-2" /> Give Feedback
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm italic">
                          Awaiting previous stages to complete...
                        </div>
                      )}
                    </CardContent>

                    {/* Feedback Form UI */}
                    {feedbackTarget === `${stage}Output` && (
                      <div className="bg-muted/30 border-t p-6 animate-in slide-in-from-top-2 fade-in duration-200">
                        <h4 className="text-sm font-semibold mb-3 flex items-center">
                          <Edit3 className="h-4 w-4 mr-2 text-primary" />
                          Editor Instructions
                        </h4>
                        <Textarea 
                          placeholder="E.g., 'Make the LinkedIn hook punchier', 'The YouTube tags are too generic, focus on B2B SaaS', 'Tone down the promotional language.'"
                          className="min-h-[100px] text-sm resize-y mb-3 bg-background"
                          value={feedbackText}
                          onChange={(e) => setFeedbackText(e.target.value)}
                          autoFocus
                        />
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setFeedbackTarget(null)}>Cancel</Button>
                          <Button 
                            size="sm" 
                            className="gap-2" 
                            onClick={() => submitFeedback(`${stage}Output`)}
                            disabled={!feedbackText.trim() || isSubmittingFeedback}
                          >
                            {isSubmittingFeedback ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                            Send to Editor
                          </Button>
                        </div>
                      </div>
                    )}
                  </Card>
                </TabsContent>
              );
            })}

            <TabsContent value="source" className="mt-0 focus-visible:outline-none">
              <Card className="shadow-sm border-border/50">
                <CardHeader className="bg-muted/10 border-b py-4">
                  <CardTitle className="text-lg">Input Material</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
                    <div className="p-6">
                      <h4 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">Episode Transcript</h4>
                      <div className="font-mono text-xs text-muted-foreground/80 whitespace-pre-wrap max-h-[600px] overflow-y-auto pr-4 custom-scrollbar">
                        {run.episodeTranscript}
                      </div>
                    </div>
                    {run.clipTranscript && (
                      <div className="p-6">
                        <h4 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">Clip Transcript</h4>
                        <div className="font-mono text-xs text-muted-foreground/80 whitespace-pre-wrap max-h-[600px] overflow-y-auto pr-4 custom-scrollbar">
                          {run.clipTranscript}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
