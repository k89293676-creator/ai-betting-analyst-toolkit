import React from "react";
import { useGetMetricsSummary, useListPredictions, getListPredictionsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, TrendingUp, AlertTriangle, CheckCircle2, ChevronRight, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetMetricsSummary();
  const { data: predictions, isLoading: isLoadingPredictions } = useListPredictions({ limit: 5 });

  if (isLoadingSummary) {
    return (
      <div className="p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold font-mono tracking-tight text-primary">TERMINAL / OVERVIEW</h1>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="bg-card/50 border-muted">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24 bg-muted" />
                <Skeleton className="h-4 w-4 bg-muted" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16 bg-muted mb-2" />
                <Skeleton className="h-3 w-32 bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold font-mono tracking-tight text-primary flex items-center gap-2">
          <Activity className="h-6 w-6" /> OVERVIEW
        </h1>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="WIN RATE"
          value={summary ? `${summary.overallAccuracy.toFixed(1)}%` : "0%"}
          description="All-time accuracy"
          icon={<Target className="h-4 w-4 text-muted-foreground" />}
          valueClassName={summary && summary.overallAccuracy > 50 ? "text-success" : ""}
        />
        <MetricCard
          title="ROI"
          value={summary ? `${summary.overallRoi > 0 ? '+' : ''}${summary.overallRoi.toFixed(2)}%` : "0%"}
          description="Return on investment"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          valueClassName={summary && summary.overallRoi > 0 ? "text-success" : summary && summary.overallRoi < 0 ? "text-destructive" : ""}
        />
        <MetricCard
          title="ACTIVE POSITIONS"
          value={summary ? summary.pendingPredictions.toString() : "0"}
          description="Pending outcomes"
          icon={<AlertTriangle className="h-4 w-4 text-warning" />}
        />
        <MetricCard
          title="AVG CONFIDENCE"
          value={summary ? `${(summary.avgConfidence * 100).toFixed(1)}%` : "0%"}
          description="Model certainty"
          icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-card border-border shadow-lg">
          <CardHeader className="border-b border-border/50 bg-muted/20 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="font-mono text-sm font-medium tracking-wider text-muted-foreground">RECENT SIGNALS</CardTitle>
              <Link href="/predictions">
                <Button variant="ghost" size="sm" className="h-8 font-mono text-xs">
                  VIEW ALL <ChevronRight className="ml-1 h-3 w-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoadingPredictions ? (
               <div className="p-4 space-y-4">
                 {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full bg-muted/50" />)}
               </div>
            ) : predictions && predictions.length > 0 ? (
              <div className="divide-y divide-border/50">
                {predictions.map(pred => (
                  <div key={pred.id} className="flex items-center justify-between p-4 hover:bg-muted/10 transition-colors">
                    <div>
                      <div className="font-mono text-sm font-bold flex items-center gap-2">
                        {pred.homeTeam} vs {pred.awayTeam}
                        <Badge variant="outline" className={cn("text-[10px] uppercase font-mono tracking-wider", getStatusColor(pred.status))}>
                          {pred.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        {format(new Date(pred.createdAt), "MMM d, HH:mm")} | {pred.sport}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold text-primary">
                        {pred.predictedOutcome}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        {(pred.confidence * 100).toFixed(0)}% CONF | {pred.odds.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-sm font-mono text-muted-foreground">No recent signals found.</div>
            )}
          </CardContent>
        </Card>
        
        <Card className="bg-card border-border shadow-lg">
          <CardHeader className="border-b border-border/50 bg-muted/20 pb-4">
            <CardTitle className="font-mono text-sm font-medium tracking-wider text-muted-foreground">QUICK ACTIONS</CardTitle>
          </CardHeader>
          <CardContent className="p-6 grid grid-cols-2 gap-4">
            <Link href="/odds">
              <Button variant="outline" className="w-full h-24 flex flex-col items-center justify-center gap-2 border-dashed hover:border-primary hover:text-primary transition-colors bg-background">
                <Target className="h-6 w-6" />
                <span className="font-mono text-xs">SCAN ODDS</span>
              </Button>
            </Link>
            <Link href="/ai-analyst">
              <Button variant="outline" className="w-full h-24 flex flex-col items-center justify-center gap-2 border-dashed hover:border-primary hover:text-primary transition-colors bg-background">
                <Activity className="h-6 w-6" />
                <span className="font-mono text-xs">CONSULT AI</span>
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ title, value, description, icon, valueClassName }: { title: string, value: string, description: string, icon: React.ReactNode, valueClassName?: string }) {
  return (
    <Card className="bg-card border-border shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="font-mono text-xs font-medium tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold font-mono ${valueClassName || ''}`}>{value}</div>
        <p className="text-[10px] uppercase text-muted-foreground mt-1 font-mono tracking-wider">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

function cn(...classes: (string | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function getStatusColor(status: string) {
  switch (status.toLowerCase()) {
    case 'won': return "border-success text-success bg-success/10";
    case 'lost': return "border-destructive text-destructive bg-destructive/10";
    case 'pending': return "border-warning text-warning bg-warning/10";
    default: return "border-muted-foreground text-muted-foreground bg-muted/10";
  }
}
