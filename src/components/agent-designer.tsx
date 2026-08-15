'use client';

import type { Agent, AgentMode, AIProvider, AgentRule, KnowledgeFile } from '@/types';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Sparkles,
  Trash2,
  PlusCircle,
  Loader2,
  FilePen,
  Bot,
  BookCopy,
  Mic,
  Eye,
  Save,
  Info,
  MessageCircle,
  SendHorizontal,
  CircleAlert,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { getAiSuggestions, testAgentReply } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { useSettings } from '@/hooks/use-settings';
import { cn } from '@/lib/utils';

const SYSTEM_PROMPT_LIMIT = 1000;

const agentFormSchema = z.object({
  name: z.string().min(3, 'Agent name must be at least 3 characters.'),
  description: z.string().optional(),
  fallbackResponse: z.string().optional(),
});

type AgentFormValues = z.infer<typeof agentFormSchema>;

function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex text-muted-foreground hover:text-foreground"
          aria-label="More information"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{children}</TooltipContent>
    </Tooltip>
  );
}

interface AgentDesignerProps {
  agent?: Agent | null;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function AgentDesigner({ agent, onSaved, onDirtyChange }: AgentDesignerProps) {
  const [mode, setMode] = useState<AgentMode>(agent?.mode ?? 'ai');
  const [aiSettings, setAISettings] = useState({
    provider: (agent?.aiSettings?.provider ?? 'groq') as AIProvider,
    apiKey: agent?.aiSettings?.apiKey ?? '',
    systemPrompt: agent?.aiSettings?.systemPrompt ?? 'You are a helpful customer service assistant on WhatsApp.',
    maxLen: agent?.aiSettings?.maxLen ?? 500,
    temperature: agent?.aiSettings?.temperature !== undefined ? Number(agent.aiSettings.temperature) : 0.7,
    knowledgeFileIds: Array.isArray(agent?.aiSettings?.knowledgeFileIds) ? [...agent.aiSettings.knowledgeFileIds] : [],
    enableVoiceResponse: agent?.aiSettings?.enableVoiceResponse ?? false,
    enableVision: agent?.aiSettings?.enableVision ?? true,
    voiceProvider: (agent?.aiSettings?.voiceProvider ?? 'google') as 'google' | 'openai' | 'elevenlabs',
  });

  const [rules, setRules] = useState<AgentRule[]>(agent?.rules ?? []);
  const [newResponses, setNewResponses] = useState<Record<string, string>>({});
  const [suggestedResponses, setSuggestedResponses] = useState<Record<string, string[]>>({});
  const [isSuggesting, setIsSuggesting] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
  const [dirtyExtra, setDirtyExtra] = useState(false);
  const { toast } = useToast();
  const { autoLoadKnowledge } = useSettings();

  // "Test Your Agent" live preview panel
  const [testMessages, setTestMessages] = useState<{ role: 'user' | 'agent' | 'error'; text: string }[]>([]);
  const [testInput, setTestInput] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const testScrollRef = useRef<HTMLDivElement>(null);

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: agent?.name || '',
      description: agent?.description || '',
      fallbackResponse: agent?.fallbackResponse || 'Sorry, I am currently unable to assist with that.',
    },
  });

  const isDirty = form.formState.isDirty || dirtyExtra;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const updateAISettings = useCallback((partial: Partial<typeof aiSettings>) => {
    setAISettings((s) => ({ ...s, ...partial }));
    setDirtyExtra(true);
  }, []);

  // Sync state when editing a different agent prop
  useEffect(() => {
    if (agent) {
      form.reset({
        name: agent.name || '',
        description: agent.description || '',
        fallbackResponse: agent.fallbackResponse || 'Sorry, I am currently unable to assist with that.',
      });
      setMode(agent.mode || 'ai');
      setRules(agent.rules || []);
      setAISettings({
        provider: (agent.aiSettings?.provider ?? 'groq') as AIProvider,
        apiKey: agent.aiSettings?.apiKey ?? '',
        systemPrompt: agent.aiSettings?.systemPrompt ?? 'You are a helpful customer service assistant on WhatsApp.',
        maxLen: agent.aiSettings?.maxLen ?? 500,
        temperature: agent.aiSettings?.temperature !== undefined ? Number(agent.aiSettings.temperature) : 0.7,
        knowledgeFileIds: Array.isArray(agent.aiSettings?.knowledgeFileIds) ? [...agent.aiSettings.knowledgeFileIds] : [],
        enableVoiceResponse: agent.aiSettings?.enableVoiceResponse ?? false,
        enableVision: agent.aiSettings?.enableVision ?? true,
        voiceProvider: (agent.aiSettings?.voiceProvider ?? 'google') as 'google' | 'openai' | 'elevenlabs',
      });
    } else {
      form.reset({
        name: '',
        description: '',
        fallbackResponse: 'Sorry, I am currently unable to assist with that.',
      });
      setMode('ai');
      setRules([]);
    }
    setDirtyExtra(false);
    setTestMessages([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  useEffect(() => {
    const fetchKnowledgeFiles = async () => {
      try {
        const res = await fetch('/api/knowledge');
        if (!res.ok) throw new Error('Could not fetch knowledge files');
        const data = await res.json();
        setKnowledgeFiles(data);
      } catch (e) {
        toast({ variant: 'destructive', title: 'Error', description: (e as Error).message });
      }
    };
    fetchKnowledgeFiles();
  }, [toast]);

  useEffect(() => {
    testScrollRef.current?.scrollTo({ top: testScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [testMessages, isTesting]);

  const addRule = () => {
    const newRule: AgentRule = {
      id: `rule_${Date.now()}`,
      trigger: { type: 'keywords', value: '' },
      responses: [],
      knowledgeFileIds: autoLoadKnowledge ? knowledgeFiles.map((f) => f.id) : [],
    };
    setRules([...rules, newRule]);
    setDirtyExtra(true);
  };

  const deleteRule = (ruleId: string) => {
    setRules(rules.filter((rule) => rule.id !== ruleId));
    setDirtyExtra(true);
  };

  const updateRuleTrigger = (ruleId: string, value: string) => {
    setRules(
      rules.map((rule) =>
        rule.id === ruleId ? { ...rule, trigger: { ...rule.trigger, value } } : rule
      )
    );
    setDirtyExtra(true);
  };

  const addResponseToRule = (ruleId: string, response: string) => {
    if (!response.trim()) return;
    setRules(
      rules.map((rule) =>
        rule.id === ruleId
          ? { ...rule, responses: [...rule.responses, response] }
          : rule
      )
    );
    setNewResponses((prev) => ({ ...prev, [ruleId]: '' }));
    setDirtyExtra(true);
  };

  const removeResponseFromRule = (ruleId: string, responseIndex: number) => {
    setRules(
      rules.map((rule) =>
        rule.id === ruleId
          ? { ...rule, responses: rule.responses.filter((_, i) => i !== responseIndex) }
          : rule
      )
    );
    setDirtyExtra(true);
  };

  const updateRuleKnowledgeFiles = (ruleId: string, fileId: string, checked: boolean) => {
    setRules(
      rules.map((rule) => {
        if (rule.id === ruleId) {
          const currentFiles = rule.knowledgeFileIds || [];
          const newFiles = checked
            ? [...currentFiles, fileId]
            : currentFiles.filter((id) => id !== fileId);
          return { ...rule, knowledgeFileIds: newFiles };
        }
        return rule;
      })
    );
    setDirtyExtra(true);
  };

  const toggleAIKnowledgeFile = (fileId: string, checked: boolean) => {
    const current = aiSettings.knowledgeFileIds || [];
    const updated = checked ? [...current, fileId] : current.filter((id) => id !== fileId);
    updateAISettings({ knowledgeFileIds: updated });
  };

  const handleGetSuggestions = async (ruleId: string, keywords: string, knowledgeFileIds?: string[]) => {
    if (!keywords) {
      toast({ variant: 'destructive', title: 'Keywords required for AI suggestions.' });
      return;
    }
    setIsSuggesting((prev) => ({ ...prev, [ruleId]: true }));
    setSuggestedResponses((prev) => ({ ...prev, [ruleId]: [] }));

    try {
      const result = await getAiSuggestions({ keywords, knowledgeFileIds });
      if (result.error) {
        toast({ variant: 'destructive', title: 'AI Suggestion Failed', description: result.error });
      } else {
        setSuggestedResponses((prev) => ({ ...prev, [ruleId]: result.suggestions || [] }));
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'An unexpected error occurred.' });
    } finally {
      setIsSuggesting((prev) => ({ ...prev, [ruleId]: false }));
    }
  };

  const addSuggestedResponse = (ruleId: string, suggestion: string) => {
    addResponseToRule(ruleId, suggestion);
    setSuggestedResponses((prev) => ({
      ...prev,
      [ruleId]: prev[ruleId].filter((s) => s !== suggestion),
    }));
  };

  const handleModeChange = (val: string) => {
    setMode(val as AgentMode);
    setDirtyExtra(true);
  };

  const runRuleModePreview = (message: string): string => {
    const lower = message.toLowerCase();
    const matchedRule = rules.find((rule) => {
      const keywords = rule.trigger.value.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
      return keywords.some((k) => lower.includes(k));
    });
    if (!matchedRule) {
      return form.getValues('fallbackResponse') || 'Sorry, I am currently unable to assist with that.';
    }
    if (matchedRule.responses.length === 0) {
      return `Matched "Rule for: ${matchedRule.trigger.value}" but it has no responses configured yet. Add one above.`;
    }
    return matchedRule.responses[Math.floor(Math.random() * matchedRule.responses.length)];
  };

  const handleTestSend = async () => {
    const message = testInput.trim();
    if (!message || isTesting) return;
    setTestMessages((prev) => [...prev, { role: 'user', text: message }]);
    setTestInput('');

    if (mode === 'rule') {
      const reply = runRuleModePreview(message);
      setTestMessages((prev) => [...prev, { role: 'agent', text: reply }]);
      return;
    }

    setIsTesting(true);
    try {
      const result = await testAgentReply({
        message,
        aiSettings: {
          provider: aiSettings.provider,
          apiKey: aiSettings.apiKey || undefined,
          systemPrompt: aiSettings.systemPrompt || 'You are a helpful assistant.',
          maxLen: aiSettings.maxLen || 500,
          temperature: aiSettings.temperature,
          knowledgeFileIds: aiSettings.knowledgeFileIds,
          enableVoiceResponse: aiSettings.enableVoiceResponse,
          enableVision: aiSettings.enableVision,
          voiceProvider: aiSettings.voiceProvider,
        },
      });
      if (result.error) {
        setTestMessages((prev) => [...prev, { role: 'error', text: result.error! }]);
      } else {
        setTestMessages((prev) => [...prev, { role: 'agent', text: result.reply || '(empty response)' }]);
      }
    } catch (e) {
      setTestMessages((prev) => [...prev, { role: 'error', text: 'Unexpected error while testing the agent.' }]);
    } finally {
      setIsTesting(false);
    }
  };

  const onSubmit = async (data: AgentFormValues) => {
    const effectiveMode: AgentMode = mode;

    if (effectiveMode === 'rule' && rules.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Please add at least one automation rule, or switch to AI Mode.',
      });
      return;
    }

    setIsSaving(true);

    const aiSettingsPayload =
      effectiveMode === 'ai'
        ? {
            provider: aiSettings.provider,
            apiKey: aiSettings.apiKey || '',
            systemPrompt: aiSettings.systemPrompt || 'You are a helpful assistant.',
            maxLen: aiSettings.maxLen || 500,
            temperature: aiSettings.temperature !== undefined ? Number(aiSettings.temperature) : 0.7,
            knowledgeFileIds: [...(aiSettings.knowledgeFileIds || [])],
            enableVoiceResponse: Boolean(aiSettings.enableVoiceResponse),
            enableVision: Boolean(aiSettings.enableVision),
            voiceProvider: aiSettings.voiceProvider || 'google',
          }
        : undefined;

    const agentData = {
      ...data,
      mode: effectiveMode,
      rules: effectiveMode === 'rule' ? rules : [],
      aiSettings: aiSettingsPayload,
    };

    try {
      const endpoint = agent ? `/api/agents/${agent.id}` : '/api/agents';
      const method = agent ? 'PATCH' : 'POST';

      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save agent');
      }

      toast({
        title: 'Agent Saved!',
        description: `Agent "${data.name}" has been ${agent ? 'updated' : 'configured'} in ${effectiveMode.toUpperCase()} mode.`,
      });

      setDirtyExtra(false);
      if (!agent) {
        form.reset();
        setRules([]);
      } else {
        form.reset(data);
      }
      onSaved?.();
    } catch (error) {
      console.error('Error saving agent:', error);
      toast({ variant: 'destructive', title: 'Save Failed', description: (error as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          {/* Header / Save bar */}
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-headline flex items-center gap-2 text-xl font-semibold">
                <FilePen className="h-5 w-5 text-primary" />
                {agent ? `Editing: ${agent.name}` : 'New Agent'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isDirty ? 'You have unsaved changes.' : 'Fill in the sections below, then save when ready.'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isDirty && (
                <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                  Unsaved changes
                </Badge>
              )}
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Agent
              </Button>
            </div>
          </div>

          {/* Core Agent Info */}
          <Card>
            <CardHeader>
              <CardTitle className="font-headline flex items-center gap-2 text-2xl">
                <FilePen className="h-6 w-6 text-primary" />
                Identity
              </CardTitle>
              <CardDescription>
                Give this agent a clear name and description so your team can recognize it at a glance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agent Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., WhatsApp Customer Support" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agent Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe what this agent handles, e.g. 'Answers customer inquiries on WhatsApp about products, pricing, and business hours.'"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Mode Selector */}
          <Tabs value={mode} onValueChange={handleModeChange} className="space-y-6">
            <div>
              <h3 className="mb-3 font-headline text-lg font-semibold">How should this agent reply?</h3>
              <TabsList className="grid h-auto w-full grid-cols-1 gap-3 bg-transparent p-0 sm:grid-cols-2">
                <TabsTrigger
                  value="ai"
                  className="h-auto flex-col items-start gap-1.5 whitespace-normal rounded-lg border-2 bg-card p-4 text-left shadow-sm data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-none data-[state=inactive]:border-muted"
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <Sparkles className="h-5 w-5 text-primary" /> AI Mode
                  </div>
                  <p className="text-xs font-normal text-muted-foreground">
                    The AI reads each message and writes its own reply, optionally grounded in your knowledge base. Best for open-ended support.
                  </p>
                </TabsTrigger>
                <TabsTrigger
                  value="rule"
                  className="h-auto flex-col items-start gap-1.5 whitespace-normal rounded-lg border-2 bg-card p-4 text-left shadow-sm data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-none data-[state=inactive]:border-muted"
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <Bot className="h-5 w-5" /> Keyword Rule Mode
                  </div>
                  <p className="text-xs font-normal text-muted-foreground">
                    You define exact keywords and pick the canned replies for each. Fully predictable, no AI calls. Best for FAQs.
                  </p>
                </TabsTrigger>
              </TabsList>
            </div>

            {/* AI SETTINGS TAB */}
            <TabsContent value="ai" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="font-headline text-2xl flex items-center gap-2">
                    <Sparkles className="h-6 w-6 text-primary" /> AI Model & Provider
                  </CardTitle>
                  <CardDescription>
                    Configure LLM provider, system personality, and response parameters.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Provider Selection */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormItem className="flex flex-col space-y-2">
                      <FormLabel>AI Provider</FormLabel>
                      <Select
                        value={aiSettings.provider}
                        onValueChange={(val: string) => updateAISettings({ provider: val as AIProvider })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose provider" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="groq">Groq (Llama 3.3 70B - Ultra Fast ⚡)</SelectItem>
                          <SelectItem value="gemini">Google Gemini (Flash)</SelectItem>
                          <SelectItem value="openai">OpenAI (GPT-4o Mini)</SelectItem>
                          <SelectItem value="anthropic">Anthropic (Claude 3.5)</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>

                    {/* API Key Override */}
                    <FormItem className="flex flex-col space-y-2">
                      <FormLabel className="flex items-center gap-1.5">
                        API Key (Optional override)
                        <InfoTip>
                          Leave blank to use the API key already configured in your server&apos;s environment
                          variables. Only set this if you want this specific agent to use a different key.
                        </InfoTip>
                      </FormLabel>
                      <Input
                        type="password"
                        placeholder="Leave blank to use environment variable"
                        value={aiSettings.apiKey || ''}
                        onChange={(e) => updateAISettings({ apiKey: e.target.value })}
                      />
                    </FormItem>
                  </div>

                  {/* System Prompt */}
                  <FormItem className="space-y-2">
                    <FormLabel className="flex items-center gap-1.5">
                      System Instructions
                      <InfoTip>
                        This is the agent&apos;s personality and rulebook — tell it who it is, how to speak, and what
                        it should never say. It&apos;s sent before every conversation.
                      </InfoTip>
                    </FormLabel>
                    <Textarea
                      maxLength={SYSTEM_PROMPT_LIMIT}
                      rows={4}
                      value={aiSettings.systemPrompt || ''}
                      onChange={(e) => updateAISettings({ systemPrompt: e.target.value })}
                      placeholder="You are a helpful customer service representative. Reply concisely, clearly, and politely in English or Nepali..."
                    />
                    <p className="text-xs text-muted-foreground text-right">
                      {(aiSettings.systemPrompt || '').length}/{SYSTEM_PROMPT_LIMIT}
                    </p>
                  </FormItem>

                  {/* Params */}
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        Max Response Length (Tokens)
                        <InfoTip>
                          Roughly how long a single reply can be. Lower values give shorter, cheaper, faster
                          replies; higher values allow more detailed answers.
                        </InfoTip>
                      </FormLabel>
                      <Input
                        type="number"
                        min={50}
                        max={2000}
                        value={aiSettings.maxLen || 500}
                        onChange={(e) => updateAISettings({ maxLen: Number(e.target.value) })}
                      />
                    </FormItem>

                    <FormItem className="space-y-3">
                      <FormLabel className="flex items-center gap-1.5">
                        Creativity (Temperature)
                        <InfoTip>
                          Controls how predictable vs. varied replies are. Keep this low for accurate,
                          factual support answers; raise it for more casual, varied conversation.
                        </InfoTip>
                      </FormLabel>
                      <div className="flex items-center gap-3">
                        <span className="w-24 shrink-0 text-xs text-muted-foreground">Focused</span>
                        <Slider
                          value={[aiSettings.temperature ?? 0.7]}
                          min={0}
                          max={1}
                          step={0.05}
                          onValueChange={(val) => updateAISettings({ temperature: val[0] })}
                        />
                        <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">Creative</span>
                      </div>
                      <p className="text-center text-xs font-medium text-muted-foreground">
                        {(aiSettings.temperature ?? 0.7).toFixed(2)}
                      </p>
                    </FormItem>
                  </div>

                  {/* Knowledge Base Sources for AI */}
                  <div className="space-y-2 rounded-lg border p-4 bg-muted/20">
                    <FormLabel className="flex items-center gap-2 font-semibold text-sm">
                      <BookCopy className="h-4 w-4 text-primary" /> RAG Knowledge Base Documents
                    </FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Select documents for the AI to reference when answering store questions (pricing, location, hours, FAQ).
                    </p>
                    {knowledgeFiles.length > 0 ? (
                      <ScrollArea className="h-36 rounded-md border p-2 bg-background">
                        <div className="space-y-2">
                          {knowledgeFiles.map((file) => (
                            <div key={file.id} className="flex items-center space-x-2">
                              <Checkbox
                                id={`ai-file-${file.id}`}
                                checked={aiSettings.knowledgeFileIds?.includes(file.id)}
                                onCheckedChange={(checked) =>
                                  toggleAIKnowledgeFile(file.id, !!checked)
                                }
                              />
                              <label
                                htmlFor={`ai-file-${file.id}`}
                                className="text-sm font-medium leading-none cursor-pointer"
                              >
                                {file.fileName}
                              </label>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    ) : (
                      <p className="py-3 text-center text-xs text-muted-foreground">
                        No documents uploaded in Knowledge Base yet.
                      </p>
                    )}
                  </div>

                  {/* Multimodal & Voice Features */}
                  <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" /> Multimodal & Voice Features
                    </h4>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Mic className="h-4 w-4 text-primary" />
                          <FormLabel className="text-sm font-medium">Voice Responses (TTS)</FormLabel>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Automatically reply with WhatsApp voice notes when receiving audio messages.
                        </p>
                      </div>
                      <Switch
                        checked={aiSettings.enableVoiceResponse}
                        onCheckedChange={(checked) => updateAISettings({ enableVoiceResponse: checked })}
                      />
                    </div>

                    {aiSettings.enableVoiceResponse && (
                      <div className="flex items-center justify-between pl-6">
                        <FormLabel className="text-sm font-normal text-muted-foreground">Voice provider</FormLabel>
                        <Select
                          value={aiSettings.voiceProvider}
                          onValueChange={(val: string) =>
                            updateAISettings({ voiceProvider: val as 'google' | 'openai' | 'elevenlabs' })
                          }
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue placeholder="Choose provider" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="google">Google TTS</SelectItem>
                            <SelectItem value="openai">OpenAI TTS</SelectItem>
                            <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Eye className="h-4 w-4 text-primary" />
                          <FormLabel className="text-sm font-medium">Vision & Document Analysis</FormLabel>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Allow the AI to inspect customer images (receipts, screenshots) and PDFs.
                        </p>
                      </div>
                      <Switch
                        checked={aiSettings.enableVision}
                        onCheckedChange={(checked) => updateAISettings({ enableVision: checked })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* RULE SETTINGS TAB */}
            <TabsContent value="rule" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="font-headline flex items-center gap-2 text-2xl">
                    <Bot className="h-6 w-6 text-primary" /> Keyword Automation Rules
                  </CardTitle>
                  <CardDescription>
                    Define keyword triggers and specific canned replies for common phrases.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {rules.length === 0 && (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
                      <Bot className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm font-medium">No rules yet</p>
                      <p className="max-w-sm text-xs text-muted-foreground">
                        Add a rule for each common question — like &quot;hours&quot; or &quot;pricing&quot; — and the
                        exact replies it should send.
                      </p>
                    </div>
                  )}
                  <Accordion type="multiple" className="w-full" defaultValue={rules.map((r) => r.id)}>
                    {rules.map((rule, ruleIndex) => (
                      <AccordionItem value={rule.id} key={rule.id} className="rounded-lg border bg-background">
                        <div className="flex w-full items-center pr-2">
                          <AccordionTrigger className="w-full px-4 text-left hover:no-underline">
                            <div className="flex-1 text-left">
                              <p className="font-semibold text-primary">Rule #{ruleIndex + 1}</p>
                              <p className="text-sm text-muted-foreground">
                                {rule.trigger.value || 'New Rule: Add trigger keywords'}
                              </p>
                            </div>
                          </AccordionTrigger>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0 text-destructive hover:bg-destructive/10"
                            onClick={() => deleteRule(rule.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <AccordionContent className="p-4 pt-0">
                          <div className="space-y-6">
                            <FormItem>
                              <FormLabel className="flex items-center gap-1.5">
                                Trigger Keywords (comma-separated)
                                <InfoTip>
                                  If the customer&apos;s message contains any one of these words, this rule fires.
                                  Keep them short and specific, e.g. &quot;hours, open, timing&quot;.
                                </InfoTip>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="hours, location, payment, contact"
                                  value={rule.trigger.value}
                                  onChange={(e) => updateRuleTrigger(rule.id, e.target.value)}
                                />
                              </FormControl>
                            </FormItem>

                            <div className="space-y-2">
                              <FormLabel className="flex items-center gap-2">
                                <BookCopy className="h-4 w-4" /> Knowledge Base Context
                              </FormLabel>
                              {knowledgeFiles.length > 0 ? (
                                <ScrollArea className="h-32 rounded-md border p-2">
                                  <div className="space-y-2">
                                    {knowledgeFiles.map((file) => (
                                      <div key={file.id} className="flex items-center space-x-2">
                                        <Checkbox
                                          id={`file-${rule.id}-${file.id}`}
                                          checked={rule.knowledgeFileIds?.includes(file.id)}
                                          onCheckedChange={(checked) =>
                                            updateRuleKnowledgeFiles(rule.id, file.id, !!checked)
                                          }
                                        />
                                        <label
                                          htmlFor={`file-${rule.id}-${file.id}`}
                                          className="text-sm font-medium leading-none cursor-pointer"
                                        >
                                          {file.fileName}
                                        </label>
                                      </div>
                                    ))}
                                  </div>
                                </ScrollArea>
                              ) : (
                                <p className="py-2 text-center text-xs text-muted-foreground">
                                  No knowledge files uploaded yet.
                                </p>
                              )}
                            </div>

                            <div className="space-y-2">
                              <FormLabel>Configured Responses ({rule.responses.length})</FormLabel>
                              {rule.responses.map((res, index) => (
                                <div key={index} className="flex items-center gap-2">
                                  <p className="flex-1 rounded-md border bg-secondary p-3 text-sm text-secondary-foreground">
                                    {res}
                                  </p>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeResponseFromRule(rule.id, index)}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              ))}
                              {rule.responses.length === 0 && (
                                <p className="text-sm text-muted-foreground">
                                  No responses configured for this rule yet.
                                </p>
                              )}
                            </div>

                            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                              <FormLabel className="text-base">Add New Response</FormLabel>
                              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start">
                                <Textarea
                                  placeholder="Type custom reply text..."
                                  value={newResponses[rule.id] || ''}
                                  onChange={(e) =>
                                    setNewResponses((prev) => ({
                                      ...prev,
                                      [rule.id]: e.target.value,
                                    }))
                                  }
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="shrink-0"
                                  onClick={() =>
                                    addResponseToRule(rule.id, newResponses[rule.id] || '')
                                  }
                                >
                                  Add
                                </Button>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="h-px flex-1 bg-border" />
                                <span className="text-xs text-muted-foreground">OR</span>
                                <div className="h-px flex-1 bg-border" />
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                className="w-full"
                                onClick={() =>
                                  handleGetSuggestions(
                                    rule.id,
                                    rule.trigger.value,
                                    rule.knowledgeFileIds
                                  )
                                }
                                disabled={isSuggesting[rule.id]}
                              >
                                {isSuggesting[rule.id] ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Sparkles className="mr-2 h-4 w-4 text-accent" />
                                )}
                                Suggest with AI
                              </Button>
                              {suggestedResponses[rule.id] &&
                                suggestedResponses[rule.id].length > 0 && (
                                  <div className="space-y-2 pt-2">
                                    {suggestedResponses[rule.id].map((suggestion, i) => (
                                      <div
                                        key={i}
                                        onClick={() => addSuggestedResponse(rule.id, suggestion)}
                                        className="flex cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-muted"
                                      >
                                        <PlusCircle className="h-4 w-4 shrink-0 text-primary" />
                                        <p className="flex-1 text-sm">{suggestion}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                  <Button type="button" variant="outline" onClick={addRule}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Add Automation Rule
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Test Your Agent */}
          <Card>
            <CardHeader>
              <CardTitle className="font-headline flex items-center gap-2 text-2xl">
                <MessageCircle className="h-6 w-6 text-primary" /> Test Your Agent
              </CardTitle>
              <CardDescription>
                Try a message below to preview how this agent would reply right now, using your current
                (even unsaved) settings — no need to save first.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div
                ref={testScrollRef}
                className="flex h-56 flex-col gap-3 overflow-y-auto rounded-lg border bg-muted/20 p-4"
              >
                {testMessages.length === 0 && (
                  <p className="m-auto text-center text-sm text-muted-foreground">
                    Send a test message like &quot;what are your hours?&quot; to see this agent&apos;s reply.
                  </p>
                )}
                {testMessages.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                      m.role === 'user' && 'ml-auto bg-primary text-primary-foreground',
                      m.role === 'agent' && 'mr-auto bg-background border',
                      m.role === 'error' && 'mr-auto flex items-center gap-2 border border-destructive/40 bg-destructive/10 text-destructive'
                    )}
                  >
                    {m.role === 'error' && <CircleAlert className="h-4 w-4 shrink-0" />}
                    {m.text}
                  </div>
                ))}
                {isTesting && (
                  <div className="mr-auto flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking...
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Type a test message..."
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleTestSend();
                    }
                  }}
                  disabled={isTesting}
                />
                <Button type="button" onClick={handleTestSend} disabled={isTesting || !testInput.trim()}>
                  <SendHorizontal className="h-4 w-4" />
                  <span className="sr-only">Send test message</span>
                </Button>
              </div>
              {mode === 'ai' && !aiSettings.apiKey && (
                <p className="text-xs text-muted-foreground">
                  Testing uses your server&apos;s configured API key for {aiSettings.provider} unless you set an override above.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Global Fallback Response */}
          <Card>
            <CardHeader>
              <CardTitle className="font-headline text-2xl">Fallback Response</CardTitle>
              <CardDescription>
                Sent when no keyword rules match or when the AI is unable to formulate an answer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="fallbackResponse"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        placeholder="e.g., Sorry, I am currently unable to assist with that. Please contact support."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Submit Actions */}
          <div className="flex justify-end gap-4">
            <Button type="submit" size="lg" disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Save className="mr-2 h-5 w-5" />
              )}
              Save Agent Changes
            </Button>
          </div>
        </form>
      </Form>
    </TooltipProvider>
  );
}
