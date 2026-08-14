'use client';

import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  UserCheck,
  Building2,
  Mail,
  Phone,
  Tag,
  Star,
  Plus,
  X,
  Loader2,
  Calendar,
  MessageSquare,
  FileText,
  Save,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { ContactProfile, LeadStage } from '@/types';
import { format } from 'date-fns';

interface ContactProfileDrawerProps {
  chatId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onProfileUpdated?: (profile: ContactProfile) => void;
}

const STAGE_CONFIG: Record<LeadStage, { label: string; color: string; badgeClass: string }> = {
  lead: {
    label: 'Lead',
    color: '#3B82F6',
    badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  },
  prospect: {
    label: 'Prospect',
    color: '#8B5CF6',
    badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  },
  customer: {
    label: 'Customer',
    color: '#10B981',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  vip: {
    label: 'VIP Customer',
    color: '#F59E0B',
    badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-semibold',
  },
  churned: {
    label: 'Churn Risk / Inactive',
    color: '#EF4444',
    badgeClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  },
};

const SUGGESTED_TAGS = [
  'VIP',
  'High Priority',
  'Enterprise',
  'Pricing Dispute',
  'Spanish Speaking',
  'Beta Tester',
  'Trial User',
  'Renewal Due',
];

export default function ContactProfileDrawer({
  chatId,
  isOpen,
  onClose,
  onProfileUpdated,
}: ContactProfileDrawerProps) {
  const [profile, setProfile] = useState<ContactProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    stage: 'lead' as LeadStage,
    notes: '',
    tags: [] as string[],
  });

  const fetchProfile = async (targetChatId: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(targetChatId)}`);
      if (!res.ok) throw new Error('Failed to load contact profile');
      const data: ContactProfile = await res.json();
      setProfile(data);
      setFormData({
        name: data.name || '',
        email: data.email || '',
        company: data.company || '',
        stage: data.stage || 'lead',
        notes: data.notes || '',
        tags: data.tags || [],
      });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (chatId && isOpen) {
      fetchProfile(chatId);
    }
  }, [chatId, isOpen]);

  const handleSave = async () => {
    if (!chatId) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(chatId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          email: formData.email.trim() || undefined,
          company: formData.company.trim() || undefined,
          stage: formData.stage,
          notes: formData.notes.trim(),
          tags: formData.tags,
        }),
      });

      if (!res.ok) throw new Error('Failed to update contact');
      const updatedProfile: ContactProfile = await res.json();
      setProfile(updatedProfile);
      if (onProfileUpdated) onProfileUpdated(updatedProfile);

      toast({
        title: 'Profile Updated',
        description: `CRM details for ${formData.name || chatId} saved.`,
      });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save Failed', description: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddTag = (tagToAdd: string) => {
    const clean = tagToAdd.trim();
    if (!clean) return;
    if (formData.tags.some(t => t.toLowerCase() === clean.toLowerCase())) {
      setNewTagInput('');
      return;
    }
    setFormData(p => ({ ...p, tags: [...p.tags, clean] }));
    setNewTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(p => ({
      ...p,
      tags: p.tags.filter(t => t.toLowerCase() !== tagToRemove.toLowerCase()),
    }));
  };

  if (!chatId) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col overflow-hidden bg-card">
        <SheetHeader className="p-4 border-b bg-muted/20 shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="font-headline text-lg flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-primary" />
              <span>Contact CRM Profile</span>
            </SheetTitle>
          </div>
          <SheetDescription className="text-xs">
            Manage customer lifecycle stage, tags, contact info, and internal account notes.
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* Header Avatar & Identity Summary */}
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-muted/20">
              <Avatar className="h-12 w-12 border">
                <AvatarImage src={profile?.avatarUrl} alt={formData.name} />
                <AvatarFallback>{(formData.name || chatId).charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <h4 className="font-semibold text-sm truncate">{formData.name || chatId}</h4>
                <p className="text-xs text-muted-foreground truncate">{chatId}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full border', STAGE_CONFIG[formData.stage]?.badgeClass)}>
                    {formData.stage === 'vip' && <Star className="h-2.5 w-2.5 inline mr-1 fill-amber-500" />}
                    {STAGE_CONFIG[formData.stage]?.label || formData.stage}
                  </span>
                </div>
              </div>
            </div>

            {/* Lifecycle Stage Selection */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Customer Lifecycle Stage</Label>
              <Select
                value={formData.stage}
                onValueChange={(val: LeadStage) => setFormData(p => ({ ...p, stage: val }))}
              >
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="Select Stage" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STAGE_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                        <span>{cfg.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Custom Tags Section */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Tags & Classifications</span>
              </Label>

              {/* Active Tags */}
              <div className="flex flex-wrap gap-1.5 min-h-6 p-2 rounded-lg border bg-background">
                {formData.tags.length === 0 ? (
                  <span className="text-xs text-muted-foreground italic">No tags assigned yet.</span>
                ) : (
                  formData.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-xs font-normal gap-1 pl-2 pr-1 py-0.5 bg-muted text-foreground border"
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:text-destructive text-muted-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))
                )}
              </div>

              {/* Add Custom Tag */}
              <div className="flex items-center gap-1.5">
                <Input
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag(newTagInput);
                    }
                  }}
                  placeholder="Type a tag and press Enter..."
                  className="h-8 text-xs bg-background"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleAddTag(newTagInput)}
                  disabled={!newTagInput.trim()}
                  className="h-8 text-xs shrink-0 gap-1"
                >
                  <Plus className="h-3 w-3" />
                  <span>Add</span>
                </Button>
              </div>

              {/* Suggested Quick Tags */}
              <div className="flex flex-wrap gap-1 pt-1">
                {SUGGESTED_TAGS.filter(t => !formData.tags.includes(t)).slice(0, 5).map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleAddTag(tag)}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-border/60 bg-muted/40 hover:bg-muted text-muted-foreground transition-colors"
                  >
                    + {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Contact Details */}
            <div className="space-y-3 pt-1 border-t">
              <div className="space-y-1.5">
                <Label htmlFor="crm-name" className="text-xs">Full Name</Label>
                <Input
                  id="crm-name"
                  value={formData.name}
                  onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. John Doe"
                  className="h-8 text-xs bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="crm-email" className="text-xs flex items-center gap-1">
                  <Mail className="h-3 w-3 text-muted-foreground" />
                  <span>Email Address</span>
                </Label>
                <Input
                  id="crm-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(p => ({ ...p, email: e.target.value }))}
                  placeholder="e.g. john@example.com"
                  className="h-8 text-xs bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="crm-company" className="text-xs flex items-center gap-1">
                  <Building2 className="h-3 w-3 text-muted-foreground" />
                  <span>Company / Organization</span>
                </Label>
                <Input
                  id="crm-company"
                  value={formData.company}
                  onChange={(e) => setFormData(p => ({ ...p, company: e.target.value }))}
                  placeholder="e.g. Acme Corp"
                  className="h-8 text-xs bg-background"
                />
              </div>
            </div>

            {/* Account Activity Summary */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t text-xs text-muted-foreground">
              <div className="p-2.5 rounded-lg border bg-muted/20 space-y-1">
                <div className="flex items-center gap-1 text-[11px]">
                  <MessageSquare className="h-3 w-3 text-primary" />
                  <span>Total Messages</span>
                </div>
                <p className="font-bold text-sm text-foreground">{profile?.messageCount || 0}</p>
              </div>

              <div className="p-2.5 rounded-lg border bg-muted/20 space-y-1">
                <div className="flex items-center gap-1 text-[11px]">
                  <Calendar className="h-3 w-3 text-primary" />
                  <span>First Seen</span>
                </div>
                <p className="font-semibold text-xs text-foreground truncate">
                  {profile?.createdAt ? format(new Date(profile.createdAt), 'MMM d, yyyy') : 'Recently'}
                </p>
              </div>
            </div>

            {/* Persistent CRM Account Notes */}
            <div className="space-y-1.5 pt-1 border-t">
              <Label htmlFor="crm-notes" className="text-xs flex items-center gap-1 font-semibold">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Account Notes & Background</span>
              </Label>
              <Textarea
                id="crm-notes"
                value={formData.notes}
                onChange={(e) => setFormData(p => ({ ...p, notes: e.target.value }))}
                placeholder="Important account background, special requirements, pricing agreement, or preferences..."
                rows={4}
                className="text-xs bg-background leading-relaxed"
              />
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="p-3 border-t bg-muted/20 shrink-0 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving} className="text-xs">
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving || isLoading} className="text-xs gap-1.5">
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            <span>Save Profile</span>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
