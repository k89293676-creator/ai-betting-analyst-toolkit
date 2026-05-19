import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Shell } from "@/components/layout/Shell";
import Dashboard from "@/pages/Dashboard";
import Predictions from "@/pages/Predictions";
import Odds from "@/pages/Odds";
import Performance from "@/pages/Performance";
import AIAnalyst from "@/pages/AIAnalyst";
import { useEffect } from "react";

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/predictions" component={Predictions} />
        <Route path="/odds" component={Odds} />
        <Route path="/performance" component={Performance} />
        <Route path="/ai-analyst" component={AIAnalyst} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  // Force dark mode
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
