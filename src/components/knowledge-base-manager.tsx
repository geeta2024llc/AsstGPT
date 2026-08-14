'use client';

import { useState, useEffect } from 'react';
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
} from 'lucide-react';
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
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import type { KnowledgeFile } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

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

  // Add FAQ / Text Modal State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('faq');
  const [newContent, setNewContent] = useState('');
  const [newFaqItems, setNewFaqItems] = useState<FaqItem[]>([
    { id: '1', question: '', answer: '' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Modal State
  const [editingFile, setEditingFile] = useState<KnowledgeFile | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editType, setEditType] = useState('faq');
  const [editContent, setEditContent] = useState('');
  const [editFaqItems, setEditFaqItems] = useState<FaqItem[]>([]);
  const [editModeRaw, setEditModeRaw] = useState(false);

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
          console.error("Could not parse error response JSON:", errorText);
        }
        throw new Error(errorMessage);
      }

      toast({ title: 'Success', description: `File "${file.name}" uploaded and parsed into Knowledge Base.` });
      await fetchFiles();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Upload Failed', description: (error as Error).message });
    } finally {
      setIsUploading(false);
      if (event.target) event.target.value = '';
    }
  };

  // Add FAQ Item
  const handleAddNewFaqItem = () => {
    setNewFaqItems(prev => [
      ...prev,
      { id: String(Date.now()), question: '', answer: '' }
    ]);
  };

  // Update Add FAQ Item
  const handleUpdateNewFaqItem = (id: string, field: 'question' | 'answer', value: string) => {
    setNewFaqItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  // Remove Add FAQ Item
  const handleRemoveNewFaqItem = (id: string) => {
    setNewFaqItems(prev => prev.length > 1 ? prev.filter(item => item.id !== id) : prev);
  };

  // Add Manual Knowledge Submit
  const handleAddManualKnowledge = async () => {
    let finalContent = newContent.trim();
    if (newType === 'faq') {
      finalContent = formatFaqContent(newFaqItems);
    }

    if (!newTitle.trim() || !finalContent.trim()) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: newType === 'faq'
          ? 'Title and at least one FAQ Question & Answer are required.'
          : 'Title and content are required.',
      });
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
          enabled: true,
        }),
      });

      if (!res.ok) throw new Error('Failed to create knowledge source.');
      toast({ title: 'Knowledge Source Added', description: `"${newTitle}" is ready for RAG retrieval.` });
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

  const handleToggleEnabled = async (file: KnowledgeFile) => {
    const targetState = !file.enabled;
    try {
      const res = await fetch('/api/knowledge', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: file.id, enabled: targetState, status: targetState ? 'ready' : 'disabled' }),
      });
      if (!res.ok) throw new Error('Failed to update status');

      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, enabled: targetState, status: targetState ? 'ready' : 'disabled' } : f));
      toast({
        title: targetState ? 'Knowledge Enabled' : 'Knowledge Disabled',
        description: targetState ? `"${file.fileName}" is active for AI answers.` : `"${file.fileName}" will be ignored by RAG.`,
      });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: (error as Error).message });
    }
  };

  // Edit Handlers
  const handleOpenEdit = (file: KnowledgeFile) => {
    setEditingFile(file);
    setEditTitle(file.fileName);
    setEditType(file.fileType);
    setEditContent(file.content);
    setEditModeRaw(false);
    if (file.fileType === 'faq') {
      setEditFaqItems(parseFaqContent(file.content));
    }
  };

  const handleAddEditFaqItem = () => {
    setEditFaqItems(prev => [
      ...prev,
      { id: String(Date.now()), question: '', answer: '' }
    ]);
  };

  const handleUpdateEditFaqItem = (id: string, field: 'question' | 'answer', value: string) => {
    setEditFaqItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleRemoveEditFaqItem = (id: string) => {
    setEditFaqItems(prev => prev.length > 1 ? prev.filter(item => item.id !== id) : prev);
  };

  const handleSaveEdit = async () => {
    if (!editingFile || !editTitle.trim()) return;

    let finalContent = editContent.trim();
    if (editType === 'faq' && !editModeRaw) {
      finalContent = formatFaqContent(editFaqItems);
    }

    if (!finalContent.trim()) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Content cannot be empty.' });
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

      toast({ title: 'Saved Changes', description: `Updated "${editTitle}".` });
      setEditingFile(null);
      await fetchFiles();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: (error as Error).message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (fileId: string, fileName: string) => {
    try {
      const res = await fetch(`/api/knowledge?id=${fileId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete file.');
      toast({ title: 'Source Removed', description: `"${fileName}" deleted.` });
      fetchFiles();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: (error as Error).message });
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

  const filteredFiles = files.filter(f =>
    f.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.fileType.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusBadge = (status?: string, enabled?: boolean) => {
    if (enabled === false || status === 'disabled') {
      return <Badge variant="outline" className="text-muted-foreground border-muted flex items-center gap-1"><XCircle className="w-3 h-3" /> Disabled</Badge>;
    }
    if (status === 'processing') {
      return <Badge variant="secondary" className="bg-amber-100 text-amber-800 flex items-center gap-1"><Clock className="w-3 h-3 animate-spin" /> Processing</Badge>;
    }
    if (status === 'error') {
      return <Badge variant="destructive" className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Error</Badge>;
    }
    return <Badge className="bg-emerald-600 text-white flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Ready</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search knowledge sources..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* Add Manual FAQ Dialog */}
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button className="flex items-center gap-2">
                <Plus className="h-4 w-4" /> Add FAQ / Text
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <HelpCircle className="h-5 w-5 text-primary" /> Add Knowledge Source
                </DialogTitle>
              </DialogHeader>

              <ScrollArea className="flex-1 pr-3 -mr-3 max-h-[70vh]">
                <div className="space-y-4 py-2">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Title / Topic</label>
                    <Input
                      placeholder="e.g. Pricing & Services FAQ"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Source Type</label>
                    <select
                      value={newType}
                      onChange={(e) => setNewType(e.target.value)}
                      className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="faq">FAQ / Question-Answer (Structured)</option>
                      <option value="txt">Plain Text Document</option>
                      <option value="url">Web Page / URL Content</option>
                    </select>
                  </div>

                  {/* Dynamic FAQ Question & Answer List */}
                  {newType === 'faq' ? (
                    <div className="space-y-4 pt-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                          <MessageSquare className="w-3.5 h-3.5 text-primary" /> FAQ Questions & Answers
                        </label>
                        <span className="text-[11px] text-muted-foreground">
                          {newFaqItems.length} {newFaqItems.length === 1 ? 'entry' : 'entries'}
                        </span>
                      </div>

                      <div className="space-y-3">
                        {newFaqItems.map((item, index) => (
                          <div
                            key={item.id}
                            className="p-3.5 rounded-lg border border-border bg-card/60 space-y-2.5 transition-all hover:border-primary/40 shadow-sm"
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
                                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                  onClick={() => handleRemoveNewFaqItem(item.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>

                            <div>
                              <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                                Question
                              </label>
                              <Input
                                placeholder="e.g. Kati price ho? / What are your pricing plans?"
                                value={item.question}
                                onChange={(e) => handleUpdateNewFaqItem(item.id, 'question', e.target.value)}
                                className="text-sm font-medium"
                              />
                            </div>

                            <div>
                              <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                                Answer
                              </label>
                              <Textarea
                                placeholder="e.g. Our Basic Plan is Rs. 3,500/month for 2,000 messages. Pro Plan is Rs. 7,500/month."
                                value={item.answer}
                                onChange={(e) => handleUpdateNewFaqItem(item.id, 'answer', e.target.value)}
                                className="min-h-[64px] text-sm resize-y"
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleAddNewFaqItem}
                        className="w-full border-dashed flex items-center justify-center gap-1.5 py-4 hover:border-primary hover:text-primary transition-colors"
                      >
                        <Plus className="h-4 w-4" /> Add Question & Answer
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Business Facts & Knowledge Content</label>
                      <Textarea
                        placeholder="Write or paste your verified business facts, prices, contact numbers, and policies..."
                        value={newContent}
                        onChange={(e) => setNewContent(e.target.value)}
                        className="h-48 font-mono text-sm"
                      />
                    </div>
                  )}
                </div>
              </ScrollArea>

              <DialogFooter className="pt-3 border-t mt-2">
                <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button onClick={handleAddManualKnowledge} disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Source'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Upload File Button */}
          <Input
            id="file-upload"
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={handleFileChange}
            disabled={isUploading}
            className="hidden"
          />
          <label htmlFor="file-upload">
            <Button asChild variant="outline" className="cursor-pointer" disabled={isUploading}>
              <div>
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" /> Upload Document
                  </>
                )}
              </div>
            </Button>
          </label>
        </div>
      </div>

      {/* Main Knowledge Base Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" /> Tenant Knowledge Sources
          </CardTitle>
          <CardDescription>
            Knowledge sources are indexed for RAG retrieval to generate accurate AI customer answers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Active</TableHead>
                <TableHead>Title / File</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Size</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                  </TableCell>
                </TableRow>
              ) : filteredFiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No matching knowledge sources found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredFiles.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell>
                      <Switch
                        checked={file.enabled !== false}
                        onCheckedChange={() => handleToggleEnabled(file)}
                      />
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate font-medium sm:max-w-xs">{file.fileName}</TableCell>
                    <TableCell><Badge variant="secondary">{file.fileType.toUpperCase()}</Badge></TableCell>
                    <TableCell>{getStatusBadge(file.status, file.enabled)}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{formatBytes(file.size)}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{format(new Date(file.createdAt), 'MMM d, p')}</TableCell>
                    <TableCell className="text-right space-x-1">
                      {/* View Modal */}
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl">
                          <DialogHeader>
                            <DialogTitle>{file.fileName} ({file.fileType.toUpperCase()})</DialogTitle>
                          </DialogHeader>
                          <ScrollArea className="h-[60vh] rounded-md border p-4 font-mono text-sm whitespace-pre-wrap">
                            {file.content}
                          </ScrollArea>
                        </DialogContent>
                      </Dialog>

                      {/* Edit Modal */}
                      <Dialog open={editingFile?.id === file.id} onOpenChange={(open) => !open && setEditingFile(null)}>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(file)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
                          <DialogHeader>
                            <div className="flex items-center justify-between pr-4">
                              <DialogTitle className="flex items-center gap-2">
                                <Edit2 className="h-4 w-4 text-primary" /> Edit Knowledge Source
                              </DialogTitle>
                              {editType === 'faq' && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    if (!editModeRaw) {
                                      setEditContent(formatFaqContent(editFaqItems));
                                    } else {
                                      setEditFaqItems(parseFaqContent(editContent));
                                    }
                                    setEditModeRaw(!editModeRaw);
                                  }}
                                >
                                  {editModeRaw ? 'Switch to Q&A Editor' : 'Switch to Raw Text'}
                                </Button>
                              )}
                            </div>
                          </DialogHeader>

                          <ScrollArea className="flex-1 pr-3 -mr-3 max-h-[70vh]">
                            <div className="space-y-4 py-2">
                              <div>
                                <label className="text-xs font-semibold text-muted-foreground">Title</label>
                                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                              </div>

                              {editType === 'faq' && !editModeRaw ? (
                                <div className="space-y-4 pt-1">
                                  <div className="flex items-center justify-between">
                                    <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                                      <MessageSquare className="w-3.5 h-3.5 text-primary" /> FAQ Questions & Answers
                                    </label>
                                    <span className="text-[11px] text-muted-foreground">
                                      {editFaqItems.length} {editFaqItems.length === 1 ? 'entry' : 'entries'}
                                    </span>
                                  </div>

                                  <div className="space-y-3">
                                    {editFaqItems.map((item, index) => (
                                      <div
                                        key={item.id}
                                        className="p-3.5 rounded-lg border border-border bg-card/60 space-y-2.5 transition-all hover:border-primary/40 shadow-sm"
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
                                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                              onClick={() => handleRemoveEditFaqItem(item.id)}
                                            >
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                          )}
                                        </div>

                                        <div>
                                          <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                                            Question
                                          </label>
                                          <Input
                                            placeholder="e.g. Kati price ho? / What are your pricing plans?"
                                            value={item.question}
                                            onChange={(e) => handleUpdateEditFaqItem(item.id, 'question', e.target.value)}
                                            className="text-sm font-medium"
                                          />
                                        </div>

                                        <div>
                                          <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                                            Answer
                                          </label>
                                          <Textarea
                                            placeholder="e.g. Our Basic Plan is Rs. 3,500/month for 2,000 messages. Pro Plan is Rs. 7,500/month."
                                            value={item.answer}
                                            onChange={(e) => handleUpdateEditFaqItem(item.id, 'answer', e.target.value)}
                                            className="min-h-[64px] text-sm resize-y"
                                          />
                                        </div>
                                      </div>
                                    ))}
                                  </div>

                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleAddEditFaqItem}
                                    className="w-full border-dashed flex items-center justify-center gap-1.5 py-4 hover:border-primary hover:text-primary transition-colors"
                                  >
                                    <Plus className="h-4 w-4" /> Add Question & Answer
                                  </Button>
                                </div>
                              ) : (
                                <div>
                                  <label className="text-xs font-semibold text-muted-foreground">Content</label>
                                  <Textarea
                                    value={editContent}
                                    onChange={(e) => setEditContent(e.target.value)}
                                    className="h-64 font-mono text-sm"
                                  />
                                </div>
                              )}
                            </div>
                          </ScrollArea>

                          <DialogFooter className="pt-3 border-t mt-2">
                            <Button variant="outline" onClick={() => setEditingFile(null)}>Cancel</Button>
                            <Button onClick={handleSaveEdit} disabled={isSubmitting}>
                              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      {/* Delete */}
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(file.id, file.fileName)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
