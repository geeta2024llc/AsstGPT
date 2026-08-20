'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  CalendarClock,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  RotateCcw,
  Trash2,
  Send,
  Image as ImageIcon,
  Video as VideoIcon,
  MessageSquare,
  Paperclip,
  Loader2,
  Upload,
  Calendar as CalendarIcon,
  ChevronRight,
  Eye,
  Edit2,
  Sparkles,
  RefreshCw,
  Info,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { format, formatDistanceToNow, isPast } from 'date-fns';
import type { ScheduledMessage, ScheduledMessageStatus, ScheduledMessageType } from '@/types';
import ConfirmDeleteDialog from '@/components/confirm-delete-dialog';

export default function ScheduledMessagesManager() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ScheduledMessage[]>([]);
  const [stats, setStats] = useState({ pending: 0, sentToday: 0, failed: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Create / Edit Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ScheduledMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form fields
  const [recipientJid, setRecipientJid] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [messageType, setMessageType] = useState<ScheduledMessageType>('text');
  const [content, setContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaMimeType, setMediaMimeType] = useState('');
  const [mediaFileName, setMediaFileName] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('12:00');

  // Media upload state
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // View details modal
  const [viewingMessage, setViewingMessage] = useState<ScheduledMessage | null>(null);

  const fetchMessages = async () => {
    try {
      const url = statusFilter === 'all'
        ? '/api/scheduled-messages'
        : `/api/scheduled-messages?status=${statusFilter}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (err) {
      console.error('Failed to load scheduled messages:', err);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/scheduled-messages/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to load scheduled message stats:', err);
    }
  };

  const loadData = async () => {
    setIsRefreshing(true);
    await Promise.all([fetchMessages(), fetchStats()]);
    setIsLoading(false);
    setIsRefreshing(false);
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [statusFilter]);

  const resetForm = () => {
    setRecipientJid('');
    setRecipientName('');
    setMessageType('text');
    setContent('');
    setMediaUrl('');
    setMediaMimeType('');
    setMediaFileName('');

    // Default to 1 hour in the future
    const future = new Date(Date.now() + 60 * 60 * 1000);
    setScheduledDate(format(future, 'yyyy-MM-dd'));
    setScheduledTime(format(future, 'HH:mm'));
    setEditingMessage(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (msg: ScheduledMessage) => {
    setEditingMessage(msg);
    setRecipientJid(msg.recipientJid);
    setRecipientName(msg.recipientName || '');
    setMessageType(msg.messageType);
    setContent(msg.content || '');
    setMediaUrl(msg.mediaUrl || '');
    setMediaMimeType(msg.mediaMimeType || '');
    setMediaFileName(msg.mediaFileName || '');

    const dateObj = new Date(msg.scheduledAt);
    setScheduledDate(format(dateObj, 'yyyy-MM-dd'));
    setScheduledTime(format(dateObj, 'HH:mm'));
    setIsCreateOpen(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/scheduled-messages/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const data = await res.json();
      setMediaUrl(data.url);
      setMediaFileName(data.fileName);
      setMediaMimeType(data.mimeType);

      if (data.type === 'video') {
        setMessageType('video');
      } else if (data.type === 'image') {
        setMessageType('image');
      }

      toast({
        title: 'Media Uploaded',
        description: `${data.fileName} ready for scheduled dispatch.`,
      });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Upload Failed',
        description: err.message || 'Could not upload media file',
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientJid.trim()) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Recipient phone number is required.' });
      return;
    }

    if (messageType === 'text' && !content.trim()) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Message text content is required.' });
      return;
    }

    if ((messageType === 'image' || messageType === 'video') && !mediaUrl) {
      toast({ variant: 'destructive', title: 'Validation Error', description: `Please upload a media file for ${messageType} message.` });
      return;
    }

    if (!scheduledDate || !scheduledTime) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Scheduled date and time are required.' });
      return;
    }

    const scheduledIso = new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString();

    setIsSubmitting(true);
    try {
      if (editingMessage) {
        // Update existing
        const res = await fetch(`/api/scheduled-messages/${editingMessage.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: content.trim(),
            mediaUrl: mediaUrl || null,
            mediaMimeType: mediaMimeType || null,
            mediaFileName: mediaFileName || null,
            scheduledAt: scheduledIso,
            status: 'pending',
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update scheduled message');
        }

        toast({
          title: 'Scheduled Message Updated',
          description: `Message updated and set for ${format(new Date(scheduledIso), 'PPpp')}`,
        });
      } else {
        // Create new
        const res = await fetch('/api/scheduled-messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipientJid,
            recipientName,
            messageType,
            content,
            mediaUrl,
            mediaMimeType,
            mediaFileName,
            scheduledAt: scheduledIso,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to create scheduled message');
        }

        toast({
          title: 'Message Scheduled Successfully',
          description: `Will be dispatched to ${recipientName || recipientJid} on ${format(new Date(scheduledIso), 'PPpp')}`,
        });
      }

      setIsCreateOpen(false);
      resetForm();
      loadData();
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'Operation failed',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelMessage = async (id: string) => {
    try {
      const res = await fetch(`/api/scheduled-messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });

      if (!res.ok) throw new Error('Failed to cancel message');

      toast({
        title: 'Message Cancelled',
        description: 'The scheduled dispatch has been stopped.',
      });
      loadData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Action Failed', description: err.message });
    }
  };

  const handleSendNow = async (msg: ScheduledMessage) => {
    try {
      const immediateIso = new Date(Date.now() - 1000).toISOString();
      const res = await fetch(`/api/scheduled-messages/${msg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: immediateIso, status: 'pending' }),
      });

      if (!res.ok) throw new Error('Failed to trigger immediate send');

      toast({
        title: '🚀 Dispatched Immediately',
        description: 'Leader worker will pick up and send this message within seconds.',
      });
      loadData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Action Failed', description: err.message });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    try {
      const res = await fetch(`/api/scheduled-messages/${deleteTargetId}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete message');

      toast({
        title: 'Message Deleted',
        description: 'Scheduled message entry permanently removed.',
      });
      loadData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Delete Failed', description: err.message });
    } finally {
      setDeleteTargetId(null);
    }
  };

  const setQuickTime = (minutesFromNow: number) => {
    const target = new Date(Date.now() + minutesFromNow * 60 * 1000);
    setScheduledDate(format(target, 'yyyy-MM-dd'));
    setScheduledTime(format(target, 'HH:mm'));
  };

  const filteredMessages = messages.filter((m) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchJid = m.recipientJid.toLowerCase().includes(q);
      const matchName = (m.recipientName || '').toLowerCase().includes(q);
      const matchContent = (m.content || '').toLowerCase().includes(q);
      if (!matchJid && !matchName && !matchContent) return false;
    }
    return true;
  });

  const getStatusBadge = (status: ScheduledMessageStatus) => {
    switch (status) {
      case 'pending':
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30 gap-1">
            <Clock className="h-3 w-3" />
            <span>Pending</span>
          </Badge>
        );
      case 'processing':
        return (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30 gap-1 animate-pulse">
            <RotateCcw className="h-3 w-3 animate-spin" />
            <span>Sending...</span>
          </Badge>
        );
      case 'sent':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 gap-1">
            <CheckCircle2 className="h-3 w-3" />
            <span>Sent</span>
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="outline" className="bg-rose-500/10 text-rose-500 border-rose-500/30 gap-1">
            <AlertTriangle className="h-3 w-3" />
            <span>Failed</span>
          </Badge>
        );
      case 'cancelled':
        return (
          <Badge variant="outline" className="bg-slate-500/10 text-slate-400 border-slate-500/30 gap-1">
            <XCircle className="h-3 w-3" />
            <span>Cancelled</span>
          </Badge>
        );
    }
  };

  const getTypeIcon = (type: ScheduledMessageType) => {
    switch (type) {
      case 'image':
        return <ImageIcon className="h-3.5 w-3.5 text-blue-400" />;
      case 'video':
        return <VideoIcon className="h-3.5 w-3.5 text-purple-400" />;
      default:
        return <MessageSquare className="h-3.5 w-3.5 text-emerald-400" />;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="font-headline text-2xl sm:text-3xl font-bold tracking-tight">
              Scheduled Messages
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Schedule personalized WhatsApp text, image, and video messages for automated future delivery.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={isRefreshing}
            className="gap-1.5 h-9"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <Button
            onClick={handleOpenCreate}
            size="sm"
            className="gap-2 h-9 bg-primary text-primary-foreground font-semibold shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>Schedule Message</span>
          </Button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <Card className="border-border/60 bg-card/60 backdrop-blur-xs">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
              <span>Pending Dispatches</span>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-amber-500">{stats.pending}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Queued for delivery</p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur-xs">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
              <span>Sent Today</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-emerald-500">{stats.sentToday}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Delivered past 24h</p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur-xs">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
              <span>Failed Dispatches</span>
              <AlertTriangle className="h-4 w-4 text-rose-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-rose-500">{stats.failed}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Delivery failures</p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur-xs">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
              <span>Total Scheduled</span>
              <CalendarClock className="h-4 w-4 text-primary" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">All-time jobs</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content & Table */}
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="p-4 sm:p-5 border-b space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by contact, phone, or text..."
                className="pl-8.5 h-9 text-xs"
              />
            </div>

            <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full sm:w-auto">
              <TabsList className="grid grid-cols-5 w-full sm:w-auto h-9 p-1 bg-muted/60">
                <TabsTrigger value="all" className="text-xs px-2.5">All</TabsTrigger>
                <TabsTrigger value="pending" className="text-xs px-2.5">Pending</TabsTrigger>
                <TabsTrigger value="sent" className="text-xs px-2.5">Sent</TabsTrigger>
                <TabsTrigger value="failed" className="text-xs px-2.5">Failed</TabsTrigger>
                <TabsTrigger value="cancelled" className="text-xs px-2.5">Cancelled</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-12 space-y-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm">Loading scheduled dispatches...</p>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center space-y-3">
              <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
                <CalendarClock className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-sm">No scheduled messages found</h3>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {statusFilter !== 'all'
                    ? `There are currently no messages with status "${statusFilter}".`
                    : 'Schedule an automated text, image, or video dispatch to any contact.'}
                </p>
              </div>
              <Button onClick={handleOpenCreate} size="sm" variant="outline" className="gap-1.5 mt-2">
                <Plus className="h-4 w-4" />
                <span>Create Schedule</span>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider border-b">
                  <tr>
                    <th className="py-3 px-4">Recipient</th>
                    <th className="py-3 px-4">Message & Media</th>
                    <th className="py-3 px-4">Scheduled For</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredMessages.map((msg) => {
                    const scheduledAtDate = new Date(msg.scheduledAt);
                    const isUpcoming = !isPast(scheduledAtDate) && msg.status === 'pending';

                    return (
                      <tr key={msg.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-medium">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                              {(msg.recipientName || msg.recipientJid).slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-foreground truncate">
                                {msg.recipientName || 'Direct WhatsApp'}
                              </div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {msg.recipientJid.replace('@s.whatsapp.net', '')}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 max-w-xs sm:max-w-md">
                            <div className="p-1 rounded bg-muted/60 shrink-0">
                              {getTypeIcon(msg.messageType)}
                            </div>
                            <div className="truncate">
                              {msg.content ? (
                                <span className="text-foreground">{msg.content}</span>
                              ) : msg.mediaFileName ? (
                                <span className="text-muted-foreground italic">{msg.mediaFileName}</span>
                              ) : (
                                <span className="text-muted-foreground italic">[Media Attached]</span>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <div>
                            <span className="font-medium text-foreground">
                              {format(scheduledAtDate, 'MMM d, yyyy')}
                            </span>
                            <span className="text-muted-foreground ml-1.5">
                              {format(scheduledAtDate, 'p')}
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {isUpcoming ? (
                              <span className="text-amber-500 font-medium">
                                in {formatDistanceToNow(scheduledAtDate)}
                              </span>
                            ) : msg.sentAt ? (
                              <span className="text-emerald-500">
                                Sent {formatDistanceToNow(new Date(msg.sentAt), { addSuffix: true })}
                              </span>
                            ) : (
                              formatDistanceToNow(scheduledAtDate, { addSuffix: true })
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          {getStatusBadge(msg.status)}
                          {msg.errorMessage && (
                            <div className="text-[10px] text-rose-500 truncate max-w-[140px] mt-0.5" title={msg.errorMessage}>
                              {msg.errorMessage}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            {msg.status === 'pending' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10 cursor-pointer"
                                  onClick={() => handleSendNow(msg)}
                                  title="Send Now (Dispatch immediately)"
                                >
                                  <Send className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
                                  onClick={() => handleOpenEdit(msg)}
                                  title="Edit / Reschedule"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-amber-500 hover:text-amber-600 hover:bg-amber-500/10 cursor-pointer"
                                  onClick={() => handleCancelMessage(msg.id)}
                                  title="Cancel Schedule"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}

                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
                              onClick={() => setViewingMessage(msg)}
                              title="View Details"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 cursor-pointer"
                              onClick={() => setDeleteTargetId(msg.id)}
                              title="Delete Record"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedule / Edit Modal Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-headline">
                <CalendarClock className="h-5 w-5 text-primary" />
                <span>{editingMessage ? 'Edit Scheduled Message' : 'Schedule New Message'}</span>
              </DialogTitle>
              <DialogDescription>
                Compose a message and select the exact date and time for automated WhatsApp delivery.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3.5 py-1">
              {/* Recipient Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="recipientPhone" className="text-xs font-semibold">
                    Recipient Phone Number <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="recipientPhone"
                    value={recipientJid}
                    onChange={(e) => setRecipientJid(e.target.value)}
                    placeholder="+1 786 814 8367"
                    required
                    disabled={!!editingMessage}
                    className="h-9 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">With country code (e.g. 17868148367)</p>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="recipientName" className="text-xs font-semibold">
                    Contact Name (Optional)
                  </Label>
                  <Input
                    id="recipientName"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="e.g. Sarah Connor"
                    disabled={!!editingMessage}
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              {/* Message Type Selector */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Message Type</Label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setMessageType('text')}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                      messageType === 'text'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-card hover:bg-muted/50 text-muted-foreground'
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Plain Text</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMessageType('image')}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                      messageType === 'image'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-card hover:bg-muted/50 text-muted-foreground'
                    }`}
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    <span>Image</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMessageType('video')}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                      messageType === 'video'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-card hover:bg-muted/50 text-muted-foreground'
                    }`}
                  >
                    <VideoIcon className="h-3.5 w-3.5" />
                    <span>Video</span>
                  </button>
                </div>
              </div>

              {/* Media Uploader (if Image or Video) */}
              {(messageType === 'image' || messageType === 'video') && (
                <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold flex items-center gap-1.5">
                      <Upload className="h-3.5 w-3.5 text-primary" />
                      <span>{messageType === 'image' ? 'Upload Image File' : 'Upload Video File'}</span>
                    </Label>
                    <span className="text-[10px] text-muted-foreground">
                      {messageType === 'image' ? 'JPG, PNG, WebP (Max 15MB)' : 'MP4, 3GP (Max 30MB)'}
                    </span>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={messageType === 'image' ? 'image/*' : 'video/*'}
                    onChange={handleFileUpload}
                    className="hidden"
                  />

                  {mediaUrl ? (
                    <div className="flex items-center justify-between p-2 rounded-md bg-card border">
                      <div className="flex items-center gap-2 min-w-0">
                        {messageType === 'image' ? (
                          <img
                            src={mediaUrl}
                            alt="Upload preview"
                            className="h-10 w-10 object-cover rounded border shrink-0"
                          />
                        ) : (
                          <div className="h-10 w-10 bg-purple-500/10 rounded flex items-center justify-center text-purple-500 shrink-0">
                            <VideoIcon className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{mediaFileName || 'Media attached'}</p>
                          <p className="text-[10px] text-muted-foreground">{mediaMimeType}</p>
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setMediaUrl('');
                          setMediaFileName('');
                          setMediaMimeType('');
                        }}
                        className="h-7 text-xs text-rose-500 hover:text-rose-600"
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="w-full flex flex-col items-center justify-center p-4 border border-dashed rounded-lg bg-card hover:bg-muted/40 transition-colors cursor-pointer text-center space-y-1.5"
                    >
                      {isUploading ? (
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      ) : (
                        <Upload className="h-6 w-6 text-muted-foreground" />
                      )}
                      <div className="text-xs font-medium">
                        {isUploading ? 'Uploading file...' : 'Click to select and upload media'}
                      </div>
                      <p className="text-[10px] text-muted-foreground">Files are stored securely for automated dispatch</p>
                    </button>
                  )}
                </div>
              )}

              {/* Message Content / Caption */}
              <div className="space-y-1">
                <Label htmlFor="msgContent" className="text-xs font-semibold">
                  {messageType === 'text' ? 'Message Text' : 'Caption (Optional)'}
                </Label>
                <Textarea
                  id="msgContent"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={
                    messageType === 'text'
                      ? 'Type your message text here...'
                      : 'Add an optional caption to accompany the media...'
                  }
                  rows={3}
                  className="text-xs resize-none"
                />
              </div>

              {/* Schedule Date & Time */}
              <div className="space-y-1.5 pt-1">
                <Label className="text-xs font-semibold flex items-center justify-between">
                  <span>Dispatch Date & Time</span>
                  <span className="text-[10px] text-muted-foreground font-normal">
                    Local Timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                  </span>
                </Label>

                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <Input
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      required
                      className="h-9 text-xs"
                    />
                  </div>

                  <div className="relative">
                    <Input
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      required
                      className="h-9 text-xs"
                    />
                  </div>
                </div>

                {/* Quick Presets */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-muted-foreground mr-1">Quick presets:</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setQuickTime(30)}
                    className="h-6 text-[10px] px-2"
                  >
                    +30 Mins
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setQuickTime(60)}
                    className="h-6 text-[10px] px-2"
                  >
                    +1 Hour
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setQuickTime(240)}
                    className="h-6 text-[10px] px-2"
                  >
                    +4 Hours
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setQuickTime(1440)}
                    className="h-6 text-[10px] px-2"
                  >
                    Tomorrow
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-2 border-t flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>

              <Button
                type="submit"
                size="sm"
                className="gap-1.5 font-semibold bg-primary text-primary-foreground"
                disabled={isSubmitting || isUploading}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <CalendarClock className="h-3.5 w-3.5" />
                    <span>{editingMessage ? 'Update Schedule' : 'Schedule Message'}</span>
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Details Dialog */}
      <Dialog open={!!viewingMessage} onOpenChange={(open) => !open && setViewingMessage(null)}>
        {viewingMessage && (
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-headline">
                <Info className="h-4 w-4 text-primary" />
                <span>Scheduled Dispatch Details</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40">
                <span className="text-muted-foreground">Status:</span>
                <div>{getStatusBadge(viewingMessage.status)}</div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-lg border bg-card">
                  <div className="text-muted-foreground text-[10px]">Recipient</div>
                  <div className="font-semibold text-foreground mt-0.5">{viewingMessage.recipientName || 'Direct'}</div>
                  <div className="text-muted-foreground text-[11px]">{viewingMessage.recipientJid}</div>
                </div>

                <div className="p-2.5 rounded-lg border bg-card">
                  <div className="text-muted-foreground text-[10px]">Scheduled Time</div>
                  <div className="font-semibold text-foreground mt-0.5">
                    {format(new Date(viewingMessage.scheduledAt), 'PPpp')}
                  </div>
                </div>
              </div>

              {viewingMessage.content && (
                <div className="p-3 rounded-lg border bg-card space-y-1">
                  <div className="text-muted-foreground text-[10px] uppercase font-bold">Message Content</div>
                  <p className="text-foreground whitespace-pre-wrap">{viewingMessage.content}</p>
                </div>
              )}

              {viewingMessage.mediaUrl && (
                <div className="p-3 rounded-lg border bg-card space-y-2">
                  <div className="text-muted-foreground text-[10px] uppercase font-bold">Media Attachment</div>
                  {viewingMessage.messageType === 'image' ? (
                    <img
                      src={viewingMessage.mediaUrl}
                      alt="Attachment preview"
                      className="max-h-48 rounded object-contain border mx-auto"
                    />
                  ) : (
                    <video
                      src={viewingMessage.mediaUrl}
                      controls
                      className="max-h-48 rounded border mx-auto"
                    />
                  )}
                  <p className="text-[10px] text-muted-foreground text-center truncate">{viewingMessage.mediaFileName || viewingMessage.mediaUrl}</p>
                </div>
              )}

              {viewingMessage.errorMessage && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-500">
                  <div className="font-semibold text-[11px]">Error Details:</div>
                  <p className="text-[11px] mt-0.5">{viewingMessage.errorMessage}</p>
                </div>
              )}

              {viewingMessage.sentAt && (
                <div className="text-[11px] text-emerald-500">
                  ✓ Successfully dispatched on {format(new Date(viewingMessage.sentAt), 'PPpp')}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button size="sm" variant="outline" onClick={() => setViewingMessage(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* Confirm Delete Dialog */}
      <ConfirmDeleteDialog
        isOpen={!!deleteTargetId}
        onOpenChange={(open) => !open && setDeleteTargetId(null)}
        title="Delete Scheduled Message?"
        description="Are you sure you want to remove this scheduled message record? This action cannot be undone."
        itemType="scheduled message"
        confirmLabel="Yes, Delete"
        cancelLabel="Cancel"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
