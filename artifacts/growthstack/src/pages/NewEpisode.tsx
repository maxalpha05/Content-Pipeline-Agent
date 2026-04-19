import { useLocation } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useCreateEpisode } from "@workspace/api-client-react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Mic } from "lucide-react";
import { Link } from "wouter";

const formSchema = z.object({
  episodeName: z.string().min(1, "Episode name is required"),
  guestName: z.string().min(1, "Guest name is required"),
  fullTranscript: z.string().min(100, "Transcript must be at least 100 characters"),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewEpisode() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createEpisode = useCreateEpisode();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      episodeName: "",
      guestName: "",
      fullTranscript: "",
    },
  });

  const transcriptValue = form.watch("fullTranscript");
  const wordCount = transcriptValue.trim() ? transcriptValue.trim().split(/\s+/).length : 0;

  function onSubmit(values: FormValues) {
    createEpisode.mutate(
      { data: values },
      {
        onSuccess: (episode) => {
          toast({
            title: "Episode created",
            description: "You can now run clip analyses without re-pasting the transcript.",
          });
          setLocation(`/episodes/${episode.id}`);
        },
        onError: () => {
          toast({
            title: "Could not create episode",
            description: "Something went wrong. Please try again.",
            variant: "destructive",
          });
        },
      }
    );
  }

  return (
    <AppLayout>
      <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="shrink-0 rounded-full h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">New Episode</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Paste the transcript once and run any number of clip analyses from the workspace.
            </p>
          </div>
        </div>

        <Card className="shadow-sm border-border/50">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Mic className="h-4 w-4 text-primary" />
                  </div>
                  <CardTitle>Episode Details</CardTitle>
                </div>
                <CardDescription>
                  Fill in the episode metadata and paste the full transcript. The AI pipeline will use this as context for every clip analysis.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="episodeName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Episode Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Ep. 42 — The Truth About PLG" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="guestName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Guest Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Jane Smith" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="fullTranscript"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Episode Transcript</FormLabel>
                      <FormDescription>
                        Paste the raw transcription. The AI pipeline will use this as context for every clip analysis run from this episode.
                      </FormDescription>
                      <FormControl>
                        <Textarea
                          placeholder={"Speaker 1: Welcome to the GrowthStack podcast...\nSpeaker 2: Great to be here..."}
                          className="min-h-[280px] font-mono text-sm resize-y"
                          {...field}
                        />
                      </FormControl>
                      <div className="flex items-center justify-between mt-1">
                        <FormMessage />
                        <span className="text-xs text-muted-foreground ml-auto">
                          {wordCount.toLocaleString()} words
                        </span>
                      </div>
                    </FormItem>
                  )}
                />
              </CardContent>

              <CardFooter className="bg-muted/20 border-t px-6 py-4 flex justify-end">
                <Button type="submit" disabled={createEpisode.isPending} className="gap-2 px-8">
                  {createEpisode.isPending ? "Creating..." : "Create Episode"}
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
      </div>
    </AppLayout>
  );
}
