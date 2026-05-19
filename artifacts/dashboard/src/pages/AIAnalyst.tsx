import React, { useState, useEffect, useRef } from "react";
import { useListGeminiConversations, useCreateGeminiConversation, useGetGeminiConversation } from "@workspace/api-client-react";
import { BrainCircuit, Send, MessageSquarePlus, Terminal, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";

export default function AIAnalyst() {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const { data: conversations, refetch: refetchConvos } = useListGeminiConversations();
  const createConvo = useCreateGeminiConversation();
  
  // Use enabled to conditionally fetch conversation details
  const { data: activeConversation, refetch: refetchActive } = useGetGeminiConversation(
    activeId as number, 
    { query: { enabled: !!activeId } }
  );

  const [localMessages, setLocalMessages] = useState<any[]>([]);

  // Update local messages when active conversation changes
  useEffect(() => {
    if (activeConversation) {
      setLocalMessages(activeConversation.messages || []);
    } else {
      setLocalMessages([]);
    }
  }, [activeConversation]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [localMessages]);

  const handleCreateNew = async () => {
    try {
      const title = `Analysis Session ${format(new Date(), 'HH:mm')}`;
      const res = await createConvo.mutateAsync({ data: { title } });
      setActiveId(res.id);
      refetchConvos();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeId || isStreaming) return;

    const userMessage = input.trim();
    setInput("");
    setIsStreaming(true);

    // Add user message to local state immediately
    setLocalMessages(prev => [...prev, { id: Date.now(), role: 'user', content: userMessage }]);
    
    // Create a placeholder for assistant response
    const assistantMsgId = Date.now() + 1;
    setLocalMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '' }]);

    try {
      const response = await fetch(`/api/gemini/conversations/${activeId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userMessage })
      });

      if (!response.body) throw new Error('No readable stream');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (!dataStr) continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.content) {
                setLocalMessages(prev => 
                  prev.map(msg => 
                    msg.id === assistantMsgId 
                      ? { ...msg, content: msg.content + data.content } 
                      : msg
                  )
                );
              }
              if (data.done) {
                refetchActive(); // refresh server state after done
              }
            } catch (err) {
              console.error('Error parsing SSE data', err, dataStr);
            }
          }
        }
      }
    } catch (err) {
      console.error('Streaming error', err);
      setLocalMessages(prev => 
        prev.map(msg => 
          msg.id === assistantMsgId 
            ? { ...msg, content: 'Error communicating with AI model.' } 
            : msg
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div className="flex h-full max-h-[calc(100vh-4rem)] p-8 gap-6 max-w-[1400px] mx-auto">
      {/* Sidebar for conversations */}
      <Card className="w-80 flex-shrink-0 bg-card border-border flex flex-col shadow-lg overflow-hidden hidden md:flex">
        <div className="p-4 border-b border-border bg-muted/20 flex justify-between items-center">
          <h2 className="font-mono text-sm font-bold tracking-wider text-muted-foreground flex items-center gap-2">
            <Terminal className="h-4 w-4" /> SESSIONS
          </h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={handleCreateNew}>
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1 p-2">
          <div className="space-y-1">
            {conversations?.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setActiveId(conv.id)}
                className={`w-full text-left px-3 py-3 rounded-md font-mono text-xs transition-colors truncate
                  ${activeId === conv.id ? 'bg-primary/10 text-primary font-bold border border-primary/20' : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'}`}
              >
                {conv.title}
                <div className="text-[10px] font-normal opacity-50 mt-1">
                  {format(new Date(conv.createdAt), "MMM d, HH:mm")}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </Card>

      {/* Main chat area */}
      <Card className="flex-1 bg-card border-border flex flex-col shadow-lg overflow-hidden relative">
        {!activeId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
            <BrainCircuit className="h-16 w-16 text-muted-foreground/30 mb-2" />
            <h2 className="text-xl font-mono font-bold tracking-tight text-primary">AWAITING INPUT</h2>
            <p className="text-muted-foreground font-mono text-sm max-w-md">
              Initialize a new session to query the Gemini quantitative model regarding match dynamics, odds analysis, or strategy formulation.
            </p>
            <Button onClick={handleCreateNew} className="font-mono mt-4 uppercase tracking-wider">
              INITIALIZE SESSION
            </Button>
          </div>
        ) : (
          <>
            <div className="px-6 py-4 border-b border-border bg-muted/20 flex items-center justify-between shadow-sm z-10">
              <div className="font-mono font-bold text-primary flex items-center gap-2">
                <BrainCircuit className="h-5 w-5" /> 
                {activeConversation?.title || 'Loading...'}
              </div>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                </span>
                <span className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Connected</span>
              </div>
            </div>

            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-6 bg-background/50"
            >
              {localMessages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm opacity-50">
                  SYSTEM READY. AWAITING QUERY.
                </div>
              ) : (
                localMessages.map((msg, idx) => (
                  <div key={msg.id || idx} className={`flex gap-4 max-w-[85%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
                    <div className={`flex-shrink-0 h-8 w-8 rounded flex items-center justify-center border ${
                      msg.role === 'user' 
                        ? 'bg-muted/30 border-muted text-muted-foreground' 
                        : 'bg-primary/10 border-primary/30 text-primary'
                    }`}>
                      {msg.role === 'user' ? <User className="h-4 w-4" /> : <BrainCircuit className="h-4 w-4" />}
                    </div>
                    <div className={`rounded-lg px-4 py-3 font-mono text-sm leading-relaxed border shadow-sm ${
                      msg.role === 'user' 
                        ? 'bg-muted/20 border-border text-foreground' 
                        : 'bg-card border-primary/20 text-card-foreground whitespace-pre-wrap'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t border-border bg-card">
              <form onSubmit={handleSend} className="relative flex items-center">
                <div className="absolute left-4 text-primary font-mono select-none pointer-events-none">&gt;</div>
                <Input 
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Enter query parameters..." 
                  disabled={isStreaming}
                  className="pl-8 pr-12 py-6 bg-background border-border font-mono text-sm focus-visible:ring-primary focus-visible:border-primary shadow-inner"
                />
                <Button 
                  type="submit" 
                  disabled={!input.trim() || isStreaming}
                  size="icon"
                  className="absolute right-2 h-8 w-8 bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
