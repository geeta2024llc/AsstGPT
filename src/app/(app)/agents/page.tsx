'use client';

import { useState } from 'react';
import AgentDesigner from '@/components/agent-designer';
import AgentList from '@/components/agent-list';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Bot, ListChecks } from 'lucide-react';
import type { Agent } from '@/types';

type AgentsTab = 'designer' | 'list';

export default function AgentsPage() {
  const [tab, setTab] = useState<AgentsTab>('list');
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [isDesignerDirty, setIsDesignerDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<AgentsTab | null>(null);

  const requestTabChange = (next: AgentsTab) => {
    if (next === tab) return;
    if (tab === 'designer' && isDesignerDirty) {
      setPendingTab(next);
      return;
    }
    setTab(next);
  };

  const handleCreate = () => {
    setEditingAgent(null);
    if (tab === 'designer' && isDesignerDirty) {
      // Already on the designer with unsaved work for a different agent — confirm before resetting.
      setPendingTab('designer');
      return;
    }
    setTab('designer');
  };

  const handleEdit = async (agent: Agent) => {
    try {
      const res = await fetch(`/api/agents/${agent.id}`);
      const fullAgent = await res.json();
      setEditingAgent(fullAgent);
      setTab('designer');
    } catch (e) {
      console.error('Failed to load agent', e);
    }
  };

  const handleSaved = () => {
    setEditingAgent(null);
    setIsDesignerDirty(false);
    setTab('list');
  };

  const confirmDiscardAndSwitch = () => {
    if (pendingTab) {
      if (pendingTab === 'designer') {
        // Triggered via "New Agent" while unsaved work existed — reset to a blank agent.
        setEditingAgent(null);
      }
      setIsDesignerDirty(false);
      setTab(pendingTab);
    }
    setPendingTab(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline text-3xl font-bold">AI Agents</h1>
        <p className="text-muted-foreground">
          Agents automatically respond to your WhatsApp conversations — with AI-generated replies or
          fixed keyword rules. Create one, then test it before it goes live.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => requestTabChange(v as AgentsTab)} className="space-y-6">
        <TabsList>
          <TabsTrigger value="list" className="gap-2">
            <ListChecks className="h-4 w-4" /> All Agents
          </TabsTrigger>
          <TabsTrigger value="designer" className="gap-2">
            <Bot className="h-4 w-4" /> {editingAgent ? 'Edit Agent' : 'New Agent'}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <AgentList onEdit={handleEdit} onCreate={handleCreate} />
        </TabsContent>
        <TabsContent value="designer">
          <AgentDesigner agent={editingAgent} onSaved={handleSaved} onDirtyChange={setIsDesignerDirty} />
        </TabsContent>
      </Tabs>

      <AlertDialog open={pendingTab !== null} onOpenChange={(open) => !open && setPendingTab(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this agent. Leaving now will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscardAndSwitch}>Discard Changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
