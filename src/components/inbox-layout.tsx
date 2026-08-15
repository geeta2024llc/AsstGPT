'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Send,
  Paperclip,
  Loader2,
  ArrowLeft,
  Bot,
  User,
  ShieldAlert,
  Sparkles,
  UserCheck,
  CheckCircle2,
  CheckCircle,
  RotateCcw,
  Filter,
  MessageSquareQuote,
  Volume2,
  VolumeX,
  Search,
  Lock,
  MessageSquare,
  StickyNote,
  Trash2,
  Radio,
  UserCog,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { formatContactName, formatChatSubtitle, getAvatarInitials } from '@/lib/format-utils';
import ContactProfileDrawer from '@/components/contact-profile-drawer';
import { Conversation, Message, TeamMember, CannedResponse, ConversationNote, isConversationPaused } from '@/types';
import { format } from 'date-fns';

function playNotificationChime() {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (err) {
    // Ignore audio context autoplay restrictions
  }
}

type TimelineItem =
  | { type: 'message'; data: Message; timestamp: number }
  | { type: 'note'; data: ConversationNote; timestamp: number };

export default function InboxLayout() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notes, setNotes] = useState<ConversationNote[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [failedMessageIds, setFailedMessageIds] = useState<Set<string>>(new Set());
  const [newMessage, setNewMessage] = useState('');
  const [composerMode, setComposerMode] = useState<'message' | 'note'>('message');
  const [isLoading, setIsLoading] = useState({ convos: true, messages: false });
  const [isTogglingTakeover, setIsTogglingTakeover] = useState(false);
  const [isAssigningMember, setIsAssigningMember] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isCannedDialogOpen, setIsCannedDialogOpen] = useState(false);
  const [isProfileDrawerOpen, setIsProfileDrawerOpen] = useState(false);
  const [cannedFilterText, setCannedFilterText] = useState('');
  const [selectedCannedIndex, setSelectedCannedIndex] = useState(0);

  const prevUnreadRef = useRef<number>(0);
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'open' | 'my_chats' | 'unassigned' | 'unread' | 'bot_active' | 'human_takeover' | 'resolved' | 'all'>('open');

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);

  // Slash command autocomplete popup logic (only in message mode)
  const isSlashActive = composerMode === 'message' && newMessage.startsWith('/');
  const slashQuery = isSlashActive ? newMessage.slice(1).toLowerCase() : '';
  const matchingCannedResponses = isSlashActive
    ? cannedResponses.filter(
        c =>
          c.shortcut.toLowerCase().includes(slashQuery) ||
          c.title.toLowerCase().includes(slashQuery)
      )
    : [];

  const filteredConversations = useMemo(() => {
    return conversations.filter(c => {
      const matchesSearch =
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.id.toLowerCase().includes(searchQuery.toLowerCase());

      const isResolved = c.status === 'resolved';

      let matchesFilter = true;
      if (filterMode === 'open') {
        matchesFilter = !isResolved;
      } else if (filterMode === 'my_chats') {
        const myId = teamMembers[0]?.id;
        matchesFilter = c.assignedUserId === myId && !isResolved;
      } else if (filterMode === 'unassigned') {
        matchesFilter = (!c.assignedUserId || c.assignedUserId === 'unassigned') && !isResolved;
      } else if (filterMode === 'unread') {
        matchesFilter = c.unreadCount > 0;
      } else if (filterMode === 'bot_active') {
        matchesFilter = !isConversationPaused(c) && !isResolved;
      } else if (filterMode === 'human_takeover') {
        matchesFilter = isConversationPaused(c) && !isResolved;
      } else if (filterMode === 'resolved') {
        matchesFilter = isResolved;
      } else if (filterMode === 'all') {
        matchesFilter = true;
      }

      return matchesSearch && matchesFilter;
    });
  }, [conversations, searchQuery, filterMode, teamMembers]);

  const fetchConversations = async () => {
    try {
      const res = await fetch('/api/inbox/conversations');
      if (!res.ok) throw new Error('Failed to fetch conversations');
      const data: Conversation[] = await res.json();

      const totalUnread = data.reduce((acc, curr) => acc + (curr.unreadCount || 0), 0);
      if (totalUnread > prevUnreadRef.current && soundEnabled && prevUnreadRef.current > 0) {
        playNotificationChime();
      }
      prevUnreadRef.current = totalUnread;

      setConversations(data);
      if (!selectedConversationId && data.length > 0 && typeof window !== 'undefined' && window.innerWidth >= 768) {
        const firstOpen = data.find(c => c.status !== 'resolved') || data[0];
        setSelectedConversationId(firstOpen.id);
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: (error as Error).message });
    } finally {
      setIsLoading(prevState => ({ ...prevState, convos: false }));
    }
  };

  const fetchTeamMembers = async () => {
    try {
      const res = await fetch('/api/team');
      if (res.ok) {
        const data = await res.json();
        setTeamMembers(data);
      }
    } catch (err) {
      console.error('Failed to fetch team members:', err);
    }
  };

  const fetchCannedResponses = async () => {
    try {
      const res = await fetch('/api/inbox/canned-responses');
      if (res.ok) {
        const data = await res.json();
        setCannedResponses(data);
      }
    } catch (err) {
      console.error('Failed to fetch canned responses:', err);
    }
  };

  const fetchMessages = async (chatId: string) => {
    setIsLoading(prevState => ({ ...prevState, messages: true }));
    try {
      const res = await fetch(`/api/inbox/messages/${encodeURIComponent(chatId)}`);
      if (!res.ok) throw new Error('Failed to fetch messages');
      const data: Message[] = await res.json();
      setMessages(data.sort((a, b) => a.timestamp - b.timestamp));
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: (error as Error).message });
    } finally {
      setIsLoading(prevState => ({ ...prevState, messages: false }));
    }
  };

  const fetchNotes = async (chatId: string) => {
    try {
      const res = await fetch(`/api/inbox/notes?chatId=${encodeURIComponent(chatId)}`);
      if (res.ok) {
        const data: ConversationNote[] = await res.json();
        setNotes(data);
      }
    } catch (err) {
      console.error('Failed to fetch notes:', err);
    }
  };

  // 1. Initial Data Fetch & Polling Fallback
  useEffect(() => {
    fetchConversations();
    fetchTeamMembers();
    fetchCannedResponses();
    // Fast 5s fallback polling ensures responsive updates even if Realtime is unavailable
    const interval = setInterval(fetchConversations, 5000);
    return () => clearInterval(interval);
  }, [soundEnabled]);

  // 2. Load Messages & Notes when Active Conversation Changes
  useEffect(() => {
    if (selectedConversationId) {
      fetchMessages(selectedConversationId);
      fetchNotes(selectedConversationId);
    } else {
      setMessages([]);
      setNotes([]);
    }
  }, [selectedConversationId]);

  // 3. Supabase Realtime Live Streaming Subscription (only when configured)
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      // Supabase credentials not set or using placeholder — skip WebSocket to avoid connection errors
      return;
    }

    try {
      const channel = supabase
        .channel('inbox-live-stream')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload: any) => {
            const row = payload.new;
            if (row) {
              const rawChatId = row.metadata?.chatId || row.metadata?.chat_id || row.chat_id || row.conversation_id;
              const formattedMsg: Message = {
                id: row.provider_message_id || row.id,
                chatId: rawChatId,
                fromMe: !!row.from_me,
                text: row.text || '',
                timestamp: new Date(row.timestamp || row.created_at).getTime(),
                senderName: row.sender_name || (row.from_me ? 'Me' : 'Customer'),
              };

              const isCurrentChat =
                selectedConversationId &&
                (rawChatId === selectedConversationId ||
                 row.conversation_id === selectedConversationId ||
                 (selectedConversation && (rawChatId === selectedConversation.id || row.conversation_id === (selectedConversation as any).convoId)));

              if (isCurrentChat) {
                setMessages(prev => {
                  if (prev.some(m => m.id === formattedMsg.id)) return prev;

                  // Reconcile optimistic temp_ messages: If an outbound temp_ message with the same text exists within 15 seconds, replace it
                  if (formattedMsg.fromMe) {
                    const tempIndex = prev.findIndex(
                      m => m.id.startsWith('temp_') && m.fromMe && m.text === formattedMsg.text && Math.abs(m.timestamp - formattedMsg.timestamp) < 15000
                    );
                    if (tempIndex !== -1) {
                      const next = [...prev];
                      next[tempIndex] = formattedMsg;
                      return next.sort((a, b) => a.timestamp - b.timestamp);
                    }
                  }

                  return [...prev, formattedMsg].sort((a, b) => a.timestamp - b.timestamp);
                });
              }

              if (!formattedMsg.fromMe && soundEnabled) {
                playNotificationChime();
              }

              fetchConversations();
            }
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'conversations' },
          () => {
            fetchConversations();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'conversation_notes' },
          () => {
            if (selectedConversationId) {
              fetchNotes(selectedConversationId);
            }
          }
        )
        .subscribe();

      return () => {
        try {
          supabase.removeChannel(channel);
        } catch {
          // Ignore cleanup errors
        }
      };
    } catch (realtimeErr) {
      console.warn('Realtime subscription setup notice:', realtimeErr);
    }
  }, [selectedConversationId, soundEnabled]);

  // 4. Auto-Scroll to Bottom on Message/Note Arrival
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo(0, scrollAreaRef.current.scrollHeight);
    }
  }, [messages, notes]);

  const handleToggleTakeover = async (chatId: string, targetMode: 'human' | 'ai') => {
    setIsTogglingTakeover(true);
    try {
      const isHuman = targetMode === 'human';
      const defaultUser = teamMembers[0]?.id;

      const res = await fetch('/api/inbox/takeover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          mode: targetMode,
          assignedUserId: isHuman ? (selectedConversation?.assignedUserId || defaultUser) : undefined,
          reason: isHuman ? 'Manual takeover by agent in Inbox' : undefined,
        }),
      });

      if (!res.ok) throw new Error('Failed to toggle takeover');

      toast({
        title: isHuman ? '👤 Human Takeover Activated' : '🤖 AI Auto-Reply Resumed',
        description: isHuman
          ? 'AI auto-reply paused for this conversation. You can now reply directly.'
          : 'AI auto-reply is now active and will respond to incoming customer messages.',
      });

      fetchConversations();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Action Failed', description: (err as Error).message });
    } finally {
      setIsTogglingTakeover(false);
    }
  };

  const handleAssignTeamMember = async (chatId: string, memberId: string) => {
    setIsAssigningMember(true);
    try {
      const res = await fetch('/api/inbox/takeover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          mode: 'human',
          assignedUserId: memberId === 'unassigned' ? undefined : memberId,
          reason: 'Reassigned by agent in Inbox',
        }),
      });

      if (!res.ok) throw new Error('Failed to assign conversation');

      const assignedMember = teamMembers.find(m => m.id === memberId);
      toast({
        title: 'Agent Assigned',
        description: memberId === 'unassigned'
          ? 'Conversation moved to unassigned queue.'
          : `Assigned to ${assignedMember?.fullName || memberId}`,
      });

      fetchConversations();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Assignment Failed', description: (err as Error).message });
    } finally {
      setIsAssigningMember(false);
    }
  };

  const handleToggleResolve = async (chatId: string, willResolve: boolean) => {
    setIsResolving(true);
    try {
      const res = await fetch('/api/inbox/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          status: willResolve ? 'resolved' : 'open',
        }),
      });

      if (!res.ok) throw new Error('Failed to update resolution status');

      toast({
        title: willResolve ? '✅ Conversation Resolved' : '🔄 Conversation Reopened',
        description: willResolve
          ? 'Marked as resolved and archived from active queue.'
          : 'Conversation returned to active inbox.',
      });

      fetchConversations();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Action Failed', description: (err as Error).message });
    } finally {
      setIsResolving(false);
    }
  };

  const insertCannedSnippet = (snippetContent: string) => {
    setNewMessage(snippetContent);
    setIsCannedDialogOpen(false);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleKeyDownInComposer = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isSlashActive || matchingCannedResponses.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedCannedIndex(prev => (prev + 1) % matchingCannedResponses.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedCannedIndex(prev => (prev - 1 + matchingCannedResponses.length) % matchingCannedResponses.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const selected = matchingCannedResponses[selectedCannedIndex] || matchingCannedResponses[0];
      if (selected) {
        insertCannedSnippet(selected.content);
      }
    } else if (e.key === 'Escape') {
      setNewMessage('');
    }
  };

  const handlePostInternalNote = async () => {
    if (!newMessage.trim() || !selectedConversationId) return;
    const noteText = newMessage.trim();
    setNewMessage('');

    try {
      const currentUser = teamMembers.find(m => m.id === selectedConversation?.assignedUserId) || teamMembers[0];
      const res = await fetch('/api/inbox/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: selectedConversationId,
          content: noteText,
          userName: currentUser?.fullName || 'Agent',
          userAvatar: currentUser?.avatarUrl,
          userId: currentUser?.id,
        }),
      });

      if (!res.ok) throw new Error('Failed to post internal note');
      const createdNote: ConversationNote = await res.json();
      setNotes(prev => [...prev, createdNote]);
      toast({ title: '🔒 Internal Note Saved', description: 'Note added to conversation thread.' });
    } catch (err) {
      setNewMessage(noteText);
      toast({ variant: 'destructive', title: 'Note Error', description: (err as Error).message });
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Delete this internal team note?')) return;
    try {
      const res = await fetch(`/api/inbox/notes/${noteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete note');
      setNotes(prev => prev.filter(n => n.id !== noteId));
      toast({ title: 'Note Deleted' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    }
  };

  const retryFailedMessage = async (msg: Message) => {
    setFailedMessageIds(prev => {
      const next = new Set(prev);
      next.delete(msg.id);
      return next;
    });
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: msg.chatId, text: msg.text }),
      });
      if (!res.ok) throw new Error(`Failed to send message (HTTP ${res.status})`);
      toast({ title: 'Message Sent', description: 'Outbound message delivered successfully.' });
    } catch (err) {
      setFailedMessageIds(prev => new Set(prev).add(msg.id));
      toast({ variant: 'destructive', title: 'Retry Failed', description: (err as Error).message });
    }
  };

  const handleSelectConversation = async (convo: Conversation) => {
    setSelectedConversationId(convo.id);
    if (convo.unreadCount > 0) {
      setConversations(prev => prev.map(c => c.id === convo.id ? { ...c, unreadCount: 0 } : c));
      try {
        fetch('/api/inbox/resolve', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: convo.id, unreadCount: 0 }),
        }).catch(() => {});
      } catch (_) {}
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedConversationId) return;

    if (composerMode === 'note') {
      await handlePostInternalNote();
      return;
    }

    const originalMessage = newMessage;
    setNewMessage('');

    const tempId = `temp_${Date.now()}`;
    const optimisticMessage: Message = {
      id: tempId,
      chatId: selectedConversationId,
      fromMe: true,
      text: originalMessage,
      timestamp: Date.now(),
      senderName: 'Me',
    };
    setMessages(prev => [...prev, optimisticMessage]);

    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selectedConversationId, text: originalMessage }),
      });

      if (!res.ok) {
        throw new Error(`Failed to send message (HTTP ${res.status})`);
      }

      if (selectedConversation?.status === 'resolved') {
        handleToggleResolve(selectedConversationId, false);
      }
    } catch (error) {
      setFailedMessageIds(prev => new Set(prev).add(tempId));
      toast({ variant: 'destructive', title: 'Send Failed', description: (error as Error).message });
    }
  };

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts);
    const now = new Date();
    if (format(date, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd')) {
      return format(date, 'p');
    }
    if (format(date, 'yyyy') === format(now, 'yyyy')) {
      return format(date, 'MMM d');
    }
    return format(date, 'PP');
  };

  // Combine messages and internal notes into a single chronological timeline
  const timelineItems: TimelineItem[] = [
    ...messages.map(m => ({ type: 'message' as const, data: m, timestamp: m.timestamp })),
    ...notes.map(n => ({ type: 'note' as const, data: n, timestamp: n.createdAt })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  const isSelectedConvoPaused = isConversationPaused(selectedConversation);

  const isSelectedConvoResolved = selectedConversation?.status === 'resolved';

  return (
    <div className="relative flex h-[calc(100vh-theme(spacing.36))] rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Sidebar: Conversation List */}
      <aside
        className={cn(
          'w-full transition-transform duration-300 ease-in-out md:w-1/3 md:border-r md:translate-x-0 flex flex-col',
          selectedConversationId && '-translate-x-full'
        )}
      >
        <div className="border-b p-3 space-y-2 bg-muted/20">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-headline text-lg font-semibold flex items-center gap-1.5">
              <span>Inbox</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                {filteredConversations.length}
              </Badge>
              <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 ml-1 font-normal">
                <Radio className="h-2.5 w-2.5 animate-pulse" />
                <span>Live</span>
              </span>
            </h2>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={() => setSoundEnabled(p => !p)}
                title={soundEnabled ? 'Notification chime on' : 'Notification chime muted'}
              >
                {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5 opacity-50" />}
              </Button>

              <Select value={filterMode} onValueChange={(val: any) => setFilterMode(val)}>
                <SelectTrigger className="h-7 text-xs px-2 w-[145px] bg-background">
                  <Filter className="h-3 w-3 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="open" className="text-xs">Active / Open</SelectItem>
                  <SelectItem value="my_chats" className="text-xs">👤 My Assigned Chats</SelectItem>
                  <SelectItem value="unassigned" className="text-xs">📥 Unassigned Queue</SelectItem>
                  <SelectItem value="unread" className="text-xs">🔴 Unread</SelectItem>
                  <SelectItem value="bot_active" className="text-xs">🤖 Bot Active</SelectItem>
                  <SelectItem value="human_takeover" className="text-xs">⚡ Live Takeover</SelectItem>
                  <SelectItem value="resolved" className="text-xs">✅ Resolved</SelectItem>
                  <SelectItem value="all" className="text-xs">All Chats</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Input
            placeholder="Search contacts or numbers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 text-xs bg-background"
          />
        </div>

        <ScrollArea className="flex-1">
          {isLoading.convos ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm space-y-1">
              <p>No conversations found in this view.</p>
              {filterMode !== 'open' && (
                <Button variant="link" size="sm" onClick={() => setFilterMode('open')} className="text-xs">
                  View Active / Open Chats
                </Button>
              )}
            </div>
          ) : (
            filteredConversations.map((convo, idx) => {
              const isPaused = isConversationPaused(convo);
              const isResolved = convo.status === 'resolved';
              const member = teamMembers.find(m => m.id === convo.assignedUserId);
              const displayName = formatContactName(convo.name, convo.id);
              const avatarInitials = getAvatarInitials(convo.name, convo.id);

              return (
                <div
                  key={`${convo.id}_${idx}`}
                  onClick={() => handleSelectConversation(convo)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-muted/50 border-b border-border/40',
                    selectedConversationId === convo.id && 'bg-muted/80',
                    isResolved && 'opacity-70 bg-muted/20'
                  )}
                >
                  <div className="relative">
                    <Avatar className="h-10 w-10 border bg-muted/40 shrink-0">
                      <AvatarImage src={convo.avatar} alt={displayName} />
                      <AvatarFallback className="font-semibold text-xs text-primary bg-primary/10">
                        {avatarInitials}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      className={cn(
                        'absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2 ring-background text-[8px]',
                        isResolved
                          ? 'bg-slate-500 text-white'
                          : isPaused
                          ? 'bg-amber-500 text-white'
                          : 'bg-emerald-500 text-white'
                      )}
                      title={
                        isResolved
                          ? 'Resolved Conversation'
                          : isPaused
                          ? 'Human Takeover Mode'
                          : 'AI Auto-Reply Active'
                      }
                    >
                      {isResolved ? '✓' : isPaused ? '👤' : '🤖'}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="font-semibold text-sm truncate">{displayName}</p>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap ml-2">
                        {formatTimestamp(convo.lastMessage.timestamp)}
                      </span>
                    </div>

                    <p className="truncate text-xs text-muted-foreground mb-1.5">
                      {convo.lastMessage.text || 'No messages yet'}
                    </p>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isResolved ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1 bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
                          ✓ Resolved
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1',
                            isPaused
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          )}
                        >
                          {isPaused ? '👤 Takeover' : '🤖 AI Active'}
                        </span>
                      )}

                      {member && !isResolved && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border truncate max-w-[110px]">
                          {member.fullName.split(' ')[0]}
                        </span>
                      )}

                      {convo.unreadCount > 0 && (
                        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                          {convo.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </ScrollArea>
      </aside>

      {/* Main Chat Area */}
      <main
        className={cn(
          'absolute top-0 left-0 flex h-full w-full flex-col bg-card transition-transform duration-300 ease-in-out md:static md:w-2/3 md:translate-x-0',
          selectedConversationId ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {selectedConversation ? (
          <>
            {/* Conversation Header */}
            <header className="flex flex-col shrink-0 border-b bg-card">
              <div className="flex items-center justify-between p-3 gap-2 flex-wrap">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden shrink-0 h-8 w-8"
                    onClick={() => setSelectedConversationId(null)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span className="sr-only">Back</span>
                  </Button>

                  <Avatar className="h-9 w-9 shrink-0 border bg-muted/40">
                    <AvatarImage src={selectedConversation.avatar} alt={formatContactName(selectedConversation.name, selectedConversation.id)} />
                    <AvatarFallback className="font-semibold text-xs text-primary bg-primary/10">
                      {getAvatarInitials(selectedConversation.name, selectedConversation.id)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="font-headline font-semibold text-sm truncate">
                        {formatContactName(selectedConversation.name, selectedConversation.id)}
                      </h3>
                      {selectedConversation.stage && (
                        <span className={cn('text-[10px] px-1.5 py-0 rounded border capitalize font-medium', {
                          'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20': selectedConversation.stage === 'lead',
                          'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20': selectedConversation.stage === 'prospect',
                          'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20': selectedConversation.stage === 'customer',
                          'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-semibold': selectedConversation.stage === 'vip',
                          'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20': selectedConversation.stage === 'churned',
                        })}>
                          {selectedConversation.stage === 'vip' ? '★ VIP' : selectedConversation.stage}
                        </span>
                      )}
                      {selectedConversation.sentiment && selectedConversation.sentiment !== 'neutral' && (
                        <span
                          className={cn(
                            'text-[10px] px-1.5 py-0 rounded border font-medium inline-flex items-center gap-1',
                            selectedConversation.sentiment === 'positive' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
                            selectedConversation.sentiment === 'negative' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
                            selectedConversation.sentiment === 'frustrated' && 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 animate-pulse font-bold'
                          )}
                          title={`Customer Sentiment: ${selectedConversation.sentiment}`}
                        >
                          {selectedConversation.sentiment === 'positive' && '😊 Positive'}
                          {selectedConversation.sentiment === 'negative' && '😟 Negative'}
                          {selectedConversation.sentiment === 'frustrated' && '😠 Frustrated'}
                        </span>
                      )}
                      {isSelectedConvoResolved && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-slate-500/10 text-slate-600 dark:text-slate-400">
                          Resolved
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                      <span>{formatChatSubtitle(selectedConversation.id, selectedConversation.company)}</span>
                    </div>
                  </div>
                </div>

                {/* Header Action Controls */}
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {/* Contact CRM Profile Drawer Button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5 px-2.5"
                    onClick={() => setIsProfileDrawerOpen(true)}
                    title="View & Edit Contact CRM Profile"
                  >
                    <UserCog className="h-3.5 w-3.5 text-primary" />
                    <span className="hidden sm:inline">CRM</span>
                  </Button>

                  {/* Resolve / Reopen Lifecycle Button */}
                  <Button
                    variant={isSelectedConvoResolved ? 'default' : 'outline'}
                    size="sm"
                    disabled={isResolving}
                    className="h-8 text-xs gap-1.5 px-2.5"
                    onClick={() => handleToggleResolve(selectedConversation.id, !isSelectedConvoResolved)}
                  >
                    {isResolving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isSelectedConvoResolved ? (
                      <RotateCcw className="h-3.5 w-3.5" />
                    ) : (
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <span>{isSelectedConvoResolved ? 'Reopen' : 'Resolve'}</span>
                  </Button>

                  {/* Team Member Assignment Selector */}
                  <Select
                    disabled={isAssigningMember}
                    value={selectedConversation.assignedUserId || 'unassigned'}
                    onValueChange={(val) => handleAssignTeamMember(selectedConversation.id, val)}
                  >
                    <SelectTrigger className="h-8 text-xs w-[120px] sm:w-[145px] bg-background">
                      <UserCheck className="h-3.5 w-3.5 mr-1 text-muted-foreground shrink-0" />
                      <SelectValue placeholder="Assign Agent" />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="unassigned" className="text-xs">
                        <span className="text-muted-foreground">Unassigned Queue</span>
                      </SelectItem>
                      {teamMembers.map(member => (
                        <SelectItem key={member.id} value={member.id} className="text-xs">
                          {member.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Manual Takeover Switch */}
                  <div className="flex items-center gap-1.5 pl-1.5 border-l">
                    <Switch
                      id="live-takeover-toggle"
                      checked={isSelectedConvoPaused}
                      disabled={isTogglingTakeover}
                      onCheckedChange={(checked) =>
                        handleToggleTakeover(selectedConversation.id, checked ? 'human' : 'ai')
                      }
                    />
                    <label
                      htmlFor="live-takeover-toggle"
                      className={cn(
                        'text-xs font-medium cursor-pointer select-none hidden lg:inline-block',
                        isSelectedConvoPaused
                          ? 'text-amber-600 dark:text-amber-400 font-semibold'
                          : 'text-emerald-600 dark:text-emerald-400 font-semibold'
                      )}
                    >
                      {isSelectedConvoPaused ? 'Takeover' : 'Auto AI'}
                    </label>
                  </div>
                </div>
              </div>

              {/* Live Escalation Banner */}
              {isSelectedConvoPaused && !isSelectedConvoResolved && (
                <div className="bg-amber-500/10 border-t border-amber-500/20 px-3 py-1.5 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300">
                  <div className="flex items-center gap-1.5 truncate">
                    <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="font-semibold shrink-0">Live Takeover Active:</span>
                    <span className="truncate opacity-90">
                      {selectedConversation.handoffReason || 'AI auto-reply is paused for this customer.'}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] px-2 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 shrink-0 ml-2"
                    onClick={() => handleToggleTakeover(selectedConversation.id, 'ai')}
                  >
                    Resume Bot
                  </Button>
                </div>
              )}

              {/* AI Resolution Summary Banner */}
              {selectedConversation.aiSummary && isSelectedConvoResolved && (
                <div className="bg-primary/5 border-t border-primary/20 px-3.5 py-2 text-xs text-foreground space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-primary text-[11px]">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>AI Resolution Summary</span>
                  </div>
                  <div className="whitespace-pre-line text-muted-foreground text-[11px] leading-relaxed pl-5">
                    {selectedConversation.aiSummary}
                  </div>
                </div>
              )}

              {/* Resolved Status Banner */}
              {isSelectedConvoResolved && (
                <div className="bg-slate-500/10 border-t border-slate-500/20 px-3 py-1.5 flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
                  <div className="flex items-center gap-1.5 truncate">
                    <CheckCircle className="h-4 w-4 text-slate-500 shrink-0" />
                    <span>This conversation is marked as <strong>Resolved</strong>. Sending a message will reopen it.</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] px-2 hover:bg-slate-500/20 shrink-0 ml-2"
                    onClick={() => handleToggleResolve(selectedConversation.id, false)}
                  >
                    Reopen Chat
                  </Button>
                </div>
              )}
            </header>

            {/* Message & Internal Notes Timeline */}
            <ScrollArea className="flex-1 bg-background/50 p-4" ref={scrollAreaRef}>
              {isLoading.messages ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : timelineItems.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-muted-foreground p-8 text-center space-y-2">
                  <Bot className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm">No messages yet in this conversation.</p>
                  <p className="text-xs opacity-75">Send a message below or add an internal team note.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {timelineItems.map((item, idx) => {
                    if (item.type === 'note') {
                      const note = item.data;
                      return (
                        <div
                          key={`note_${note.id}_${idx}`}
                          className="mx-auto max-w-xl my-2 p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100 shadow-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white text-[10px]">
                                <Lock className="h-3 w-3" />
                              </span>
                              <span className="font-semibold text-xs text-amber-900 dark:text-amber-200">
                                {note.userName} (Internal Note)
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-amber-700 dark:text-amber-400">
                                {format(new Date(note.createdAt), 'p, MMM d')}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-amber-700 hover:text-destructive hover:bg-amber-500/20"
                                onClick={() => handleDeleteNote(note.id)}
                                title="Delete note"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <p className="text-xs leading-relaxed whitespace-pre-wrap pl-7 text-amber-900/90 dark:text-amber-100/90 font-sans">
                            {note.content}
                          </p>
                        </div>
                      );
                    }

                    const msg = item.data;
                    const isOutbound = msg.fromMe;
                    const senderDisplayName = formatContactName(
                      msg.senderName && msg.senderName.toLowerCase() !== 'me' && msg.senderName.toLowerCase() !== 'system'
                        ? msg.senderName
                        : selectedConversation.name,
                      selectedConversation.id
                    );

                    const isFailed = failedMessageIds.has(msg.id);

                    return (
                      <div
                        key={`msg_${msg.id}_${idx}`}
                        className={cn('flex items-end gap-2', isOutbound ? 'justify-end' : 'justify-start')}
                      >
                        {!isOutbound && (
                          <Avatar className="h-7 w-7 border shrink-0 bg-muted/40 mb-1">
                            <AvatarImage src={selectedConversation.avatar} alt={senderDisplayName} />
                            <AvatarFallback className="text-[10px] font-semibold text-primary bg-primary/10">
                              {getAvatarInitials(msg.senderName || selectedConversation.name, selectedConversation.id)}
                            </AvatarFallback>
                          </Avatar>
                        )}

                        <div className="space-y-1 max-w-xs md:max-w-md lg:max-w-lg">
                          {!isOutbound && (
                            <div className="text-[11px] font-medium text-muted-foreground pl-1">
                              {senderDisplayName}
                            </div>
                          )}
                          <div
                            className={cn(
                              'rounded-2xl px-4 py-2.5 shadow-xs text-sm space-y-1',
                              isFailed
                                ? 'bg-destructive/10 border border-destructive/30 text-foreground rounded-br-xs'
                                : isOutbound
                                ? 'bg-primary text-primary-foreground rounded-br-xs'
                                : 'border bg-card text-card-foreground rounded-bl-xs'
                            )}
                          >
                            <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                            <div
                              className={cn(
                                'flex items-center justify-end gap-1.5 text-[10px]',
                                isFailed
                                  ? 'text-destructive'
                                  : isOutbound
                                  ? 'text-primary-foreground opacity-70'
                                  : 'text-muted-foreground opacity-70'
                              )}
                            >
                              <span>{format(new Date(msg.timestamp), 'p')}</span>
                              {isFailed ? (
                                <button
                                  type="button"
                                  onClick={() => retryFailedMessage(msg)}
                                  className="flex items-center gap-1 font-medium bg-destructive text-destructive-foreground px-2 py-0.5 rounded-full hover:bg-destructive/90 transition-colors cursor-pointer"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  <span>Retry</span>
                                </button>
                              ) : (
                                isOutbound && <CheckCircle2 className="h-3 w-3 inline" />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            {/* Message Composer Footer with Mode Switch & Slash Autocomplete */}
            <footer
              className={cn(
                'relative shrink-0 border-t p-3 transition-colors',
                composerMode === 'note'
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-card'
              )}
            >
              {/* Slash Command Autocomplete Popover */}
              {isSlashActive && matchingCannedResponses.length > 0 && (
                <div className="absolute bottom-full left-3 right-3 mb-2 rounded-xl border bg-popover shadow-lg overflow-hidden z-20 max-h-56 overflow-y-auto">
                  <div className="p-2 border-b bg-muted/30 text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                    <span>⚡ Quick Replies (Press Tab or Enter to select)</span>
                    <span>{matchingCannedResponses.length} matches</span>
                  </div>
                  <div className="p-1 space-y-0.5">
                    {matchingCannedResponses.map((item, idx) => (
                      <div
                        key={item.id}
                        onClick={() => insertCannedSnippet(item.content)}
                        className={cn(
                          'flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-colors',
                          idx === selectedCannedIndex ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px] font-bold text-foreground">
                            /{item.shortcut}
                          </code>
                          <span className="truncate">{item.title}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground truncate max-w-[200px] ml-2">
                          {item.content.slice(0, 45)}...
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Mode Toggle Header inside footer */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border">
                  <Button
                    type="button"
                    variant={composerMode === 'message' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-6 text-[11px] px-2.5 gap-1"
                    onClick={() => setComposerMode('message')}
                  >
                    <MessageSquare className="h-3 w-3" />
                    <span>WhatsApp Reply</span>
                  </Button>
                  <Button
                    type="button"
                    variant={composerMode === 'note' ? 'default' : 'ghost'}
                    size="sm"
                    className={cn(
                      'h-6 text-[11px] px-2.5 gap-1',
                      composerMode === 'note' && 'bg-amber-500 hover:bg-amber-600 text-white'
                    )}
                    onClick={() => setComposerMode('note')}
                  >
                    <Lock className="h-3 w-3" />
                    <span>Internal Note</span>
                  </Button>
                </div>

                {composerMode === 'note' && (
                  <span className="text-[11px] text-amber-700 dark:text-amber-300 font-medium flex items-center gap-1">
                    <StickyNote className="h-3 w-3" />
                    <span>Private note (only visible to team)</span>
                  </span>
                )}
              </div>

              <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                {/* Quick Replies Dialog Trigger (Message Mode only) */}
                {composerMode === 'message' && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={() => setIsCannedDialogOpen(true)}
                      className="h-9 w-9 text-muted-foreground hover:text-primary"
                      title="Browse Quick Replies"
                    >
                      <MessageSquareQuote className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" type="button" className="h-9 w-9 text-muted-foreground">
                      <Paperclip className="h-4 w-4" />
                    </Button>
                  </>
                )}

                <Input
                  ref={inputRef}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyDownInComposer}
                  placeholder={
                    composerMode === 'note'
                      ? 'Add an internal team note (press Enter to save)...'
                      : isSelectedConvoPaused
                      ? 'Reply directly to customer (type / for quick replies)...'
                      : 'Type WhatsApp reply (type / for quick replies)...'
                  }
                  className={cn(
                    'flex-1 h-9 text-sm',
                    composerMode === 'note'
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500/40 text-amber-950 dark:text-amber-100 placeholder:text-amber-700/60 dark:placeholder:text-amber-300/60'
                      : 'bg-background'
                  )}
                />

                <Button
                  type="submit"
                  size="icon"
                  className={cn(
                    'h-9 w-9',
                    composerMode === 'note' && 'bg-amber-500 hover:bg-amber-600 text-white'
                  )}
                  disabled={!newMessage.trim()}
                >
                  {composerMode === 'note' ? <StickyNote className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                </Button>
              </form>
            </footer>
          </>
        ) : (
          <div className="hidden flex-1 items-center justify-center text-muted-foreground md:flex flex-col space-y-3 p-8">
            <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center">
              <Bot className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <h3 className="font-semibold text-foreground">Select a conversation</h3>
            <p className="text-sm max-w-sm text-center">
              Choose a conversation from the sidebar to view chat history, manage live takeover, or post internal team notes.
            </p>
          </div>
        )}
      </main>

      {/* Quick Replies Modal Browser */}
      <Dialog open={isCannedDialogOpen} onOpenChange={setIsCannedDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-headline">
              <MessageSquareQuote className="h-5 w-5 text-primary" />
              <span>Insert Quick Reply</span>
            </DialogTitle>
            <DialogDescription>
              Select a pre-written canned response to instantly insert into your reply.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={cannedFilterText}
                onChange={(e) => setCannedFilterText(e.target.value)}
                placeholder="Search snippets..."
                className="pl-9 h-9 text-sm"
              />
            </div>

            <ScrollArea className="h-64 border rounded-lg p-2">
              <div className="space-y-2">
                {cannedResponses
                  .filter(
                    c =>
                      c.title.toLowerCase().includes(cannedFilterText.toLowerCase()) ||
                      c.shortcut.toLowerCase().includes(cannedFilterText.toLowerCase()) ||
                      c.content.toLowerCase().includes(cannedFilterText.toLowerCase())
                  )
                  .map((item) => (
                    <div
                      key={item.id}
                      onClick={() => insertCannedSnippet(item.content)}
                      className="p-3 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer transition-colors space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs">{item.title}</span>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          /{item.shortcut}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{item.content}</p>
                    </div>
                  ))}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {/* Contact CRM Profile Drawer */}
      <ContactProfileDrawer
        chatId={selectedConversationId}
        isOpen={isProfileDrawerOpen}
        onClose={() => setIsProfileDrawerOpen(false)}
        onProfileUpdated={() => {
          fetchConversations();
        }}
      />
    </div>
  );
}
