
'use client';

import type { Agent, AgentMode, AIProvider } from '@/types';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
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
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { getAiSuggestions } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import type { AgentRule, KnowledgeFile } from '@/types';
import { cn } from '@/lib/utils';
import { useSettings } from '@/hooks/use-settings';

const SYSTEM_PROMPT_LIMIT = 1000;

const agentFormSchema = z.object({
  name: z.string().min(3, 'Agent name must be at least 3 characters.'),
  description: z
    .string()
    .optional(),
  fallbackResponse: z.string().optional(),
});

type AgentFormValues = z.infer<typeof agentFormSchema>;

interface AgentDesignerProps {
  agent?: Agent | null;
  onSaved?: () => void;
}

export default function AgentDesigner({ agent, onSaved }: AgentDesignerProps) {
  const [mode, setMode] = useState<AgentMode>(agent?.mode ?? 'rule');
  // Initialize AI settings with proper defaults
  const [aiSettings, setAISettings] = useState({
    provider: (agent?.aiSettings?.provider ?? 'openai') as AIProvider,
    apiKey: agent?.aiSettings?.apiKey ?? '',
    systemPrompt: agent?.aiSettings?.systemPrompt ?? 'You are a helpful assistant.',
    maxLen: agent?.aiSettings?.maxLen ?? 500,
    temperature: agent?.aiSettings?.temperature ?? 0.2,
    knowledgeFileIds: Array.isArray(agent?.aiSettings?.knowledgeFileIds) ? [...agent.aiSettings.knowledgeFileIds] : [],
    enableVoiceResponse: agent?.aiSettings?.enableVoiceResponse ?? false,
    enableVision: agent?.aiSettings?.enableVision ?? true,
    voiceProvider: (agent?.aiSettings?.voiceProvider ?? 'google') as 'google' | 'openai' | 'elevenlabs',
  });
  
  // Log initial AI settings
  useEffect(() => {
    if (mode === 'ai') {
      console.log('Initial AI settings:', aiSettings);
    }
  }, [mode]);

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
      fallbackResponse: agent?.fallbackResponse || 'Sorry, I did not understand. Can you rephrase?',
    },
  });

  useEffect(() => {
    const fetchKnowledgeFiles = async () => {
        try {
            const res = await fetch('/api/knowledge');
            if(!res.ok) throw new Error('Could not fetch knowledge files');
            const data = await res.json();
            setKnowledgeFiles(data);
        } catch(e) {
            toast({variant: 'destructive', title: 'Error', description: (e as Error).message});
        }
    }
    fetchKnowledgeFiles();
  }, [toast])

  const addRule = () => {
    const newRule: AgentRule = {
      id: `rule_${Date.now()}`,
      trigger: { type: 'keywords', value: '' },
      responses: [],
      knowledgeFileIds: autoLoadKnowledge ? knowledgeFiles.map(f => f.id) : [],
    };
    setRules([...rules, newRule]);
  };

  const deleteRule = (ruleId: string) => {
    setRules(rules.filter((rule) => rule.id !== ruleId));
  };

  const updateRuleValue = <K extends keyof AgentRule,>(ruleId: string, key: K, value: AgentRule[K]) => {
      setRules(rules.map(rule => rule.id === ruleId ? {...rule, [key]: value} : rule));
  }

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
    setNewResponses(prev => ({...prev, [ruleId]: ''}));
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
        setRules(rules.map(rule => {
            if (rule.id === ruleId) {
                const currentFiles = rule.knowledgeFileIds || [];
                const newFiles = checked 
                    ? [...currentFiles, fileId]
                    : currentFiles.filter(id => id !== fileId);
                return { ...rule, knowledgeFileIds: newFiles };
            }
            return rule;
        }));
    };

  const handleGetSuggestions = async (ruleId: string, keywords: string, knowledgeFileIds?: string[]) => {
    if (!keywords) {
      toast({ variant: 'destructive', title: 'Keywords required for AI suggestions.' });
      return;
    }
    setIsSuggesting(prev => ({...prev, [ruleId]: true}));
    setSuggestedResponses(prev => ({...prev, [ruleId]: []}));

    try {
      const result = await getAiSuggestions({ keywords, knowledgeFileIds });
      if (result.error) {
        toast({ variant: 'destructive', title: 'AI Suggestion Failed', description: result.error });
      } else {
        setSuggestedResponses(prev => ({...prev, [ruleId]: result.suggestions || []}));
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'An unexpected error occurred.' });
    } finally {
      setIsSuggesting(prev => ({...prev, [ruleId]: false}));
    }
  };

  const addSuggestedResponse = (ruleId: string, suggestion: string) => {
    addResponseToRule(ruleId, suggestion);
    setSuggestedResponses(prev => ({...prev, [ruleId]: prev[ruleId].filter(s => s !== suggestion)}));
  }

  const onSubmit = async (data: AgentFormValues) => {
    const effectiveMode: AgentMode = mode;
    
    // Validation
    if (effectiveMode === 'rule' && rules.length === 0) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Please add at least one automation rule.' });
      return;
    }
    
    // Debug logging
    console.log('Submitting agent data:', { mode: effectiveMode, data });
    
    setIsSaving(true);
    
    // Create a deep copy of aiSettings to avoid reference issues
    const aiSettingsCopy = effectiveMode === 'ai' ? {
      provider: aiSettings.provider,
      apiKey: aiSettings.apiKey || '',
      systemPrompt: aiSettings.systemPrompt || '',
      maxLen: aiSettings.maxLen || 500,
      temperature: aiSettings.temperature || 0.7,
      knowledgeFileIds: [...(aiSettings.knowledgeFileIds || [])]
    } : undefined;
    
    const agentData = {
      ...data,
      mode: effectiveMode, // Explicitly include mode
      rules: effectiveMode === 'rule' ? rules : [],
      aiSettings: aiSettingsCopy,
    };
    
    console.log('Form data:', data);
    console.log('Mode:', effectiveMode);
    console.log('AI Settings copy:', aiSettingsCopy);
    console.log('Final agent data:', agentData);

    try {
        const endpoint = agent ? `/api/agents/${agent.id}` : '/api/agents';
        const method = agent ? 'PATCH' : 'POST';
        console.log('Sending request to:', endpoint, 'with method:', method);
        console.log('Request payload:', JSON.stringify(agentData, null, 2));
        
        const response = await fetch(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(agentData),
        });

        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Error response:', errorData);
            throw new Error(errorData.message || 'Failed to save agent');
        }

        const savedAgent = await response.json();
        console.log('Agent saved successfully:', savedAgent);
        
        toast({ title: 'Agent Saved!', description: `Agent "${data.name}" has been ${agent ? 'updated' : 'configured'}.` });
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
      <Tabs
      value={mode}
      onValueChange={(val: string) => setMode(val as AgentMode)}
      className="space-y-8"
    >
      <TabsList className="mb-4">
        <TabsTrigger value="rule">Rule Mode</TabsTrigger>
        <TabsTrigger value="ai">AI (beta)</TabsTrigger>
      </TabsList>

      

      <TabsContent value="rule">
    
      
        <Card>
          <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2 text-2xl">
              <FilePen className="h-6 w-6 text-primary" /> Configure Agent
            </CardTitle>
            <CardDescription>
              Define the agent's identity, behavior, and automation rules.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Agent Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Customer Support Bot" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Agent Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Describe the agent's purpose, e.g., 'Handles initial customer support queries about pricing and features.'" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2 text-2xl"><Bot className="h-6 w-6 text-primary"/> Automation Rules</CardTitle>
                <CardDescription>Define triggers and the responses the agent will send. Add multiple rules for different scenarios.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Accordion type="multiple" className="w-full" defaultValue={rules.map(r => r.id)}>
                    {rules.map((rule, ruleIndex) => (
                        <AccordionItem value={rule.id} key={rule.id} className="rounded-lg border bg-background">
                            <div className="flex w-full items-center pr-2">
                                <AccordionTrigger className="w-full px-4 text-left hover:no-underline">
                                    <div className="flex-1 text-left">
                                        <p className="font-semibold text-primary">Rule #{ruleIndex + 1}</p>
                                        <p className="text-sm text-muted-foreground">{rule.trigger.value || "New Rule: Add keywords to activate"}</p>
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
                                    <FormLabel>Trigger Keywords</FormLabel>
                                    <FormControl>
                                      <Input placeholder="price, help, contact (comma-separated)" value={rule.trigger.value} onChange={(e) => updateRuleTrigger(rule.id, e.target.value)} />
                                    </FormControl>
                                  </FormItem>

                                    <div className="space-y-2">
                                        <FormLabel className="flex items-center gap-2"><BookCopy className="h-4 w-4"/> Knowledge Base Context</FormLabel>
                                        <p className="text-sm text-muted-foreground">Select documents to provide extra context for this rule's AI suggestions.</p>
                                        {knowledgeFiles.length > 0 ? (
                                        <ScrollArea className="h-32 rounded-md border p-2">
                                            <div className="space-y-2">
                                            {knowledgeFiles.map(file => (
                                                <div key={file.id} className="flex items-center space-x-2">
                                                    <Checkbox 
                                                        id={`file-${rule.id}-${file.id}`}
                                                        checked={rule.knowledgeFileIds?.includes(file.id)}
                                                        onCheckedChange={(checked) => updateRuleKnowledgeFiles(rule.id, file.id, !!checked)}
                                                    />
                                                    <label htmlFor={`file-${rule.id}-${file.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                                        {file.fileName}
                                                    </label>
                                                </div>
                                            ))}
                                            </div>
                                        </ScrollArea>
                                        ) : (
                                            <p className="py-4 text-center text-sm text-muted-foreground">No knowledge files uploaded yet.</p>
                                        )}
                                    </div>


                                  <div className="space-y-2">
                                    <FormLabel>Configured Responses ({rule.responses.length})</FormLabel>
                                    {rule.responses.map((res, index) => (
                                      <div key={index} className="flex items-center gap-2">
                                        <p className="flex-1 rounded-md border bg-secondary p-3 text-sm text-secondary-foreground">{res}</p>
                                        <Button type="button" variant="ghost" size="icon" onClick={() => removeResponseFromRule(rule.id, index)}>
                                          <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                      </div>
                                    ))}
                                    {rule.responses.length === 0 && <p className="text-sm text-muted-foreground">No responses configured for this rule yet.</p>}
                                  </div>

                                  <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                                      <FormLabel className="text-base">Add New Response</FormLabel>
                                      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start">
                                          <Textarea placeholder="Type a custom response..." value={newResponses[rule.id] || ''} onChange={(e) => setNewResponses(prev => ({...prev, [rule.id]: e.target.value}))}/>
                                          <Button type="button" variant="outline" className="shrink-0" onClick={() => addResponseToRule(rule.id, newResponses[rule.id] || '')}>Add</Button>
                                      </div>
                                      <div className="flex items-center gap-4">
                                          <div className="h-px flex-1 bg-border" /> <span className="text-xs text-muted-foreground">OR</span> <div className="h-px flex-1 bg-border" />
                                      </div>
                                      <Button type="button" variant="outline" className="w-full" onClick={() => handleGetSuggestions(rule.id, rule.trigger.value, rule.knowledgeFileIds)} disabled={isSuggesting[rule.id]}>
                                          {isSuggesting[rule.id] ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4 text-accent" />}
                                          Suggest with AI
                                      </Button>
                                      {suggestedResponses[rule.id] && suggestedResponses[rule.id].length > 0 && (
                                          <div className="space-y-2 pt-2">
                                              {suggestedResponses[rule.id].map((suggestion, i) => (
                                                  <div key={i} onClick={() => addSuggestedResponse(rule.id, suggestion)} className="flex cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-muted">
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

        <Card>
          <CardHeader>
            <CardTitle className="font-headline text-2xl">Fallback</CardTitle>
            <CardDescription>
              If no rules are triggered, the agent will send this response.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField control={form.control} name="fallbackResponse" render={({ field }) => (
                <FormItem>
                  <FormLabel>Fallback Response</FormLabel>
                  <FormControl>
                    <Textarea placeholder="e.g., Sorry, I'm not sure how to help with that. I'm connecting you to a human agent." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Agent
            </Button>
        </div>
      </TabsContent>

      {/* AI SETTINGS TAB */}
      <TabsContent value="ai" className="space-y-8" onSelect={() => setMode('ai')}>
        <Card>
          <CardHeader>
            <CardTitle className="font-headline text-2xl">Agent Information</CardTitle>
            <CardDescription>Basic information about your AI agent.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Agent Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., AI Assistant" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Agent Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Describe the agent's purpose, e.g., 'An AI assistant that helps with customer inquiries.'" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="font-headline text-2xl">AI Settings</CardTitle>
            <CardDescription>Configure how the AI should respond.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Provider */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormItem className="flex flex-col space-y-2">
                <FormLabel>Provider</FormLabel>
                <Select
                  value={aiSettings.provider}
                  onValueChange={(val: string) => {
                    const newProvider = val as AIProvider;
                    setAISettings((s) => ({ ...s, provider: newProvider }));
                    console.log('Provider changed to:', newProvider);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="groq">Groq (Llama 3.3 70B - Ultra Fast ⚡)</SelectItem>
                    <SelectItem value="gemini">Google Gemini</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>

              {/* API Key */}
              <FormItem className="flex flex-col space-y-2">
                <FormLabel>API Key (optional)</FormLabel>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={aiSettings.apiKey || ''}
                  onChange={(e) => {
                    const newApiKey = e.target.value;
                    setAISettings((s) => ({ ...s, apiKey: newApiKey }));
                    console.log('API Key updated');
                  }}
                />
              </FormItem>
            </div>

            {/* System Prompt */}
            <FormItem className="space-y-2">
              <FormLabel>System Prompt</FormLabel>
              <Textarea
                maxLength={SYSTEM_PROMPT_LIMIT}
                value={aiSettings.systemPrompt || ''}
                onChange={(e) => {
                  const newPrompt = e.target.value;
                  setAISettings((s) => ({ ...s, systemPrompt: newPrompt }));
                  console.log('System prompt updated, length:', newPrompt.length);
                }}
                placeholder="You are a helpful assistant..."
              />
              <p className="text-xs text-muted-foreground text-right">
                {(aiSettings.systemPrompt || '').length}/{SYSTEM_PROMPT_LIMIT}
              </p>
            </FormItem>

            {/* Sliders */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <FormItem>
                <FormLabel>Max Response Length</FormLabel>
                <Input
                  type="number"
                  min={50}
                  max={2000}
                  value={aiSettings.maxLen || 500}
                  onChange={(e) => {
                    const newMaxLen = Number(e.target.value);
                    setAISettings((s) => ({ ...s, maxLen: newMaxLen }));
                    console.log('Max length updated:', newMaxLen);
                  }}
                />
              </FormItem>

              <FormItem>
                <FormLabel>Creativity (Temperature)</FormLabel>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={aiSettings.temperature || 0.7}
                  onChange={(e) => {
                    const newTemp = Number(e.target.value);
                    setAISettings((s) => ({ ...s, temperature: newTemp }));
                    console.log('Temperature updated:', newTemp);
                  }}
                />
              </FormItem>
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
                    <FormLabel className="text-sm font-medium">Voice Responses (Text-to-Speech)</FormLabel>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Automatically reply with authentic WhatsApp voice notes when receiving audio messages or user inquiries.
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
                    <FormLabel className="text-sm font-medium">Vision & Document Understanding</FormLabel>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Allow the AI to inspect and understand customer images (receipts, error screenshots) and PDF documents.
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

        {/* Fallback Reply also shown in AI mode */}
        <Card>
          <CardHeader>
            <CardTitle className="font-headline text-2xl">Fallback</CardTitle>
            <CardDescription>Sent if the AI fails to generate a response.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormField control={form.control} name="fallbackResponse" render={({ field }) => (
              <FormItem>
                <FormLabel>Fallback Response</FormLabel>
                <FormControl>
                  <Textarea placeholder="Sorry, I'm not sure how to help with that." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button 
            type="button" 
            size="lg" 
            disabled={isSaving}
            onClick={() => {
              console.log('AI tab save button clicked', { aiSettings, formValues: form.getValues() });
              // Ensure mode is set to 'ai' before submitting
              setMode('ai');
              // Directly submit the form without setTimeout
              // Wait a tick to ensure state updated
              setTimeout(() => {
                form.handleSubmit(onSubmit)();
              }, 0);
            }}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Agent
          </Button>
        </div>
      </TabsContent>
    </Tabs>
    </form>
    </Form>
  );
}
