import { useState } from "react";
import { useLocation } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useCreatePipelineRun, CreatePipelineRunBodyType, CreatePipelineRunBodyClipType } from "@workspace/api-client-react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Mic, Video, Rocket, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const formSchema = z.object({
  type: z.enum([CreatePipelineRunBodyType.episode, CreatePipelineRunBodyType.clip]),
  clipType: z.enum([CreatePipelineRunBodyClipType.horizontal, CreatePipelineRunBodyClipType.vertical]).optional(),
  episodeTranscript: z.string().min(100, "Episode transcript must be at least 100 characters long to process."),
  clipTranscript: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.type === CreatePipelineRunBodyType.clip) {
    if (!data.clipType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Clip orientation is required for clip runs",
        path: ["clipType"]
      });
    }
    if (!data.clipTranscript || data.clipTranscript.length < 50) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Clip transcript is required for clip runs (min 50 chars)",
        path: ["clipTranscript"]
      });
    }
  }
});

export default function NewRun() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createRun = useCreatePipelineRun();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: CreatePipelineRunBodyType.episode,
      episodeTranscript: "",
      clipTranscript: "",
    },
  });

  const watchType = form.watch("type");

  function onSubmit(values: z.infer<typeof formSchema>) {
    createRun.mutate(
      {
        data: {
          type: values.type,
          episodeTranscript: values.episodeTranscript,
          ...(values.type === CreatePipelineRunBodyType.clip && {
            clipType: values.clipType,
            clipTranscript: values.clipTranscript,
          }),
        },
      },
      {
        onSuccess: (data) => {
          toast({
            title: "Pipeline Started",
            description: "Your content is now being processed by the AI pipeline.",
          });
          setLocation(`/runs/${data.id}`);
        },
        onError: (error) => {
          toast({
            title: "Error starting pipeline",
            description: (error as any)?.message || "Something went wrong.",
            variant: "destructive",
          });
        },
      }
    );
  }

  return (
    <AppLayout>
      <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="shrink-0 rounded-full h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">New Pipeline Run</h1>
            <p className="text-sm text-muted-foreground mt-1">Initiate content repurposing workflow.</p>
          </div>
        </div>

        <Card className="shadow-sm border-border/50">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <CardHeader>
                <CardTitle>Content Parameters</CardTitle>
                <CardDescription>
                  Configure the source material for the AI pipeline to analyze and transform.
                </CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-8">
                {/* Type Selection */}
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel>Run Type</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          className="grid grid-cols-1 md:grid-cols-2 gap-4"
                        >
                          <FormItem>
                            <FormControl>
                              <RadioGroupItem value={CreatePipelineRunBodyType.episode} className="peer sr-only" />
                            </FormControl>
                            <FormLabel className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-transparent p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer">
                              <Mic className="mb-3 h-6 w-6" />
                              Full Episode
                              <span className="mt-1 text-xs text-center text-muted-foreground font-normal">
                                Generates comprehensive show notes, social posts, and newsletter content.
                              </span>
                            </FormLabel>
                          </FormItem>
                          <FormItem>
                            <FormControl>
                              <RadioGroupItem value={CreatePipelineRunBodyType.clip} className="peer sr-only" />
                            </FormControl>
                            <FormLabel className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-transparent p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer">
                              <Video className="mb-3 h-6 w-6" />
                              Video Clip
                              <span className="mt-1 text-xs text-center text-muted-foreground font-normal">
                                Optimizes specific segments for TikTok, Reels, Shorts or LinkedIn video.
                              </span>
                            </FormLabel>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Clip Sub-type Selection (conditional) */}
                {watchType === CreatePipelineRunBodyType.clip && (
                  <FormField
                    control={form.control}
                    name="clipType"
                    render={({ field }) => (
                      <FormItem className="space-y-3 animate-in fade-in slide-in-from-top-4">
                        <FormLabel>Clip Orientation</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="flex flex-wrap gap-4"
                          >
                            <FormItem className="flex items-center space-x-2 border rounded-md px-4 py-3 cursor-pointer hover:bg-accent transition-colors flex-1">
                              <FormControl>
                                <RadioGroupItem value={CreatePipelineRunBodyClipType.vertical} />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer flex-1">Vertical (TikTok, Reels, Shorts)</FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-2 border rounded-md px-4 py-3 cursor-pointer hover:bg-accent transition-colors flex-1">
                              <FormControl>
                                <RadioGroupItem value={CreatePipelineRunBodyClipType.horizontal} />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer flex-1">Horizontal (YouTube, LinkedIn)</FormLabel>
                            </FormItem>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <div className="space-y-6">
                  {/* Episode Transcript (always required for context) */}
                  <FormField
                    control={form.control}
                    name="episodeTranscript"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Episode Transcript</FormLabel>
                        <FormDescription>
                          Paste the raw transcription. The Analyst will review this to understand the broader context.
                        </FormDescription>
                        <FormControl>
                          <Textarea
                            placeholder="Speaker 1: Welcome to the GrowthStack...&#10;Speaker 2: Great to be here..."
                            className="min-h-[250px] font-mono text-sm resize-y"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Clip Transcript (conditional) */}
                  {watchType === CreatePipelineRunBodyType.clip && (
                    <FormField
                      control={form.control}
                      name="clipTranscript"
                      render={({ field }) => (
                        <FormItem className="animate-in fade-in slide-in-from-top-4">
                          <FormLabel>Clip Specific Transcript</FormLabel>
                          <FormDescription>
                            Paste just the segment that corresponds to this video clip.
                          </FormDescription>
                          <FormControl>
                            <Textarea
                              placeholder="Speaker 1: The key to product led growth is..."
                              className="min-h-[150px] font-mono text-sm resize-y"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              </CardContent>
              <CardFooter className="bg-muted/20 border-t px-6 py-4 flex justify-end">
                <Button type="submit" disabled={createRun.isPending} className="gap-2 px-8">
                  {createRun.isPending ? (
                    <>Processing...</>
                  ) : (
                    <>
                      <Rocket className="h-4 w-4" />
                      Ignite Pipeline
                    </>
                  )}
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
      </div>
    </AppLayout>
  );
}
