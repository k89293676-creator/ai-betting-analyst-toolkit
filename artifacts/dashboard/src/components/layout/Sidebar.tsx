import React from "react";
import { Link, useLocation } from "wouter";
import { 
  BarChart2, 
  BrainCircuit, 
  LayoutDashboard, 
  LineChart, 
  Target
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Predictions", href: "/predictions", icon: Target },
  { name: "Live Odds", href: "/odds", icon: BarChart2 },
  { name: "Performance", href: "/performance", icon: LineChart },
  { name: "AI Analyst", href: "/ai-analyst", icon: BrainCircuit },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div className="flex h-full w-64 flex-col bg-card border-r border-border">
      <div className="flex h-16 shrink-0 items-center px-6 border-b border-border">
        <div className="flex items-center gap-2 font-mono font-bold text-lg tracking-tight text-primary">
          <BrainCircuit className="h-5 w-5" />
          <span>QUANT_AI</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto px-4 py-6">
        <nav className="flex-1 space-y-1">
          {navigation.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors font-mono",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <item.icon
                  className={cn(
                    "mr-3 h-4 w-4 flex-shrink-0",
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )}
                  aria-hidden="true"
                />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
          <span className="text-xs font-mono text-muted-foreground">SYSTEM ONLINE</span>
        </div>
      </div>
    </div>
  );
}
