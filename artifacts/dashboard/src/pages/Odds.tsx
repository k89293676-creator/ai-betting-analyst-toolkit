import React, { useState } from "react";
import { useGetSports, useGetOdds, useCreatePrediction } from "@workspace/api-client-react";
import { BarChart2, Search, Target, RefreshCw, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function Odds() {
  const [selectedSport, setSelectedSport] = useState<string>("soccer_epl");
  const { toast } = useToast();

  const { data: sports, isLoading: isLoadingSports } = useGetSports();
  const { data: oddsData, isLoading: isLoadingOdds, refetch: refetchOdds, isFetching: isFetchingOdds } = useGetOdds(
    { sport: selectedSport, regions: 'uk,us' },
    { query: { enabled: !!selectedSport } }
  );

  const createPrediction = useCreatePrediction();

  const handleGeneratePrediction = async (match: any, homeOdds: number, awayOdds: number, drawOdds?: number) => {
    try {
      toast({
        title: "Analyzing match...",
        description: "Gemini is generating prediction based on current odds.",
        className: "font-mono border-primary bg-background",
      });
      
      await createPrediction.mutateAsync({
        data: {
          sport: selectedSport,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          matchDate: match.commenceTime,
          homeOdds,
          awayOdds,
          drawOdds
        }
      });
      
      toast({
        title: "Prediction Generated",
        description: "Check the Signals Log to view.",
        className: "font-mono border-success text-success bg-background",
      });
    } catch (error) {
      toast({
        title: "Analysis Failed",
        variant: "destructive",
        className: "font-mono",
      });
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <h1 className="text-3xl font-bold font-mono tracking-tight text-primary flex items-center gap-2">
          <BarChart2 className="h-6 w-6" /> MARKET_SCANNER
        </h1>

        <div className="flex items-center gap-3">
          <Select value={selectedSport} onValueChange={setSelectedSport}>
            <SelectTrigger className="w-[250px] font-mono text-xs border-border bg-card">
              <SelectValue placeholder="SELECT MARKET" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {isLoadingSports ? (
                <SelectItem value="loading" disabled>LOADING...</SelectItem>
              ) : (
                sports?.map(s => (
                  <SelectItem key={s.key} value={s.key}>{s.title}</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          
          <Button 
            variant="outline" 
            size="icon" 
            onClick={() => refetchOdds()} 
            disabled={isFetchingOdds}
            className="border-border bg-card"
          >
            <RefreshCw className={`h-4 w-4 ${isFetchingOdds ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0 bg-card border border-border rounded-lg shadow-lg relative">
        {isLoadingOdds || isFetchingOdds ? (
          <div className="p-6 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex flex-col space-y-3 p-4 border border-border/50 rounded-md bg-muted/10">
                <Skeleton className="h-5 w-1/3 bg-muted" />
                <div className="flex gap-4">
                  <Skeleton className="h-10 w-24 bg-muted" />
                  <Skeleton className="h-10 w-24 bg-muted" />
                  <Skeleton className="h-10 w-24 bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : oddsData && oddsData.length > 0 ? (
          <div className="divide-y divide-border/50">
            {oddsData.map((match) => {
              // Find first bookmaker with h2h market
              const bookmaker = match.bookmakers?.find(b => b.markets?.some(m => m.key === 'h2h'));
              const market = bookmaker?.markets?.find(m => m.key === 'h2h');
              
              const homeOutcome = market?.outcomes?.find(o => o.name === match.homeTeam);
              const awayOutcome = market?.outcomes?.find(o => o.name === match.awayTeam);
              const drawOutcome = market?.outcomes?.find(o => o.name.toLowerCase() === 'draw');

              if (!homeOutcome || !awayOutcome) return null;

              return (
                <div key={match.id} className="p-6 hover:bg-muted/5 transition-colors group">
                  <div className="flex flex-col md:flex-row justify-between gap-6">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                        <span>{format(new Date(match.commenceTime), "dd MMM yyyy • HH:mm")}</span>
                        <span>•</span>
                        <span className="text-primary">{bookmaker?.title || 'Unknown Bookmaker'}</span>
                      </div>
                      <div className="text-xl font-bold font-mono tracking-tight flex items-center gap-3">
                        <span className="flex-1 text-right">{match.homeTeam}</span>
                        <span className="text-muted-foreground font-normal text-sm px-2">VS</span>
                        <span className="flex-1">{match.awayTeam}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="flex gap-2">
                        <div className="flex flex-col items-center bg-background border border-border rounded px-4 py-2 min-w-[80px]">
                          <span className="text-[10px] text-muted-foreground mb-1 font-mono">1</span>
                          <span className="font-mono font-bold text-primary">{homeOutcome.price.toFixed(2)}</span>
                        </div>
                        {drawOutcome && (
                          <div className="flex flex-col items-center bg-background border border-border rounded px-4 py-2 min-w-[80px]">
                            <span className="text-[10px] text-muted-foreground mb-1 font-mono">X</span>
                            <span className="font-mono font-bold">{drawOutcome.price.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex flex-col items-center bg-background border border-border rounded px-4 py-2 min-w-[80px]">
                          <span className="text-[10px] text-muted-foreground mb-1 font-mono">2</span>
                          <span className="font-mono font-bold text-primary">{awayOutcome.price.toFixed(2)}</span>
                        </div>
                      </div>
                      
                      <Button 
                        onClick={() => handleGeneratePrediction(match, homeOutcome.price, awayOutcome.price, drawOutcome?.price)}
                        disabled={createPrediction.isPending}
                        className="font-mono text-xs uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground h-12 w-32"
                      >
                        {createPrediction.isPending ? 'ANALYZING...' : (
                          <>
                            <Zap className="mr-2 h-4 w-4" /> ANALYZE
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-12">
            <BarChart2 className="h-16 w-16 mb-4 opacity-20" />
            <p className="font-mono text-sm tracking-widest uppercase">NO ACTIVE MARKETS FOUND FOR SELECTED SPORT</p>
          </div>
        )}
      </div>
    </div>
  );
}
