'use client';

import type { Agent, AgentMode, AIProvider, AgentRule, KnowledgeFile } from '@/types';
import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { getAiSuggestions } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { useSettings } from '@/hooks/use-settings';

const SYSTEM_PROMPT_LIMIT = 1000;

const agentFormSchema = z.object({
  name: z.string().min(3, 'Agent name must be at least 3 characters.'),
  description: z.string().optional(),
  fallbackResponse: z.string().optional(),
});

type AgentFormValues = z.infer<typeof agentFormSchema>;

interface AgentDesignerProps {
  agent?: Agent | null;
  onSaved?: () => void;
}

export default function AgentDesigner({ agent, onSaved }: AgentDesignerProps) {
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
  const { toast } = useToast();
  const { autoLoadKnowledge } = useSettings();

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: agent?.name || '',
      description: agent?.description || '',
      fallbackResponse: agent?.fallbackResponse || 'Sorry, I am currently unable to assist with that.',
    },
  });

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
      setRules([]);
    }
  }, [agent, form]);

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

  const addRule = () => {
    const newRule: AgentRule = {
      id: `rule_${Date.now()}`,
      trigger: { type: 'keywords', value: '' },
      responses: [],
      knowledgeFileIds: autoLoadKnowledge ? knowledgeFiles.map((f) => f.id) : [],
    };
    setRules([...rules, newRule]);
  };

  const deleteRule = (ruleId: string) => {
    setRules(rules.filter((rule) => rule.id !== ruleId));
  };

  const updateRuleTrigger = (ruleId: string, value: string) => {
    setRules(
      rules.map((rule) =>
        rule.id === ruleId ? { ...rule, trigger: { ...rule.trigger, value } } : rule
      )
    );
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
  };

  const removeResponseFromRule = (ruleId: string, responseIndex: number) => {
    setRules(
      rules.map((rule) =>
        rule.id === ruleId
          ? { ...rule, responses: rule.responses.filter((_, i) => i !== responseIndex) }
          : rule
      )
    );
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
  };

  const toggleAIKnowledgeFile = (fileId: string, checked: boolean) => {
    setAISettings((prev) => {
      const current = prev.knowledgeFileIds || [];
      const updated = checked
        ? [...current, fileId]
        : current.filter((id) => id !== fileId);
      return { ...prev, knowledgeFileIds: updated };
    });
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

      if (!agent) {
        form.reset();
        setRules([]);
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
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Core Agent Info */}
        <Card>
          <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2 text-2xl">
              <FilePen className="h-6 w-6 text-primary" />
              {agent ? `Edit Agent: ${agent.name}` : 'Create New Agent'}
            </CardTitle>
            <CardDescription>
              Configure identity, operating mode, and automated response capabilities.
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

        {/* Mode Selector Tabs */}
        <Tabs
          value={mode}
          onValueChange={(val: string) => setMode(val as AgentMode)}
          className="space-y-8"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="ai" className="font-semibold">
              <Sparkles className="mr-2 h-4 w-4 text-primary" /> AI Mode (Groq / Gemini)
            </TabsTrigger>
            <TabsTrigger value="rule" className="font-semibold">
              <Bot className="mr-2 h-4 w-4" /> Keyword Rule Mode
            </TabsTrigger>
          </TabsList>

          {/* AI SETTINGS TAB */}
          <TabsContent value="ai" className="space-y-8">
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
                      onValueChange={(val: string) => {
                        const newProvider = val as AIProvider;
                        setAISettings((s) => ({ ...s, provider: newProvider }));
                      }}
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
                    <FormLabel>API Key (Optional override, defaults to .env)</FormLabel>
                    <Input
                      type="password"
                      placeholder="Leave blank to use environment variable"
                      value={aiSettings.apiKey || ''}
                      onChange={(e) => {
                        setAISettings((s) => ({ ...s, apiKey: e.target.value }));
                      }}
                    />
                  </FormItem>
                </div>

                {/* System Prompt */}
                <FormItem className="space-y-2">
                  <FormLabel>System Instructions</FormLabel>
                  <Textarea
                    maxLength={SYSTEM_PROMPT_LIMIT}
                    rows={4}
                    value={aiSettings.systemPrompt || ''}
                    onChange={(e) => {
                      setAISettings((s) => ({ ...s, systemPrompt: e.target.value }));
                    }}
                    placeholder="You are a helpful customer service representative. Reply concisely, clearly, and politely in English or Nepali..."
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {(aiSettings.systemPrompt || '').length}/{SYSTEM_PROMPT_LIMIT}
                  </p>
                </FormItem>

                {/* Sliders / Params */}
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <FormItem>
                    <FormLabel>Max Response Length (Tokens)</FormLabel>
                    <Input
                      type="number"
                      min={50}
                      max={2000}
                      value={aiSettings.maxLen || 500}
                      onChange={(e) => {
                        setAISettings((s) => ({ ...s, maxLen: Number(e.target.value) }));
                      }}
                    />
                  </FormItem>

                  <FormItem>
                    <FormLabel>Creativity / Temperature (0.0 to 1.0)</FormLabel>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={aiSettings.temperature !== undefined ? aiSettings.temperature : 0.7}
                      onChange={(e) => {
                        setAISettings((s) => ({ ...s, temperature: Number(e.target.value) }));
                      }}
                    />
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
                      onCheckedChange={(checked) => {
                        setAISettings((s) => ({ ...s, enableVoiceResponse: checked }));
                      }}
                    />
                  </div>

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
                      onCheckedChange={(checked) => {
                        setAISettings((s) => ({ ...s, enableVision: checked }));
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* RULE SETTINGS TAB */}
          <TabsContent value="rule" className="space-y-8">
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
                            <FormLabel>Trigger Keywords (comma-separated)</FormLabel>
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
  );
}
