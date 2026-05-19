import React, { useState } from "react";
import { useListPredictions, useUpdatePredictionResult, useDeletePrediction, useSendTelegramPrediction } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Target, Search, Filter, Send, CheckCircle, XCircle, Clock, MoreVertical, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function Predictions() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sportFilter, setSportFilter] = useState<string>("all");
  const { toast } = useToast();

  const { data: predictions, isLoading, refetch } = useListPredictions({
    status: statusFilter !== "all" ? statusFilter : undefined,
    sport: sportFilter !== "all" ? sportFilter : undefined,
  });

  const updateResult = useUpdatePredictionResult();
  const deletePrediction = useDeletePrediction();
  const sendTelegram = useSendTelegramPrediction();

  const [selectedPrediction, setSelectedPrediction] = useState<any | null>(null);

  const handleUpdateResult = async (id: number, status: string, actualOutcome: string) => {
    try {
      await updateResult.mutateAsync({ id, data: { status, actualOutcome } });
      toast({ title: "Result updated successfully", className: "bg-background border-border text-foreground font-mono" });
      refetch();
      setSelectedPrediction(null);
    } catch (error) {
      toast({ title: "Failed to update result", variant: "destructive", className: "font-mono" });
    }
  };

  const handleSendTelegram = async (id: number) => {
    try {
      await sendTelegram.mutateAsync({ data: { predictionId: id } });
      toast({ title: "Sent to Telegram", className: "bg-background border-border text-foreground font-mono" });
      refetch();
    } catch (error) {
      toast({ title: "Failed to send to Telegram", variant: "destructive", className: "font-mono" });
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this prediction?")) {
      try {
        await deletePrediction.mutateAsync({ id });
        toast({ title: "Prediction deleted", className: "bg-background border-border text-foreground font-mono" });
        refetch();
        setSelectedPrediction(null);
      } catch (error) {
        toast({ title: "Failed to delete prediction", variant: "destructive", className: "font-mono" });
      }
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold font-mono tracking-tight text-primary flex items-center gap-2">
          <Target className="h-6 w-6" /> SIGNALS_LOG
        </h1>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-card p-1 rounded-md border border-border">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px] h-8 border-0 bg-transparent shadow-none font-mono text-xs focus:ring-0 focus:ring-offset-0">
                <SelectValue placeholder="STATUS" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ALL STATUS</SelectItem>
                <SelectItem value="pending">PENDING</SelectItem>
                <SelectItem value="won">WON</SelectItem>
                <SelectItem value="lost">LOST</SelectItem>
              </SelectContent>
            </Select>
            <div className="w-px h-4 bg-border" />
            <Select value={sportFilter} onValueChange={setSportFilter}>
              <SelectTrigger className="w-[140px] h-8 border-0 bg-transparent shadow-none font-mono text-xs focus:ring-0 focus:ring-offset-0">
                <SelectValue placeholder="SPORT" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ALL SPORTS</SelectItem>
                <SelectItem value="soccer">SOCCER</SelectItem>
                <SelectItem value="basketball">BASKETBALL</SelectItem>
                <SelectItem value="tennis">TENNIS</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Card className="bg-card border-border shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground bg-muted/20 border-b border-border">
              <tr>
                <th className="px-6 py-4 font-medium">DATE / SPORT</th>
                <th className="px-6 py-4 font-medium">MATCH</th>
                <th className="px-6 py-4 font-medium">PREDICTION</th>
                <th className="px-6 py-4 font-medium text-right">ODDS</th>
                <th className="px-6 py-4 font-medium text-right">CONF / KELLY</th>
                <th className="px-6 py-4 font-medium text-center">STATUS</th>
                <th className="px-6 py-4 font-medium text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-24 bg-muted/50" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-48 bg-muted/50" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-32 bg-muted/50" /></td>
                    <td className="px-6 py-4 text-right"><Skeleton className="h-4 w-12 ml-auto bg-muted/50" /></td>
                    <td className="px-6 py-4 text-right"><Skeleton className="h-4 w-16 ml-auto bg-muted/50" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-6 w-20 mx-auto bg-muted/50" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-8 w-8 ml-auto bg-muted/50" /></td>
                  </tr>
                ))
              ) : predictions?.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground font-mono">
                    NO SIGNALS FOUND MATCHING CRITERIA
                  </td>
                </tr>
              ) : (
                predictions?.map((pred) => (
                  <tr key={pred.id} className="hover:bg-muted/10 transition-colors group cursor-pointer" onClick={() => setSelectedPrediction(pred)}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-mono text-xs">{format(new Date(pred.matchDate), "dd MMM yy")}</div>
                      <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">{pred.sport}</div>
                    </td>
                    <td className="px-6 py-4 font-bold font-mono">
                      {pred.homeTeam} <span className="text-muted-foreground font-normal">v</span> {pred.awayTeam}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-mono text-primary font-bold">{pred.predictedOutcome}</div>
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-medium">
                      {pred.odds.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="font-mono text-xs font-bold">{(pred.confidence * 100).toFixed(1)}%</div>
                      <div className="font-mono text-[10px] text-muted-foreground tracking-wider">K: {(pred.kellyFraction * 100).toFixed(2)}%</div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Badge variant="outline" className={`text-[10px] uppercase font-mono tracking-wider ${getStatusColor(pred.status)}`}>
                        {pred.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[160px] font-mono text-xs">
                          <DropdownMenuItem onClick={() => handleSendTelegram(pred.id)} className="cursor-pointer">
                            <Send className="mr-2 h-3 w-3" /> SEND ALERT
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDelete(pred.id)} className="cursor-pointer text-destructive focus:text-destructive">
                            <Trash2 className="mr-2 h-3 w-3" /> DELETE
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedPrediction} onOpenChange={(open) => !open && setSelectedPrediction(null)}>
        <DialogContent className="sm:max-w-[500px] bg-card border-border font-mono">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold tracking-tight text-primary flex items-center justify-between">
              SIGNAL DETAILS
              <Badge variant="outline" className={getStatusColor(selectedPrediction?.status || '')}>
                {selectedPrediction?.status}
              </Badge>
            </DialogTitle>
            <DialogDescription className="font-mono uppercase text-xs tracking-wider">
              {selectedPrediction?.sport} • {selectedPrediction?.matchDate && format(new Date(selectedPrediction.matchDate), "dd MMM yyyy HH:mm")}
            </DialogDescription>
          </DialogHeader>

          {selectedPrediction && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4 bg-muted/20 p-4 rounded-md border border-border/50">
                <div className="text-center p-2">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">HOME</div>
                  <div className="font-bold truncate" title={selectedPrediction.homeTeam}>{selectedPrediction.homeTeam}</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">AWAY</div>
                  <div className="font-bold truncate" title={selectedPrediction.awayTeam}>{selectedPrediction.awayTeam}</div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-border/50 pb-2">
                  <span className="text-xs text-muted-foreground">PREDICTED OUTCOME</span>
                  <span className="font-bold text-primary">{selectedPrediction.predictedOutcome}</span>
                </div>
                <div className="flex justify-between items-center border-b border-border/50 pb-2">
                  <span className="text-xs text-muted-foreground">ODDS</span>
                  <span className="font-bold">{selectedPrediction.odds.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center border-b border-border/50 pb-2">
                  <span className="text-xs text-muted-foreground">MODEL CONFIDENCE</span>
                  <span className="font-bold">{(selectedPrediction.confidence * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between items-center border-b border-border/50 pb-2">
                  <span className="text-xs text-muted-foreground">SUGGESTED KELLY STAKE</span>
                  <span className="font-bold">{(selectedPrediction.kellyFraction * 100).toFixed(2)}%</span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">AI REASONING</h4>
                <div className="text-sm bg-muted/10 p-3 rounded-md border border-border/30 whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  {selectedPrediction.reasoning || "No reasoning provided."}
                </div>
              </div>

              {selectedPrediction.status === 'pending' && (
                <div className="pt-4 border-t border-border">
                  <h4 className="text-xs font-bold text-muted-foreground mb-3 uppercase tracking-wider">RESOLVE OUTCOME</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <Button 
                      variant="outline" 
                      className="border-success text-success hover:bg-success hover:text-black font-mono text-xs"
                      onClick={() => handleUpdateResult(selectedPrediction.id, 'won', selectedPrediction.predictedOutcome)}
                    >
                      <CheckCircle className="mr-2 h-4 w-4" /> MARK WON
                    </Button>
                    <Button 
                      variant="outline" 
                      className="border-destructive text-destructive hover:bg-destructive hover:text-white font-mono text-xs"
                      onClick={() => handleUpdateResult(selectedPrediction.id, 'lost', 'Other')}
                    >
                      <XCircle className="mr-2 h-4 w-4" /> MARK LOST
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getStatusColor(status: string) {
  switch (status.toLowerCase()) {
    case 'won': return "border-success text-success bg-success/10";
    case 'lost': return "border-destructive text-destructive bg-destructive/10";
    case 'pending': return "border-warning text-warning bg-warning/10";
    default: return "border-muted-foreground text-muted-foreground bg-muted/10";
  }
}
