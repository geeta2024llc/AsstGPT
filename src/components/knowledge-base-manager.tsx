'use client';

import { useState, useEffect, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { format } from 'date-fns';
import {
  Upload,
  FileText,
  Trash2,
  Loader2,
  Eye,
  Plus,
  Edit2,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  HelpCircle,
  MessageSquare,
  Sparkles,
  Bot,
  LayoutGrid,
  List,
  Copy,
  Check,
  Send,
  Database,
  ArrowRight,
  BookOpen,
  FileQuestion,
  FileCode,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import ConfirmDeleteDialog from '@/components/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import type { KnowledgeFile } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { testKnowledgeRetrieval } from '@/lib/actions';
import { cn } from '@/lib/utils';

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

function parseFaqContent(content: string): FaqItem[] {
  if (!content || !content.trim()) {
    return [{ id: '1', question: '', answer: '' }];
  }

  const items: FaqItem[] = [];
  const regex = /(?:^|\n+)(?:Q|Question):\s*(.+?)\s*(?:\n+)(?:A|Answer):\s*([\s\S]+?)(?=(?:\n+(?:Q|Question):)|$)/gi;
  let match;
  let count = 1;

  while ((match = regex.exec(content)) !== null) {
    items.push({
      id: String(count++),
      question: match[1]?.trim() || '',
      answer: match[2]?.trim() || '',
    });
  }

  if (items.length === 0) {
    return [{ id: '1', question: '', answer: content.trim() }];
  }

  return items;
}

function formatFaqContent(faqItems: FaqItem[]): string {
  return faqItems
    .filter(item => item.question.trim() || item.answer.trim())
    .map(item => `Q: ${item.question.trim()}\nA: ${item.answer.trim()}`)
    .join('\n\n');
}

export default function KnowledgeBaseManager() {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryTab, setCategoryTab] = useState<'all' | 'faq' | 'text' | 'file'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Live Test Knowledge State
  const [testQuery, setTestQuery] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    answer?: string;
    sourcesUsed?: string[];
    chunksMatched?: number;
    matchedContentSnippet?: string;
    error?: string;
  } | null>(null);

  // Add FAQ / Text Modal State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<'faq' | 'txt'>('faq');
  const [newContent, setNewContent] = useState('');
  const [newFaqItems, setNewFaqItems] = useState<FaqItem[]>([
    { id: '1', question: '', answer: '' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Modal State
  const [editingFile, setEditingFile] = useState<KnowledgeFile | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editType, setEditType] = useState<'faq' | 'txt'>('faq');
  const [editContent, setEditContent] = useState('');
  const [editFaqItems, setEditFaqItems] = useState<FaqItem[]>([]);
  const [editModeRaw, setEditModeRaw] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const addScrollRef = useRef<HTMLDivElement>(null);
  const editScrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const fetchFiles = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/knowledge', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch knowledge files.');
      const data = await res.json();
      setFiles(data.sort((a: KnowledgeFile, b: KnowledgeFile) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: (error as Error).message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileType = file.name.split('.').pop()?.toLowerCase() || '';
    const supportedTypes = ['pdf', 'docx', 'txt'];
    if (!supportedTypes.includes(fileType)) {
      toast({ variant: 'destructive', title: 'Invalid File Type', description: 'Please upload a .pdf, .docx, or .txt file.' });
      if (event.target) event.target.value = '';
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/knowledge/parse', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMessage = `Upload failed with status: ${res.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorMessage;
        } catch {
          console.error('Could not parse error response JSON:', errorText);
        }
        throw new Error(errorMessage);
      }

      toast({ title: 'Document Uploaded & Parsed ✨', description: `File "${file.name}" is now indexed in AI Memory.` });
      await fetchFiles();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Upload Failed', description: (error as Error).message });
    } finally {
      setIsUploading(false);
      if (event.target) event.target.value = '';
    }
  };

  // Quick Open Modal Helpers
  const openAddFaqModal = () => {
    setNewTitle('');
    setNewType('faq');
    setNewFaqItems([{ id: '1', question: '', answer: '' }]);
    setNewContent('');
    setIsAddOpen(true);
  };

  const openAddTextModal = () => {
    setNewTitle('');
    setNewType('txt');
    setNewContent('');
    setNewFaqItems([{ id: '1', question: '', answer: '' }]);
    setIsAddOpen(true);
  };

  // Add FAQ Item
  const handleAddNewFaqItem = () => {
    setNewFaqItems(prev => [
      ...prev,
      { id: String(Date.now()), question: '', answer: '' }
    ]);
    setTimeout(() => {
      if (addScrollRef.current) {
        addScrollRef.current.scrollTo({
          top: addScrollRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
    }, 60);
  };

  const handleUpdateNewFaqItem = (id: string, field: 'question' | 'answer', value: string) => {
    setNewFaqItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleRemoveNewFaqItem = (id: string) => {
    setNewFaqItems(prev => prev.length > 1 ? prev.filter(item => item.id !== id) : prev);
  };

  // Add Manual Knowledge Submit
  const handleAddManualKnowledge = async () => {
    let finalContent = newContent.trim();
    if (newType === 'faq') {
      const validItems = newFaqItems.filter(i => i.question.trim() && i.answer.trim());
      if (validItems.length === 0) {
        toast({ variant: 'destructive', title: 'Empty Questions', description: 'Please fill in at least one Question and Answer.' });
        return;
      }
      finalContent = formatFaqContent(validItems);
    }

    if (!newTitle.trim()) {
      toast({ variant: 'destructive', title: 'Title Required', description: 'Please enter a title for this knowledge source.' });
      return;
    }

    if (!finalContent) {
      toast({ variant: 'destructive', title: 'Content Required', description: 'Please enter some knowledge content.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: newTitle.trim(),
          fileType: newType,
          content: finalContent,
        }),
      });

      if (!res.ok) throw new Error('Failed to create knowledge entry');

      toast({ title: 'Knowledge Saved ✨', description: `"${newTitle}" added to knowledge base.` });
      setIsAddOpen(false);
      setNewTitle('');
      setNewContent('');
      setNewFaqItems([{ id: '1', question: '', answer: '' }]);
      await fetchFiles();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: (error as Error).message });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (file: KnowledgeFile) => {
    setEditingFile(file);
    setEditTitle(file.fileName);
    const isFaq = file.fileType === 'faq' || file.content.includes('Q:') || file.content.includes('Question:');
    setEditType(isFaq ? 'faq' : 'txt');
    setEditContent(file.content);
    setEditFaqItems(parseFaqContent(file.content));
    setEditModeRaw(!isFaq);
  };

  const handleUpdateEditFaqItem = (id: string, field: 'question' | 'answer', value: string) => {
    setEditFaqItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleAddEditFaqItem = () => {
    setEditFaqItems(prev => [
      ...prev,
      { id: String(Date.now()), question: '', answer: '' }
    ]);
    setTimeout(() => {
      if (editScrollRef.current) {
        editScrollRef.current.scrollTo({
          top: editScrollRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
    }, 60);
  };

  const handleRemoveEditFaqItem = (id: string) => {
    setEditFaqItems(prev => prev.length > 1 ? prev.filter(item => item.id !== id) : prev);
  };

  const handleSaveEdit = async () => {
    if (!editingFile) return;

    let finalContent = editContent.trim();
    if (editType === 'faq' && !editModeRaw) {
      const validItems = editFaqItems.filter(i => i.question.trim() && i.answer.trim());
      finalContent = formatFaqContent(validItems);
    }

    if (!editTitle.trim()) {
      toast({ variant: 'destructive', title: 'Title Required', description: 'Please enter a title.' });
      return;
    }

    if (!finalContent) {
      toast({ variant: 'destructive', title: 'Content Required', description: 'Knowledge source cannot be saved with empty content.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/knowledge', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingFile.id,
          fileName: editTitle.trim(),
          content: finalContent,
        }),
      });
      if (!res.ok) throw new Error('Failed to update knowledge source');

      toast({ title: 'Saved Changes ✨', description: `Updated "${editTitle}".` });
      setEditingFile(null);
      await fetchFiles();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: (error as Error).message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const [fileToDelete, setFileToDelete] = useState<{ id: string; name: string } | null>(null);

  const confirmDeleteFile = async () => {
    if (!fileToDelete) return;
    try {
      const res = await fetch(`/api/knowledge?id=${fileToDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete file.');
      toast({ title: 'Source Removed', description: `"${fileToDelete.name}" was permanently removed from AI memory.` });
      await fetchFiles();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: (error as Error).message });
    } finally {
      setFileToDelete(null);
    }
  };

  const handleCopySnippet = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast({ title: 'Copied to Clipboard 📋' });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRunLiveTest = async () => {
    if (!testQuery.trim()) return;
    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await testKnowledgeRetrieval({ query: testQuery });
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ error: err.message || 'Failed to search knowledge.' });
    } finally {
      setIsTesting(false);
    }
  };

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // Filter categorization
  const faqFiles = files.filter(f => f.fileType === 'faq' || f.content.includes('Q:'));
  const textFiles = files.filter(f => f.fileType === 'txt' && !f.content.includes('Q:'));
  const docFiles = files.filter(f => f.fileType === 'pdf' || f.fileType === 'docx');

  const filteredFiles = files.filter(f => {
    const matchesSearch =
      f.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.fileType.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (categoryTab === 'faq') return f.fileType === 'faq' || f.content.includes('Q:');
    if (categoryTab === 'text') return f.fileType === 'txt' && !f.content.includes('Q:');
    if (categoryTab === 'file') return f.fileType === 'pdf' || f.fileType === 'docx';
    return true;
  });

  const getStatusBadge = (status?: string, enabled?: boolean) => {
    if (enabled === false || status === 'disabled') {
      return <Badge variant="outline" className="text-muted-foreground border-muted flex items-center gap-1"><XCircle className="w-3 h-3" /> Disabled</Badge>;
    }
    if (status === 'processing') {
      return <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 border-amber-500/20 flex items-center gap-1"><Clock className="w-3 h-3 animate-spin" /> Indexing</Badge>;
    }
    if (status === 'error') {
      return <Badge variant="destructive" className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Error</Badge>;
    }
    return <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Ready & Active</Badge>;
  };

  const getFileTypeIcon = (fileType: string) => {
    if (fileType === 'faq') return <MessageSquare className="w-4 h-4 text-emerald-400" />;
    if (fileType === 'pdf') return <FileCode className="w-4 h-4 text-rose-400" />;
    if (fileType === 'docx') return <FileText className="w-4 h-4 text-blue-400" />;
    return <FileText className="w-4 h-4 text-amber-400" />;
  };

  return (
    <div className="space-y-6">
      {/* 1. THREE PRIMARY WAYS TO ADD KNOWLEDGE */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Quick Ingestion — Choose How to Add Facts
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-3.5">
          {/* Card 1: Add FAQ */}
          <div
            onClick={openAddFaqModal}
            className="p-3 sm:p-4 rounded-xl border-2 border-dashed border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10 hover:border-emerald-500 transition-all cursor-pointer flex flex-col justify-between gap-2.5 sm:gap-3 group shadow-2xs"
          >
            <div className="flex items-start justify-between">
              <div className="p-2 sm:p-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 group-hover:scale-110 transition-transform">
                <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                Recommended
              </Badge>
            </div>
            <div>
              <h4 className="font-semibold text-xs sm:text-sm text-foreground flex items-center gap-1.5">
                Questions & Answers (FAQ) <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </h4>
              <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
                Add verified pricing, store hours, refund rules, and common questions.
              </p>
            </div>
          </div>

          {/* Card 2: Write / Paste Text */}
          <div
            onClick={openAddTextModal}
            className="p-3 sm:p-4 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary transition-all cursor-pointer flex flex-col justify-between gap-2.5 sm:gap-3 group shadow-2xs"
          >
            <div className="flex items-start justify-between">
              <div className="p-2 sm:p-2.5 rounded-lg bg-primary/20 text-primary group-hover:scale-110 transition-transform">
                <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                Freeform
              </Badge>
            </div>
            <div>
              <h4 className="font-semibold text-xs sm:text-sm text-foreground flex items-center gap-1.5">
                Write / Paste Business Info <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </h4>
              <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
                Paste company policies, product descriptions, menu items, or notes.
              </p>
            </div>
          </div>

          {/* Card 3: Upload Document */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="p-3 sm:p-4 rounded-xl border-2 border-dashed border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500 transition-all cursor-pointer flex flex-col justify-between gap-2.5 sm:gap-3 group shadow-2xs col-span-1 sm:col-span-2 md:col-span-1"
          >
            <div className="flex items-start justify-between">
              <div className="p-2 sm:p-2.5 rounded-lg bg-blue-500/20 text-blue-400 group-hover:scale-110 transition-transform">
                {isUploading ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> : <Upload className="w-4 h-4 sm:w-5 sm:h-5" />}
              </div>
              <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-300 border-blue-500/30">
                PDF / DOCX / TXT
              </Badge>
            </div>
            <div>
              <h4 className="font-semibold text-xs sm:text-sm text-foreground flex items-center gap-1.5">
                {isUploading ? 'Parsing Document...' : 'Upload Document'} <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </h4>
              <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
                Upload brochures, price catalogs, or product manuals up to 10MB.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={handleFileChange}
              disabled={isUploading}
              className="hidden"
            />
          </div>
        </div>
      </div>

      {/* 3. LIVE KNOWLEDGE SEARCH & TEST BAR */}
      <Card className="border-border/80 bg-card/40 shadow-xs">
        <CardHeader className="pb-2.5 pt-3 sm:pb-3 sm:pt-4 px-3 sm:px-6">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs sm:text-sm font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Test Knowledge Retrieval (Live Simulation)
            </CardTitle>
            <span className="text-[10px] sm:text-[11px] text-muted-foreground hidden xs:inline">Test how AI retrieves answers</span>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6">
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={testQuery}
                  onChange={(e) => setTestQuery(e.target.value)}
                  placeholder="e.g. What is your refund policy? What are your hours?"
                  className="pl-9 h-9 text-xs sm:text-sm bg-background"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleRunLiveTest();
                    }
                  }}
                />
              </div>
              <Button onClick={handleRunLiveTest} disabled={isTesting || !testQuery.trim()} size="sm" className="gap-1.5 h-9 shrink-0">
                {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                <span className="hidden sm:inline">Simulate Query</span>
                <span className="sm:hidden">Test</span>
              </Button>
            </div>

            {/* Test Result Box */}
            {testResult && (
              <div className="p-3 sm:p-4 rounded-xl border bg-slate-950/80 border-primary/30 space-y-2 text-xs">
                {testResult.error ? (
                  <div className="text-rose-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{testResult.error}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between flex-wrap gap-1 text-[11px] text-muted-foreground border-b border-border/40 pb-2">
                      <span className="flex items-center gap-1 text-primary font-medium">
                        <Sparkles className="w-3.5 h-3.5" /> Retrieved Response:
                      </span>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-muted-foreground">Sources:</span>
                        {testResult.sourcesUsed && testResult.sourcesUsed.length > 0 ? (
                          testResult.sourcesUsed.map((src: string) => (
                            <Badge key={src} variant="outline" className="text-[10px] bg-background">
                              {src}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="outline" className="text-[10px]">No specific source</Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-slate-200 leading-relaxed font-sans text-xs sm:text-sm">{testResult.answer}</p>
                  </>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 4. MAIN KNOWLEDGE BROWSER WITH TABS & VIEW SWITCHER */}
      <div className="space-y-3 sm:space-y-4">
        {/* Category Tabs and Filter Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3">
          <Tabs
            value={categoryTab}
            onValueChange={(v) => setCategoryTab(v as any)}
            className="w-full sm:w-auto"
          >
            <TabsList className="grid grid-cols-2 xs:grid-cols-4 sm:flex h-auto sm:h-9 bg-muted/60 p-1">
              <TabsTrigger value="all" className="text-xs">
                All ({files.length})
              </TabsTrigger>
              <TabsTrigger value="faq" className="text-xs flex items-center gap-1">
                <MessageSquare className="w-3 h-3" /> FAQs ({faqFiles.length})
              </TabsTrigger>
              <TabsTrigger value="text" className="text-xs flex items-center gap-1">
                <FileText className="w-3 h-3" /> Text ({textFiles.length})
              </TabsTrigger>
              <TabsTrigger value="file" className="text-xs flex items-center gap-1">
                <Upload className="w-3 h-3" /> Files ({docFiles.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            {/* Search filter */}
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Filter sources..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9 text-xs bg-background"
              />
            </div>

            {/* Grid / Table Toggle */}
            <div className="flex items-center border rounded-lg bg-muted/30 p-0.5 shrink-0">
              <Button
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-8 w-8 cursor-pointer"
                onClick={() => setViewMode('grid')}
                title="Grid View"
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-8 w-8 cursor-pointer"
                onClick={() => setViewMode('table')}
                title="Table View"
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Content View */}
        {isLoading ? (
          <div className="p-12 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span>Loading knowledge repository...</span>
          </div>
        ) : filteredFiles.length === 0 ? (
          <Card className="border-dashed p-10 text-center">
            <div className="flex flex-col items-center gap-3 max-w-sm mx-auto">
              <div className="p-3 rounded-full bg-muted text-muted-foreground">
                <BookOpen className="w-8 h-8" />
              </div>
              <h3 className="font-semibold text-base">No Knowledge Sources Found</h3>
              <p className="text-xs text-muted-foreground">
                {searchQuery
                  ? `No sources match "${searchQuery}". Try clearing your search.`
                  : 'Your AI agent has no custom knowledge yet. Add an FAQ or upload a document to get started.'}
              </p>
              {!searchQuery && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button size="sm" onClick={openAddFaqModal} className="gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> Add Q&A
                  </Button>
                  <Button size="sm" variant="outline" onClick={openAddTextModal} className="gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> Write Text
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ) : viewMode === 'grid' ? (
          /* GRID VIEW */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredFiles.map((file) => {
              const isFaq = file.fileType === 'faq' || file.content.includes('Q:');
              const faqCount = isFaq ? parseFaqContent(file.content).length : 0;
              const isCopied = copiedId === file.id;

              return (
                <Card
                  key={file.id}
                  className="flex flex-col justify-between hover:border-primary/50 transition-all shadow-sm group bg-card/80"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-2 rounded-lg bg-muted shrink-0">
                          {getFileTypeIcon(file.fileType)}
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-sm font-semibold truncate leading-tight" title={file.fileName}>
                            {file.fileName}
                          </CardTitle>
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                            <Badge variant="outline" className="text-[10px] px-1 py-0 uppercase">
                              {file.fileType}
                            </Badge>
                            <span>•</span>
                            <span>{formatBytes(file.size || file.content.length)}</span>
                          </span>
                        </div>
                      </div>
                      {getStatusBadge(file.status, file.enabled)}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3 pb-3">
                    {/* Snippet Preview */}
                    <div className="p-2.5 rounded-lg bg-muted/40 border text-xs text-muted-foreground line-clamp-3 font-mono leading-relaxed">
                      {file.content.slice(0, 180)}...
                    </div>

                    {isFaq && (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{faqCount} structured Q&A pair(s)</span>
                      </div>
                    )}
                  </CardContent>

                  <div className="p-3 border-t bg-muted/20 flex items-center justify-between gap-2 rounded-b-xl">
                    <span className="text-[11px] text-muted-foreground">
                      {format(new Date(file.createdAt), 'MMM d, yyyy')}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
                        title="Copy content"
                        onClick={() => handleCopySnippet(file.id, file.content)}
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-primary cursor-pointer"
                        title="Edit source"
                        onClick={() => handleOpenEdit(file)}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive cursor-pointer"
                        title="Delete source"
                        onClick={() => setFileToDelete({ id: file.id, name: file.fileName })}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          /* TABLE VIEW */
          <Card>
            <div className="overflow-x-auto custom-scrollbar">
              <Table className="min-w-[620px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Source Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Added On</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFiles.map((file) => (
                    <TableRow key={file.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {getFileTypeIcon(file.fileType)}
                          <span className="truncate max-w-xs">{file.fileName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {file.fileType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatBytes(file.size || file.content.length)}
                      </TableCell>
                      <TableCell>{getStatusBadge(file.status, file.enabled)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(file.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => handleOpenEdit(file)}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive cursor-pointer"
                            title="Delete source"
                            onClick={() => setFileToDelete({ id: file.id, name: file.fileName })}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>

      {/* 5. ADD MANUAL FAQ / TEXT DIALOG */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] h-[85vh] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-xl">
          <DialogHeader className="p-5 pb-3 border-b border-border/50 shrink-0 bg-background/80 backdrop-blur-sm">
            <DialogTitle className="flex items-center gap-2">
              {newType === 'faq' ? <MessageSquare className="h-5 w-5 text-primary" /> : <FileText className="h-5 w-5 text-primary" />}
              {newType === 'faq' ? 'Add Questions & Answers (FAQ)' : 'Write / Paste Business Info'}
            </DialogTitle>
          </DialogHeader>

          <div ref={addScrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4 custom-scrollbar">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Title / Topic</label>
              <Input
                placeholder={newType === 'faq' ? 'e.g. Pricing & Hours FAQ' : 'e.g. Shipping Policies & Guarantee'}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="mt-1"
              />
            </div>

            {/* Mode switch within modal */}
            <div className="flex items-center gap-2 p-1 bg-muted/60 rounded-lg w-fit">
              <Button
                type="button"
                size="sm"
                variant={newType === 'faq' ? 'secondary' : 'ghost'}
                className="h-7 text-xs"
                onClick={() => setNewType('faq')}
              >
                <MessageSquare className="w-3.5 h-3.5 mr-1" /> Q&A Form
              </Button>
              <Button
                type="button"
                size="sm"
                variant={newType === 'txt' ? 'secondary' : 'ghost'}
                className="h-7 text-xs"
                onClick={() => setNewType('txt')}
              >
                <FileText className="w-3.5 h-3.5 mr-1" /> Freeform Text
              </Button>
            </div>

            {newType === 'faq' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Questions & Answers ({newFaqItems.length})
                  </label>
                </div>

                <div className="space-y-3">
                  {newFaqItems.map((item, index) => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-lg border border-border bg-card/60 space-y-2.5 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs font-medium bg-muted/50">
                          Q&A #{index + 1}
                        </Badge>
                        {newFaqItems.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive cursor-pointer"
                            onClick={() => handleRemoveNewFaqItem(item.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>

                      <div>
                        <Input
                          placeholder="Customer Question (e.g. What are your opening hours?)"
                          value={item.question}
                          onChange={(e) => handleUpdateNewFaqItem(item.id, 'question', e.target.value)}
                          className="text-xs font-medium"
                        />
                      </div>

                      <div>
                        <Textarea
                          placeholder="Verified Answer (e.g. We are open Monday to Friday from 9:00 AM to 6:00 PM)."
                          value={item.answer}
                          onChange={(e) => handleUpdateNewFaqItem(item.id, 'answer', e.target.value)}
                          rows={2}
                          className="text-xs leading-relaxed resize-y"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs gap-1.5 border-dashed cursor-pointer"
                  onClick={handleAddNewFaqItem}
                >
                  <Plus className="h-3.5 w-3.5" /> Add Another Question
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Business Facts & Policy Content</label>
                <Textarea
                  placeholder="Write or paste your verified business facts, prices, contact numbers, and policies..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="h-56 font-mono text-xs leading-relaxed"
                />
              </div>
            )}
          </div>

          <DialogFooter className="p-4 px-6 border-t border-border/50 bg-card/50 shrink-0 flex items-center justify-end gap-2 mt-0">
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddManualKnowledge} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="w-4 h-4 mr-1" />}
              Save Source
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 6. EDIT KNOWLEDGE DIALOG */}
      <Dialog open={!!editingFile} onOpenChange={(open) => !open && setEditingFile(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] h-[85vh] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-xl">
          <DialogHeader className="p-5 pb-3 border-b border-border/50 shrink-0 bg-background/80 backdrop-blur-sm">
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="h-5 w-5 text-primary" /> Edit Knowledge Source
            </DialogTitle>
          </DialogHeader>

          <div ref={editScrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4 custom-scrollbar">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Title</label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mt-1"
              />
            </div>

            {/* Mode Toggle */}
            {editType === 'faq' && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/40 border">
                <span className="text-xs text-muted-foreground font-medium">Edit Mode</span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={!editModeRaw ? 'secondary' : 'ghost'}
                    className="h-7 text-xs"
                    onClick={() => {
                      setEditFaqItems(parseFaqContent(editContent));
                      setEditModeRaw(false);
                    }}
                  >
                    Structured Q&A
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={editModeRaw ? 'secondary' : 'ghost'}
                    className="h-7 text-xs"
                    onClick={() => {
                      setEditContent(formatFaqContent(editFaqItems));
                      setEditModeRaw(true);
                    }}
                  >
                    Raw Text
                  </Button>
                </div>
              </div>
            )}

            {editType === 'faq' && !editModeRaw ? (
              <div className="space-y-3">
                {editFaqItems.map((item, index) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-lg border border-border bg-card/60 space-y-2.5 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-xs font-medium bg-muted/50">
                        Q&A #{index + 1}
                      </Badge>
                      {editFaqItems.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive cursor-pointer"
                          onClick={() => handleRemoveEditFaqItem(item.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    <Input
                      value={item.question}
                      onChange={(e) => handleUpdateEditFaqItem(item.id, 'question', e.target.value)}
                      placeholder="Question"
                      className="text-xs font-medium"
                    />

                    <Textarea
                      value={item.answer}
                      onChange={(e) => handleUpdateEditFaqItem(item.id, 'answer', e.target.value)}
                      placeholder="Answer"
                      rows={2}
                      className="text-xs leading-relaxed resize-y"
                    />
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs gap-1.5 border-dashed cursor-pointer"
                  onClick={handleAddEditFaqItem}
                >
                  <Plus className="h-3.5 w-3.5" /> Add Another Question
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Content</label>
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={12}
                  className="font-mono text-xs leading-relaxed"
                />
              </div>
            )}
          </div>

          <DialogFooter className="p-4 px-6 border-t border-border/50 bg-card/50 shrink-0 flex items-center justify-end gap-2 mt-0">
            <Button variant="outline" onClick={() => setEditingFile(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="w-4 h-4 mr-1" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Knowledge Base Source Dialog */}
      <ConfirmDeleteDialog
        isOpen={!!fileToDelete}
        onOpenChange={(open) => !open && setFileToDelete(null)}
        title="Delete Knowledge Source?"
        itemName={fileToDelete?.name}
        itemType="knowledge base source"
        description={
          fileToDelete ? (
            <>
              Are you sure you want to delete the source{' '}
              <span className="font-semibold text-foreground">"{fileToDelete.name}"</span>? The AI will no longer
              reference or search this content when answering customer inquiries.
            </>
          ) : undefined
        }
        confirmLabel="Yes, Delete"
        cancelLabel="No, Cancel"
        onConfirm={confirmDeleteFile}
      />
    </div>
  );
}
