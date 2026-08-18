'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import KnowledgeBaseManager from '@/components/knowledge-base-manager';
import AgentDesigner from '@/components/agent-designer';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BookOpen, Bot, Loader2 } from 'lucide-react';
import type { Agent } from '@/types';

function KnowledgeBaseContent() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [tab, setTab] = useState<'memory' | 'personality'>(tabParam === 'personality' ? 'personality' : 'memory');
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loadingAgent, setLoadingAgent] = useState(true);

  const fetchAgent = async () => {
    try {
      setLoadingAgent(true);
      const res = await fetch('/api/agents');
      if (res.ok) {
        const agents: Agent[] = await res.json();
        const active = agents.find((a) => a.status === 'active') || agents[0] || null;
        if (active?.id) {
          const fullRes = await fetch(`/api/agents/${active.id}`);
          if (fullRes.ok) {
            const fullData = await fullRes.json();
            setAgent(fullData);
            return;
          }
        }
        setAgent(active);
      }
    } catch (e) {
      console.error('Failed to load agent for personality manager', e);
    } finally {
      setLoadingAgent(false);
    }
  };

  useEffect(() => {
    fetchAgent();
  }, []);

  useEffect(() => {
    if (tabParam === 'personality') {
      setTab('personality');
    } else if (tabParam === 'memory') {
      setTab('memory');
    }
  }, [tabParam]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-headline text-3xl font-bold flex items-center gap-2.5">
          <BookOpen className="h-7 w-7 text-primary" /> AI Memory & Personality
        </h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Feed verified business facts, store hours, pricing FAQs, and documents to your AI, and customize your bot&apos;s
          identity, avatar, tone of voice, and prompt instructions — all in one place.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'memory' | 'personality')} className="space-y-4 sm:space-y-6">
        <TabsList className="grid grid-cols-2 w-full sm:w-auto sm:flex bg-muted/70 p-1 border rounded-xl">
          <TabsTrigger value="memory" className="gap-1.5 text-xs sm:text-sm font-medium cursor-pointer">
            <BookOpen className="h-4 w-4" /> <span className="truncate">Memory & FAQs</span>
          </TabsTrigger>
          <TabsTrigger value="personality" className="gap-1.5 text-xs sm:text-sm font-medium cursor-pointer">
            <Bot className="h-4 w-4" /> <span className="truncate">AI Personality</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="memory" className="space-y-6 focus-visible:outline-none">
          <KnowledgeBaseManager />
        </TabsContent>

        <TabsContent value="personality" className="space-y-6 focus-visible:outline-none">
          {loadingAgent ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Loading AI Personality...</p>
            </div>
          ) : (
            <AgentDesigner agent={agent} onSaved={fetchAgent} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function KnowledgeBasePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading AI Memory & Personality...</div>}>
      <KnowledgeBaseContent />
    </Suspense>
  );
}
