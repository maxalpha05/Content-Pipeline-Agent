import { useGetPipelineDashboard, getGetPipelineDashboardQueryKey, useListPipelineRuns } from "@workspace/api-client-react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Link } from "wouter";
import { ArrowRight, Layers, FileText, CheckCircle2, Clock, PlayCircle, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { data: dashboard, isLoading } = useGetPipelineDashboard();

  const StatCard = ({ title, value, icon: Icon, description }: { title: string, value: string | number | undefined, icon: any, description: string }) => (
    <Card className="shadow-sm border-border/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-16 mb-1" />
        ) : (
          <div className="text-2xl font-bold tracking-tight">{value}</div>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {description}
        </p>
      </CardContent>
    </Card>
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge variant="default" className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 border-emerald-200 dark:border-emerald-800/30">Approved</Badge>;
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      case "review":
        return <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 border-amber-200 dark:border-amber-800/30">Needs Review</Badge>;
      case "pending":
        return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
      default:
        return <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 border-primary/20">Processing</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved": return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "failed": return <AlertCircle className="h-4 w-4 text-destructive" />;
      case "review": return <Clock className="h-4 w-4 text-amber-500" />;
      case "pending": return <Clock className="h-4 w-4 text-muted-foreground" />;
      default: return <PlayCircle className="h-4 w-4 text-primary animate-pulse" />;
    }
  };

  return (
    <AppLayout>
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Mission Control</h1>
            <p className="text-muted-foreground mt-1">Content pipeline operations overview.</p>
          </div>
          <Link href="/new">
            <Button className="shrink-0 gap-2">
              <PlayCircle className="h-4 w-4" />
              New Pipeline Run
            </Button>
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard 
            title="Total Processed" 
            value={dashboard?.totalRuns} 
            icon={Layers} 
            description="Lifetime pipeline runs" 
          />
          <StatCard 
            title="Approved Packages" 
            value={dashboard?.approvedRuns} 
            icon={CheckCircle2} 
            description="Ready for publishing" 
          />
          <StatCard 
            title="Needs Review" 
            value={dashboard?.pendingReviewRuns} 
            icon={Clock} 
            description="Awaiting your approval" 
          />
          <StatCard 
            title="Content Ratio" 
            value={dashboard ? `${dashboard.episodeRuns}:${dashboard.clipRuns}` : ''} 
            icon={FileText} 
            description="Episodes to Clips processed" 
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight">Recent Runs</h2>
            <Link href="/runs" className="text-sm font-medium text-primary hover:underline hidden">
              View all
            </Link>
          </div>

          <Card className="shadow-sm border-border/50">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                  <tr>
                    <th className="px-6 py-4 font-medium">Status</th>
                    <th className="px-6 py-4 font-medium">Title</th>
                    <th className="px-6 py-4 font-medium">Type</th>
                    <th className="px-6 py-4 font-medium hidden sm:table-cell">Created</th>
                    <th className="px-6 py-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        <td className="px-6 py-4"><Skeleton className="h-6 w-24" /></td>
                        <td className="px-6 py-4"><Skeleton className="h-4 w-48" /></td>
                        <td className="px-6 py-4"><Skeleton className="h-6 w-16" /></td>
                        <td className="px-6 py-4 hidden sm:table-cell"><Skeleton className="h-4 w-24" /></td>
                        <td className="px-6 py-4 flex justify-end"><Skeleton className="h-8 w-8" /></td>
                      </tr>
                    ))
                  ) : dashboard?.recentRuns?.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                        No pipeline runs yet. Start your first run.
                      </td>
                    </tr>
                  ) : (
                    dashboard?.recentRuns?.map((run) => (
                      <tr key={run.id} className="hover:bg-muted/30 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(run.status)}
                            {getStatusBadge(run.status)}
                          </div>
                        </td>
                        <td className="px-6 py-4 font-medium text-foreground max-w-[200px] truncate">
                          {run.title || `Untitled ${run.type === 'episode' ? 'Episode' : 'Clip'}`}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1">
                            <span className="capitalize text-muted-foreground">{run.type}</span>
                            {run.clipType && (
                              <span className="text-xs text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded-sm">
                                {run.clipType}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-muted-foreground hidden sm:table-cell">
                          {format(new Date(run.createdAt), "MMM d, h:mm a")}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link href={`/runs/${run.id}`}>
                            <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
