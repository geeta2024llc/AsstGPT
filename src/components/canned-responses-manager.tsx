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
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
  MessageSquareQuote,
  Plus,
  Trash2,
  Edit2,
  Loader2,
  Copy,
  Check,
  Search,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { CannedResponse } from '@/types';

const CATEGORIES = [
  { id: 'general', label: 'General' },
  { id: 'greeting', label: 'Greetings & Introductions' },
  { id: 'support', label: 'Support & Troubleshooting' },
  { id: 'sales', label: 'Sales & Pricing' },
  { id: 'closing', label: 'Closing & Follow-ups' },
];

export default function CannedResponsesManager() {
  const [responses, setResponses] = useState<CannedResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CannedResponse | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    title: '',
    shortcut: '',
    content: '',
    category: 'general',
  });

  const fetchResponses = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/inbox/canned-responses');
      if (!res.ok) throw new Error('Failed to fetch canned responses');
      const data = await res.json();
      setResponses(data);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load quick replies.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchResponses();
  }, []);

  const filteredResponses = responses.filter(r => {
    const matchesSearch =
      r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.shortcut.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.content.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = selectedCategory === 'all' || r.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleOpenCreate = () => {
    setEditingItem(null);
    setFormData({
      title: '',
      shortcut: '',
      content: '',
      category: 'general',
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (item: CannedResponse) => {
    setEditingItem(item);
    setFormData({
      title: item.title,
      shortcut: item.shortcut,
      content: item.content,
      category: item.category || 'general',
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.title.trim() || !formData.shortcut.trim() || !formData.content.trim()) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'All fields are required.' });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        title: formData.title.trim(),
        shortcut: formData.shortcut.replace(/^\//, '').trim().toLowerCase(),
        content: formData.content.trim(),
        category: formData.category,
      };

      if (editingItem) {
        const res = await fetch(`/api/inbox/canned-responses/${editingItem.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to update quick reply');
        toast({ title: 'Updated', description: `Quick reply "/${payload.shortcut}" saved.` });
      } else {
        const res = await fetch('/api/inbox/canned-responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to create quick reply');
        toast({ title: 'Created', description: `Quick reply "/${payload.shortcut}" created.` });
      }

      setIsDialogOpen(false);
      fetchResponses();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save Failed', description: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (item: CannedResponse) => {
    if (!confirm(`Delete quick reply "/${item.shortcut}" (${item.title})?`)) return;
    try {
      const res = await fetch(`/api/inbox/canned-responses/${item.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete quick reply');
      setResponses(prev => prev.filter(r => r.id !== item.id));
      toast({ title: 'Deleted', description: `Quick reply "/${item.shortcut}" was removed.` });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Delete Failed', description: (err as Error).message });
    }
  };

  const handleCopySnippet = (item: CannedResponse) => {
    navigator.clipboard.writeText(item.content);
    setCopiedId(item.id);
    toast({ title: 'Copied to Clipboard', description: `Snippet for "/${item.shortcut}" copied.` });
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl font-headline">
              <MessageSquareQuote className="h-5 w-5 text-primary" />
              <span>Canned Responses & Quick Replies</span>
            </CardTitle>
            <CardDescription className="mt-1">
              Create reusable message snippets that human agents can insert instantly in the Inbox by typing <code className="bg-muted px-1.5 py-0.5 rounded text-foreground font-mono text-xs">/shortcut</code>.
            </CardDescription>
          </div>
          <Button onClick={handleOpenCreate} className="shrink-0 gap-1.5">
            <Plus className="h-4 w-4" />
            <span>New Quick Reply</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters and Search Bar */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, /shortcut, or message content..."
              className="pl-9 h-9 text-sm bg-background"
            />
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-full sm:w-[180px] h-9 text-xs bg-background">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {CATEGORIES.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Responses Grid / List */}
        {isLoading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredResponses.length === 0 ? (
          <div className="p-8 text-center border rounded-xl bg-muted/20 space-y-2">
            <p className="text-sm text-muted-foreground">No quick replies found matching your search.</p>
            <Button variant="outline" size="sm" onClick={handleOpenCreate}>
              Add Quick Reply
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filteredResponses.map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between p-4 rounded-xl border bg-card hover:bg-muted/30 transition-all gap-3 shadow-xs"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-sm truncate">{item.title}</span>
                      <Badge variant="secondary" className="font-mono text-xs px-1.5 py-0">
                        /{item.shortcut}
                      </Badge>
                    </div>
                    <Badge variant="outline" className="text-[10px] capitalize shrink-0">
                      {item.category || 'general'}
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed whitespace-pre-wrap bg-muted/30 p-2.5 rounded-lg border border-border/40 font-normal">
                    {item.content}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-border/40">
                  <span className="text-[11px] text-muted-foreground">
                    Type <code className="text-primary font-mono">/{item.shortcut}</code> in Inbox
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleCopySnippet(item)}
                      title="Copy text"
                    >
                      {copiedId === item.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleOpenEdit(item)}
                      title="Edit snippet"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(item)}
                      title="Delete snippet"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Create / Edit Modal Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="font-headline text-lg">
              {editingItem ? 'Edit Quick Reply Snippet' : 'Create Quick Reply Snippet'}
            </DialogTitle>
            <DialogDescription>
              Configure shortcut and content for instant human agent responses.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="canned-title">Snippet Title *</Label>
              <Input
                id="canned-title"
                value={formData.title}
                onChange={(e) => setFormData(p => ({ ...p, title: e.target.value }))}
                placeholder="e.g. Standard Operating Hours"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="canned-shortcut">Shortcut Slug * (without slash)</Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-2 text-muted-foreground font-mono text-sm">/</span>
                  <Input
                    id="canned-shortcut"
                    value={formData.shortcut}
                    onChange={(e) => setFormData(p => ({ ...p, shortcut: e.target.value.replace(/^\//, '') }))}
                    placeholder="hours"
                    className="pl-6 font-mono text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="canned-category">Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(val) => setFormData(p => ({ ...p, category: val }))}
                >
                  <SelectTrigger id="canned-category">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="canned-content">Message Content *</Label>
              <Textarea
                id="canned-content"
                value={formData.content}
                onChange={(e) => setFormData(p => ({ ...p, content: e.target.value }))}
                placeholder="Type the full message template here..."
                rows={4}
                className="text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                This exact text will be inserted into the Inbox composer when typing <code className="font-mono text-foreground">/{formData.shortcut || 'shortcut'}</code>.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              <span>{editingItem ? 'Save Changes' : 'Create Snippet'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
