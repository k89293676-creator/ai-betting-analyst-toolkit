import React from "react";
import { useGetPerformanceMetrics, useGetTrainingHistory } from "@workspace/api-client-react";
import { LineChart as LineChartIcon, Activity, Database, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from "recharts";

export default function Performance() {
  const { data: metrics, isLoading: isLoadingMetrics } = useGetPerformanceMetrics({ days: 30 });
  const { data: trainingHistory, isLoading: isLoadingTraining } = useGetTrainingHistory();

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card border border-border p-3 shadow-xl rounded-md font-mono text-xs">
          <p className="text-muted-foreground mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }} className="flex justify-between gap-4 font-bold">
              <span>{entry.name}:</span>
              <span>{entry.value}{entry.name.includes('ROI') || entry.name.includes('Accuracy') ? '%' : ''}</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold font-mono tracking-tight text-primary flex items-center gap-2">
          <LineChartIcon className="h-6 w-6" /> ANALYTICS
        </h1>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-card border-border shadow-lg">
          <CardHeader className="border-b border-border/50 bg-muted/20 pb-4">
            <CardTitle className="font-mono text-sm font-medium tracking-wider text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" /> ROI TRAJECTORY (30D)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 h-[300px]">
            {isLoadingMetrics ? (
              <Skeleton className="w-full h-full bg-muted/50" />
            ) : metrics && metrics.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={[...metrics].reverse()} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRoi" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(val) => format(new Date(val), 'dd/MM')} 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    fontFamily="monospace"
                    tickMargin={10}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    fontFamily="monospace"
                    tickFormatter={(val) => `${val}%`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area 
                    type="monotone" 
                    dataKey="roi" 
                    name="ROI"
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorRoi)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm">NOT ENOUGH DATA</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-lg">
          <CardHeader className="border-b border-border/50 bg-muted/20 pb-4">
            <CardTitle className="font-mono text-sm font-medium tracking-wider text-muted-foreground flex items-center gap-2">
              <Target className="h-4 w-4" /> MODEL ACCURACY
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 h-[300px]">
            {isLoadingMetrics ? (
              <Skeleton className="w-full h-full bg-muted/50" />
            ) : metrics && metrics.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={[...metrics].reverse()} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(val) => format(new Date(val), 'dd/MM')} 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    fontFamily="monospace"
                    tickMargin={10}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    fontFamily="monospace"
                    domain={['auto', 'auto']}
                    tickFormatter={(val) => `${val}%`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line 
                    type="monotone" 
                    dataKey="accuracy" 
                    name="Accuracy"
                    stroke="hsl(var(--success))" 
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line 
                    type="monotone" 
                    dataKey={(d) => d.avgConfidence * 100} 
                    name="Avg Confidence"
                    stroke="hsl(var(--warning))" 
                    strokeWidth={1}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm">NOT ENOUGH DATA</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border shadow-lg">
        <CardHeader className="border-b border-border/50 bg-muted/20 pb-4">
          <CardTitle className="font-mono text-sm font-medium tracking-wider text-muted-foreground flex items-center gap-2">
            <Database className="h-4 w-4" /> RETRAINING LOG
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground bg-muted/10 border-b border-border">
                <tr>
                  <th className="px-6 py-3 font-medium">TIMESTAMP</th>
                  <th className="px-6 py-3 font-medium text-right">SAMPLES</th>
                  <th className="px-6 py-3 font-medium text-center">STATUS</th>
                  <th className="px-6 py-3 font-medium text-right">ACCURACY DELTA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 font-mono text-xs">
                {isLoadingTraining ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-32 bg-muted/50" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-16 ml-auto bg-muted/50" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-20 mx-auto bg-muted/50" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-16 ml-auto bg-muted/50" /></td>
                    </tr>
                  ))
                ) : trainingHistory && trainingHistory.length > 0 ? (
                  trainingHistory.map((record) => {
                    const delta = record.accuracyAfter && record.accuracyBefore 
                      ? record.accuracyAfter - record.accuracyBefore 
                      : 0;
                    return (
                      <tr key={record.id} className="hover:bg-muted/10">
                        <td className="px-6 py-4">{format(new Date(record.triggeredAt), "yyyy-MM-dd HH:mm")}</td>
                        <td className="px-6 py-4 text-right">{record.samplesProcessed}</td>
                        <td className="px-6 py-4 text-center">
                          <span className={`px-2 py-1 rounded-sm text-[10px] uppercase tracking-widest ${
                            record.status === 'completed' ? 'bg-success/20 text-success border border-success/30' :
                            record.status === 'failed' ? 'bg-destructive/20 text-destructive border border-destructive/30' :
                            'bg-warning/20 text-warning border border-warning/30'
                          }`}>
                            {record.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-bold">
                          {record.status === 'completed' && record.accuracyBefore && record.accuracyAfter ? (
                            <span className={`flex items-center justify-end gap-1 ${delta >= 0 ? 'text-success' : 'text-destructive'}`}>
                              {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                              {Math.abs(delta).toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground font-mono">
                      NO TRAINING RECORDS FOUND
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
