'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ShieldAlert,
  Plus,
  Trash2,
  Edit2,
  Sparkles,
  UserCheck,
  Zap,
  Sliders,
  AlertTriangle,
  Play,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Loader2,
  ArrowUpDown,
  Info,
} from 'lucide-react';
import ConfirmDeleteDialog from '@/components/confirm-delete-dialog';
import { useToast } from '@/hooks/use-toast';
import type { HandoffRule, HandoffRuleType, TeamMember } from '@/types';

const INTENT_OPTIONS = [
  { id: 'human_agent_request', label: 'Human Agent Request', desc: 'Customer asking for a live person/agent' },
  { id: 'complaint_frustration', label: 'Angry / Complaint', desc: 'Frustrated language, complaints, dissatisfaction' },
  { id: 'billing_refund', label: 'Billing & Refund', desc: 'Disputes, refund requests, chargeback inquiries' },
  { id: 'cancellation', label: 'Account Cancellation', desc: 'Customer wanting to cancel subscription or close account' },
  { id: 'technical_escalation', label: 'Technical Escalation', desc: 'Bugs, system errors, critical issues' },
];

export default function HandoffRulesManager() {
  const [rules, setRules] = useState<HandoffRule[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<HandoffRule | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  // Rule Form State
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    isEnabled: boolean;
    ruleType: HandoffRuleType;
    threshold: number;
    intents: string[];
    keywords: string;
    maxFallbacks: number;
    assignToUserId: string;
    autoPauseAi: boolean;
    transitionMessage: string;
    priority: number;
  }>({
    name: '',
    description: '',
    isEnabled: true,
    ruleType: 'keyword_match',
    threshold: 0.65,
    intents: ['human_agent_request'],
    keywords: 'human, agent, operator, representative, real person',
    maxFallbacks: 2,
    assignToUserId: '',
    autoPauseAi: true,
    transitionMessage: "I'm connecting you with one of our human specialists who will assist you shortly.",
    priority: 50,
  });

  // Simulator State
  const [testQuery, setTestQuery] = useState('Can I please speak with a human agent?');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);

  const fetchRulesAndTeam = async () => {
    setIsLoading(true);
    try {
      const [rulesRes, teamRes] = await Promise.all([
        fetch('/api/handoff/rules'),
        fetch('/api/team'),
      ]);

      if (rulesRes.ok) {
        const rulesData = await rulesRes.json();
        setRules(rulesData);
      }
      if (teamRes.ok) {
        const teamData = await teamRes.json();
        setTeamMembers(teamData);
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load handoff rules.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRulesAndTeam();
  }, []);

  const handleOpenCreateDialog = () => {
    setEditingRule(null);
    setFormData({
      name: '',
      description: '',
      isEnabled: true,
      ruleType: 'keyword_match',
      threshold: 0.65,
      intents: ['human_agent_request'],
      keywords: 'human, agent, operator, representative, real person',
      maxFallbacks: 2,
      assignToUserId: teamMembers[0]?.id || '',
      autoPauseAi: true,
      transitionMessage: "I'm connecting you with one of our human specialists who will assist you shortly.",
      priority: 50,
    });
    setIsDialogOpen(true);
  };

  const handleOpenEditDialog = (rule: HandoffRule) => {
    setEditingRule(rule);
    setFormData({
      name: rule.name,
      description: rule.description,
      isEnabled: rule.isEnabled,
      ruleType: rule.ruleType,
      threshold: rule.conditions.threshold ?? 0.65,
      intents: rule.conditions.intents || ['human_agent_request'],
      keywords: (rule.conditions.keywords || []).join(', '),
      maxFallbacks: rule.conditions.maxFallbacks ?? 2,
      assignToUserId: rule.actions.assignToUserId || '',
      autoPauseAi: rule.actions.autoPauseAi !== false,
      transitionMessage: rule.actions.transitionMessage || '',
      priority: rule.priority || 50,
    });
    setIsDialogOpen(true);
  };

  const handleToggleRule = async (rule: HandoffRule, newEnabled: boolean) => {
    try {
      const res = await fetch(`/api/handoff/rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: newEnabled }),
      });

      if (!res.ok) throw new Error('Failed to update rule');
      setRules(prev => prev.map(r => (r.id === rule.id ? { ...r, isEnabled: newEnabled } : r)));
      toast({
        title: newEnabled ? 'Rule Activated' : 'Rule Deactivated',
        description: `Rule "${rule.name}" is now ${newEnabled ? 'active' : 'disabled'}.`,
      });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    }
  };

  const [ruleToDelete, setRuleToDelete] = useState<{ id: string; name: string } | null>(null);

  const confirmDeleteRule = async () => {
    if (!ruleToDelete) return;
    try {
      const res = await fetch(`/api/handoff/rules/${ruleToDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete rule');
      setRules(prev => prev.filter(r => r.id !== ruleToDelete.id));
      toast({ title: 'Rule Deleted', description: `Rule "${ruleToDelete.name}" was removed.` });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Delete Failed', description: (err as Error).message });
    } finally {
      setRuleToDelete(null);
    }
  };

  const handleSaveRule = async () => {
    if (!formData.name.trim()) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Rule name is required.' });
      return;
    }

    setIsSaving(true);
    try {
      const conditions: any = {};
      if (formData.ruleType === 'confidence_threshold') {
        conditions.threshold = formData.threshold;
      } else if (formData.ruleType === 'intent_detected') {
        conditions.intents = formData.intents;
      } else if (formData.ruleType === 'keyword_match') {
        conditions.keywords = formData.keywords
          .split(',')
          .map(k => k.trim())
          .filter(Boolean);
      } else if (formData.ruleType === 'consecutive_fallback') {
        conditions.maxFallbacks = Number(formData.maxFallbacks);
      }

      const actions: any = {
        autoPauseAi: formData.autoPauseAi,
        assignToUserId: formData.assignToUserId || undefined,
        transitionMessage: formData.transitionMessage.trim() || undefined,
        notificationType: 'in_app',
      };

      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        isEnabled: formData.isEnabled,
        ruleType: formData.ruleType,
        conditions,
        actions,
        priority: Number(formData.priority) || 50,
      };

      if (editingRule) {
        const res = await fetch(`/api/handoff/rules/${editingRule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to update rule');
        toast({ title: 'Rule Updated', description: 'Handoff rule changes saved successfully.' });
      } else {
        const res = await fetch('/api/handoff/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to create rule');
        toast({ title: 'Rule Created', description: 'New handoff rule created successfully.' });
      }

      setIsDialogOpen(false);
      fetchRulesAndTeam();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save Failed', description: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunTest = async () => {
    if (!testQuery.trim()) return;
    setIsTesting(true);
    try {
      const res = await fetch('/api/handoff/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageText: testQuery }),
      });
      if (!res.ok) throw new Error('Simulator test failed');
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Test Failed', description: (err as Error).message });
    } finally {
      setIsTesting(false);
    }
  };

  const getBadgeForType = (type: HandoffRuleType) => {
    switch (type) {
      case 'keyword_match':
        return <Badge variant="secondary" className="text-xs">🔑 Keyword Trigger</Badge>;
      case 'intent_detected':
        return <Badge variant="outline" className="text-xs border-indigo-500/40 text-indigo-600 dark:text-indigo-400">🧠 Intent Detection</Badge>;
      case 'confidence_threshold':
        return <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-600 dark:text-amber-400">📊 Confidence Threshold</Badge>;
      case 'consecutive_fallback':
        return <Badge variant="outline" className="text-xs border-rose-500/40 text-rose-600 dark:text-rose-400">🔄 Consecutive Fallback</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header card with Overview & New Rule Button */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl font-headline">
                <ShieldAlert className="h-5 w-5 text-primary" />
                <span>Automated Handoff & Routing Rules</span>
              </CardTitle>
              <CardDescription className="mt-1">
                Configure automated rules to route conversations to human team members when confidence is low or specific customer intents are detected.
              </CardDescription>
            </div>
            <Button onClick={handleOpenCreateDialog} className="shrink-0 gap-1.5">
              <Plus className="h-4 w-4" />
              <span>Create Rule</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : rules.length === 0 ? (
            <div className="text-center p-8 border rounded-lg bg-muted/20 space-y-3">
              <p className="text-muted-foreground text-sm">No routing rules configured yet.</p>
              <Button onClick={handleOpenCreateDialog} size="sm">Create First Rule</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => {
                const member = teamMembers.find(m => m.id === rule.actions.assignToUserId);
                return (
                  <div
                    key={rule.id}
                    className="flex flex-col md:flex-row md:items-center justify-between p-4 rounded-xl border bg-card hover:bg-muted/30 transition-all gap-4 shadow-xs"
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{rule.name}</span>
                        {getBadgeForType(rule.ruleType)}
                        <Badge variant="outline" className="text-[10px] px-1.5 h-4">
                          Priority {rule.priority}
                        </Badge>
                      </div>

                      {rule.description && (
                        <p className="text-xs text-muted-foreground">{rule.description}</p>
                      )}

                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap pt-1">
                        {rule.ruleType === 'confidence_threshold' && (
                          <span>
                            Trigger: <strong className="text-foreground">Confidence &lt; {((rule.conditions.threshold ?? 0.65) * 100).toFixed(0)}%</strong>
                          </span>
                        )}
                        {rule.ruleType === 'intent_detected' && (
                          <span>
                            Intents: <strong className="text-foreground">{(rule.conditions.intents || []).join(', ')}</strong>
                          </span>
                        )}
                        {rule.ruleType === 'keyword_match' && (
                          <span>
                            Keywords: <strong className="text-foreground">{(rule.conditions.keywords || []).slice(0, 5).join(', ')}{(rule.conditions.keywords?.length || 0) > 5 ? '...' : ''}</strong>
                          </span>
                        )}
                        {rule.ruleType === 'consecutive_fallback' && (
                          <span>
                            Trigger: <strong className="text-foreground">{rule.conditions.maxFallbacks ?? 2} Fallbacks</strong>
                          </span>
                        )}

                        <span>&bull;</span>

                        <span>
                          Assigned: <strong className="text-foreground">{member?.fullName || 'Unassigned Pool'}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                      <div className="flex items-center gap-2 pr-2 border-r">
                        <span className="text-xs text-muted-foreground">{rule.isEnabled ? 'Active' : 'Disabled'}</span>
                        <Switch
                          checked={rule.isEnabled}
                          onCheckedChange={(checked) => handleToggleRule(rule, checked)}
                        />
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleOpenEditDialog(rule)}
                        title="Edit Rule"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive cursor-pointer"
                        onClick={() => setRuleToDelete({ id: rule.id, name: rule.name })}
                        title="Delete Rule"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Simulator Card to Test Handoff Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-headline">
            <Zap className="h-4 w-4 text-amber-500" />
            <span>Interactive Handoff Simulator</span>
          </CardTitle>
          <CardDescription>
            Test customer queries to see which automated handoff rule triggers and view real-time intent & confidence calculations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center gap-2">
            <Input
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              placeholder="Type a sample customer message (e.g. 'Can I speak to someone?')..."
              className="text-sm bg-background flex-1"
            />
            <Button onClick={handleRunTest} disabled={isTesting || !testQuery.trim()} className="shrink-0 gap-1.5">
              {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              <span>Test Rule</span>
            </Button>
          </div>

          {testResult && (
            <div className="p-4 rounded-xl border bg-muted/30 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  {testResult.shouldHandoff ? (
                    <Badge variant="default" className="bg-amber-500 hover:bg-amber-600 gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Handoff Triggered
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1">
                      <XCircle className="h-3 w-3" /> No Handoff (AI Handles)
                    </Badge>
                  )}

                  <Badge variant="outline" className="text-xs">
                    Intent: {testResult.detectedIntent}
                  </Badge>

                  <Badge variant="outline" className="text-xs">
                    Confidence: {(testResult.calculatedConfidence * 100).toFixed(0)}%
                  </Badge>
                </div>
              </div>

              {testResult.shouldHandoff ? (
                <div className="space-y-1.5 text-xs">
                  <p>
                    <strong className="text-foreground">Matched Rule:</strong> {testResult.matchedRule?.name}
                  </p>
                  <p className="text-muted-foreground">
                    <strong className="text-foreground">Reason:</strong> {testResult.reason}
                  </p>
                  {testResult.transitionMessage && (
                    <p className="p-2 rounded bg-background border text-muted-foreground italic">
                      &ldquo;{testResult.transitionMessage}&rdquo;
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  The message was evaluated as standard product inquiry and will be answered automatically by the assigned AI bot.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rule Builder Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[580px]">
          <DialogHeader>
            <DialogTitle className="font-headline text-lg">
              {editingRule ? 'Edit Handoff Rule' : 'Create Automated Handoff Rule'}
            </DialogTitle>
            <DialogDescription>
              Configure triggers and automated team routing actions for this escalation rule.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 max-h-[68vh] overflow-y-auto pr-1">
            {/* Rule Name & Description */}
            <div className="space-y-2">
              <Label htmlFor="rule-name">Rule Name *</Label>
              <Input
                id="rule-name"
                value={formData.name}
                onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Escalate Frustrated Customers"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rule-desc">Description</Label>
              <Input
                id="rule-desc"
                value={formData.description}
                onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))}
                placeholder="Brief summary of when this rule should trigger"
              />
            </div>

            {/* Rule Type Selector */}
            <div className="space-y-2">
              <Label htmlFor="rule-type">Trigger Condition Type *</Label>
              <Select
                value={formData.ruleType}
                onValueChange={(val: HandoffRuleType) => setFormData(p => ({ ...p, ruleType: val }))}
              >
                <SelectTrigger id="rule-type">
                  <SelectValue placeholder="Select trigger type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keyword_match">🔑 Escalation Keywords</SelectItem>
                  <SelectItem value="intent_detected">🧠 Customer Intent Detection</SelectItem>
                  <SelectItem value="confidence_threshold">📊 Low AI Confidence Threshold</SelectItem>
                  <SelectItem value="consecutive_fallback">🔄 Consecutive Fallbacks</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Dynamic Condition Details */}
            {formData.ruleType === 'keyword_match' && (
              <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
                <Label htmlFor="keywords">Keywords / Phrases (Comma-separated)</Label>
                <Textarea
                  id="keywords"
                  value={formData.keywords}
                  onChange={(e) => setFormData(p => ({ ...p, keywords: e.target.value }))}
                  placeholder="human, agent, operator, real person, speak to someone"
                  rows={3}
                />
                <p className="text-[11px] text-muted-foreground">
                  Case-insensitive match. Any incoming customer message containing these words will trigger handoff.
                </p>
              </div>
            )}

            {formData.ruleType === 'intent_detected' && (
              <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
                <Label>Select Target Intents</Label>
                <div className="grid grid-cols-1 gap-2 pt-1">
                  {INTENT_OPTIONS.map((opt) => {
                    const isChecked = formData.intents.includes(opt.id);
                    return (
                      <div
                        key={opt.id}
                        onClick={() => {
                          setFormData(p => ({
                            ...p,
                            intents: isChecked
                              ? p.intents.filter(i => i !== opt.id)
                              : [...p.intents, opt.id],
                          }));
                        }}
                        className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                          isChecked ? 'bg-primary/10 border-primary' : 'bg-background hover:bg-muted/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // Handled by div click
                          className="mt-0.5 rounded text-primary"
                        />
                        <div className="text-xs">
                          <p className="font-semibold text-foreground">{opt.label}</p>
                          <p className="text-muted-foreground">{opt.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {formData.ruleType === 'confidence_threshold' && (
              <div className="space-y-3 p-3 rounded-lg border bg-muted/20">
                <div className="flex items-center justify-between">
                  <Label>Escalation Threshold</Label>
                  <span className="text-xs font-bold text-primary">
                    &lt; {(formData.threshold * 100).toFixed(0)}% Confidence
                  </span>
                </div>
                <Slider
                  value={[formData.threshold * 100]}
                  min={10}
                  max={90}
                  step={5}
                  onValueChange={(vals) => setFormData(p => ({ ...p, threshold: vals[0] / 100 }))}
                />
                <p className="text-[11px] text-muted-foreground">
                  If the AI model is less than {(formData.threshold * 100).toFixed(0)}% confident in its answer (e.g. missing knowledge base facts), the bot will pause and route to a human agent.
                </p>
              </div>
            )}

            {formData.ruleType === 'consecutive_fallback' && (
              <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
                <Label htmlFor="max-fallbacks">Max Consecutive Fallback Responses</Label>
                <Input
                  id="max-fallbacks"
                  type="number"
                  min={1}
                  max={5}
                  value={formData.maxFallbacks}
                  onChange={(e) => setFormData(p => ({ ...p, maxFallbacks: Number(e.target.value) }))}
                />
                <p className="text-[11px] text-muted-foreground">
                  Escalate when the bot fails to match knowledge or intent multiple times in succession.
                </p>
              </div>
            )}

            {/* Action Settings */}
            <div className="space-y-3 pt-2 border-t">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Handoff Actions</h4>

              <div className="space-y-2">
                <Label htmlFor="assign-member">Route to Team Member</Label>
                <Select
                  value={formData.assignToUserId || 'unassigned'}
                  onValueChange={(val) => setFormData(p => ({ ...p, assignToUserId: val === 'unassigned' ? '' : val }))}
                >
                  <SelectTrigger id="assign-member">
                    <SelectValue placeholder="Select team member" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned" className="font-medium">
                      Unassigned Queue
                    </SelectItem>
                    {teamMembers.map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.fullName} ({m.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="trans-msg">Customer Transition Message</Label>
                <Textarea
                  id="trans-msg"
                  value={formData.transitionMessage}
                  onChange={(e) => setFormData(p => ({ ...p, transitionMessage: e.target.value }))}
                  placeholder="e.g. I am connecting you with one of our human specialists who will assist you shortly."
                  rows={2}
                />
                <p className="text-[11px] text-muted-foreground">
                  Optional. Sent automatically to the customer on WhatsApp when handoff is triggered.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-pause-toggle" className="text-sm">Auto-Pause Bot</Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically pause AI auto-replies for this chat until human resumes it.
                  </p>
                </div>
                <Switch
                  id="auto-pause-toggle"
                  checked={formData.autoPauseAi}
                  onCheckedChange={(checked) => setFormData(p => ({ ...p, autoPauseAi: checked }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="priority">Evaluation Priority (0-100)</Label>
                <Input
                  id="priority"
                  type="number"
                  min={0}
                  max={100}
                  value={formData.priority}
                  onChange={(e) => setFormData(p => ({ ...p, priority: Number(e.target.value) }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSaveRule} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              <span>{editingRule ? 'Save Changes' : 'Create Rule'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Rule Dialog */}
      <ConfirmDeleteDialog
        isOpen={!!ruleToDelete}
        onOpenChange={(open) => !open && setRuleToDelete(null)}
        title="Delete Handoff Rule?"
        itemName={ruleToDelete?.name}
        itemType="handoff rule"
        description={
          ruleToDelete ? (
            <>
              Are you sure you want to delete the rule{' '}
              <span className="font-semibold text-foreground">"{ruleToDelete.name}"</span>? AI escalation criteria
              defined by this rule will no longer be applied.
            </>
          ) : undefined
        }
        confirmLabel="Yes, Delete"
        cancelLabel="No, Cancel"
        onConfirm={confirmDeleteRule}
      />
    </div>
  );
}
