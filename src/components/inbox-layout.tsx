'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
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
  Copy,
  Phone,
  Check,
  Star,
  Plus,
  PhoneCall,
  UserPlus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { formatContactName, formatChatSubtitle, getAvatarInitials, getContactIdentifier, formatPhoneNumber } from '@/lib/format-utils';
import ContactProfileDrawer from '@/components/contact-profile-drawer';
import ConfirmDeleteDialog from '@/components/confirm-delete-dialog';
import { Conversation, Message, TeamMember, CannedResponse, ConversationNote, isConversationPaused, LeadStage } from '@/types';
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
  const searchParams = useSearchParams();

  useEffect(() => {
    const chatParam = searchParams.get('chat');
    if (chatParam) {
      setSelectedConversationId(decodeURIComponent(chatParam));
    }
  }, [searchParams]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<
    'open' | 'starred' | 'handoff' | 'my_chats' | 'unassigned' | 'unread' | 'bot_active' | 'human_takeover' | 'resolved' | 'churned' | 'all'
  >('open');
  const [isCopiedPhone, setIsCopiedPhone] = useState(false);
  const [isBriefingExpanded, setIsBriefingExpanded] = useState(true);

  // New Chat Dialog State
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatName, setNewChatName] = useState('');
  const [newChatInitialMsg, setNewChatInitialMsg] = useState('');
  const [newChatResolutionMode, setNewChatResolutionMode] = useState<'ai' | 'human'>('ai');
  const [newChatStage, setNewChatStage] = useState<LeadStage>('lead');
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);

  const isHandoffConversation = (c: Conversation) => {
    return (
      c.status !== 'resolved' &&
      (Boolean(c.isBotPaused) ||
        isConversationPaused(c) ||
        Boolean(c.handoffReason) ||
        Boolean(c.takeoverReason) ||
        c.status === 'pending')
    );
  };

  const starredConvosCount = useMemo(
    () => conversations.filter((c) => !!c.isStarred && c.status !== 'resolved').length,
    [conversations]
  );
  const handoffConvosCount = useMemo(
    () => conversations.filter(isHandoffConversation).length,
    [conversations]
  );
  const openConvosCount = useMemo(
    () => conversations.filter((c) => c.status !== 'resolved').length,
    [conversations]
  );
  const botActiveConvosCount = useMemo(
    () => conversations.filter((c) => !isHandoffConversation(c) && c.status !== 'resolved').length,
    [conversations]
  );
  const resolvedConvosCount = useMemo(
    () => conversations.filter((c) => c.status === 'resolved').length,
    [conversations]
  );
  const churnedConvosCount = useMemo(
    () => conversations.filter((c) => c.stage === 'churned').length,
    [conversations]
  );

  const handleCopyPhone = (phone: string) => {
    if (!phone) return;
    navigator.clipboard.writeText(phone);
    setIsCopiedPhone(true);
    toast({ title: 'Phone Number Copied 📋', description: phone });
    setTimeout(() => setIsCopiedPhone(false), 2000);
  };

  // Toggle Favorite / Starred Conversation
  const handleToggleStar = async (chatId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const currentConvo = conversations.find(c => c.id === chatId);
    const nextStarred = !currentConvo?.isStarred;

    setConversations(prev =>
      prev.map(c => c.id === chatId ? { ...c, isStarred: nextStarred } : c)
    );

    try {
      const res = await fetch('/api/inbox/star', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, isStarred: nextStarred }),
      });

      if (!res.ok) throw new Error('Failed to update star status');

      toast({
        title: nextStarred ? 'Conversation Starred ⭐' : 'Conversation Unstarred',
        description: nextStarred
          ? `Added ${currentConvo?.name || chatId} to your favorite starred list.`
          : `Removed ${currentConvo?.name || chatId} from favorites.`,
      });
    } catch (err: any) {
      setConversations(prev =>
        prev.map(c => c.id === chatId ? { ...c, isStarred: !nextStarred } : c)
      );
      toast({
        variant: 'destructive',
        title: 'Action Failed',
        description: err.message,
      });
    }
  };

  // Update Lifecycle Stage directly from Inbox
  const handleUpdateStage = async (chatId: string, newStage: LeadStage) => {
    const currentConvo = conversations.find(c => c.id === chatId);
    const prevStage = currentConvo?.stage;

    setConversations(prev =>
      prev.map(c => c.id === chatId ? { ...c, stage: newStage } : c)
    );

    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(chatId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      });

      if (!res.ok) throw new Error('Failed to update stage');

      toast({
        title: 'Lifecycle Stage Updated',
        description: `${currentConvo?.name || 'Customer'} moved to ${newStage.toUpperCase()}.`,
      });
    } catch (err: any) {
      setConversations(prev =>
        prev.map(c => c.id === chatId ? { ...c, stage: prevStage } : c)
      );
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: err.message,
      });
    }
  };

  // Create New Conversation & Hand Off
  const handleCreateNewChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatPhone.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please enter a phone number.' });
      return;
    }

    setIsCreatingChat(true);
    try {
      const digitsOnly = newChatPhone.replace(/\D/g, '');
      if (digitsOnly.length < 7) {
        throw new Error('Please enter a valid phone number with country code (e.g. 17868148367).');
      }

      const formattedJid = `${digitsOnly}@s.whatsapp.net`;

      // 1. Create or update contact profile
      await fetch(`/api/contacts/${encodeURIComponent(formattedJid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newChatName.trim() || undefined,
          stage: newChatStage,
          phone: digitsOnly,
        }),
      });

      // 2. Set takeover mode if human
      if (newChatResolutionMode === 'human') {
        await fetch('/api/inbox/takeover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: formattedJid,
            action: 'human',
            reason: 'Manual new chat opened in operator mode',
          }),
        });
      }

      // 3. Send initial message if provided
      if (newChatInitialMsg.trim()) {
        await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: formattedJid,
            text: newChatInitialMsg.trim(),
          }),
        });
      }

      toast({
        title: 'New Conversation Started 🎉',
        description: newChatResolutionMode === 'ai'
          ? `Handed off to Auto AI for customer ${newChatName || digitsOnly}.`
          : `Opened in Operator mode for customer ${newChatName || digitsOnly}.`,
      });

      setIsNewChatOpen(false);
      setNewChatPhone('');
      setNewChatName('');
      setNewChatInitialMsg('');
      await fetchConversations();
      setSelectedConversationId(formattedJid);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Create Chat Failed',
        description: err.message,
      });
    } finally {
      setIsCreatingChat(false);
    }
  };

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
    const q = searchQuery.toLowerCase().trim();
    return conversations.filter(c => {
      const ident = getContactIdentifier(c.name, c.id, c.company);
      const matchesSearch =
        !q ||
        ident.displayName.toLowerCase().includes(q) ||
        ident.phoneNumber.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.lastMessage?.text && c.lastMessage.text.toLowerCase().includes(q)) ||
        (c.company && c.company.toLowerCase().includes(q));

      const isResolved = c.status === 'resolved';

      let matchesFilter = true;
      if (filterMode === 'starred') {
        matchesFilter = Boolean(c.isStarred) && !isResolved;
      } else if (filterMode === 'handoff') {
        matchesFilter = isHandoffConversation(c);
      } else if (filterMode === 'open') {
        matchesFilter = !isResolved;
      } else if (filterMode === 'my_chats') {
        const myId = teamMembers[0]?.id;
        matchesFilter = c.assignedUserId === myId && !isResolved;
      } else if (filterMode === 'unassigned') {
        matchesFilter = (!c.assignedUserId || c.assignedUserId === 'unassigned') && !isResolved;
      } else if (filterMode === 'unread') {
        matchesFilter = c.unreadCount > 0;
      } else if (filterMode === 'bot_active') {
        matchesFilter = !isHandoffConversation(c) && !isResolved;
      } else if (filterMode === 'human_takeover') {
        matchesFilter = isHandoffConversation(c);
      } else if (filterMode === 'resolved') {
        matchesFilter = isResolved;
      } else if (filterMode === 'churned') {
        matchesFilter = c.stage === 'churned';
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

  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);

  const confirmDeleteNote = async () => {
    if (!noteToDelete) return;
    try {
      const res = await fetch(`/api/inbox/notes/${noteToDelete}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete note');
      setNotes(prev => prev.filter(n => n.id !== noteToDelete));
      toast({ title: 'Note Deleted', description: 'Internal team note was permanently removed.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: (err as Error).message });
    } finally {
      setNoteToDelete(null);
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

  const totalUnreadConvos = conversations.reduce((acc, c) => acc + (c.unreadCount > 0 ? 1 : 0), 0);

  return (
    <div className="relative flex h-full w-full rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Sidebar: Conversation List */}
      <aside
        className={cn(
          'w-full transition-transform duration-300 ease-in-out md:w-1/3 md:border-r md:translate-x-0 flex flex-col',
          selectedConversationId && '-translate-x-full'
        )}
      >
        <div className="border-b p-3 space-y-2.5 bg-muted/20">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="font-headline text-base font-bold flex items-center gap-2 tracking-tight">
                <span>Inbox</span>
                <Badge variant="secondary" className="text-xs px-2 py-0.5 font-semibold">
                  {filteredConversations.length}
                </Badge>
              </h2>
              <span className="flex items-center gap-1 text-[11px] text-emerald-500 font-medium bg-emerald-500/10 px-1.5 py-0.5 rounded-full border border-emerald-500/20">
                <Radio className="h-2.5 w-2.5 animate-pulse" />
                <span>Live</span>
              </span>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs px-2.5 gap-1.5 font-semibold bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer shadow-xs rounded-lg"
                onClick={() => setIsNewChatOpen(true)}
                title="Start a new conversation and hand off to AI or human"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Chat</span>
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer rounded-lg"
                onClick={() => setSoundEnabled(p => !p)}
                title={soundEnabled ? 'Notification chime on' : 'Notification chime muted'}
              >
                {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5 opacity-50" />}
              </Button>

              <Select value={filterMode} onValueChange={(val: any) => setFilterMode(val)}>
                <SelectTrigger className="h-7 text-xs px-2.5 w-[125px] bg-background cursor-pointer rounded-lg border-border/80">
                  <Filter className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="open" className="text-xs">Active / Open ({openConvosCount})</SelectItem>
                  <SelectItem value="starred" className="text-xs font-semibold text-amber-500">⭐ Starred ({starredConvosCount})</SelectItem>
                  <SelectItem value="handoff" className="text-xs font-semibold text-amber-500">🚨 Handoff ({handoffConvosCount})</SelectItem>
                  <SelectItem value="bot_active" className="text-xs">🤖 Bot Active ({botActiveConvosCount})</SelectItem>
                  <SelectItem value="my_chats" className="text-xs">👤 My Assigned Chats</SelectItem>
                  <SelectItem value="unassigned" className="text-xs">📥 Unassigned Queue</SelectItem>
                  <SelectItem value="unread" className="text-xs">🔴 Unread</SelectItem>
                  <SelectItem value="resolved" className="text-xs">✅ Resolved ({resolvedConvosCount})</SelectItem>
                  <SelectItem value="churned" className="text-xs font-semibold text-rose-500">⚠️ Churned ({churnedConvosCount})</SelectItem>
                  <SelectItem value="all" className="text-xs">All Chats</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search contacts or numbers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-xs pl-8 bg-background rounded-lg border-border/80"
            />
          </div>

          {/* Quick Filter Section: All, Starred, Handoff, Auto AI, Resolved, Churned */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 pt-0.5 no-scrollbar">
            <button
              type="button"
              onClick={() => setFilterMode('open')}
              className={cn(
                'text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 border',
                filterMode === 'open'
                  ? 'bg-primary text-primary-foreground font-bold border-primary shadow-xs'
                  : 'bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted'
              )}
            >
              <span>All</span>
              <span className="text-[10px] opacity-80">({openConvosCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setFilterMode('starred')}
              className={cn(
                'text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 border',
                filterMode === 'starred'
                  ? 'bg-amber-500 text-slate-950 font-bold border-amber-400 shadow-xs'
                  : starredConvosCount > 0
                  ? 'bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20'
                  : 'bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted'
              )}
            >
              <span>⭐ Starred</span>
              <span className={cn(
                'text-[10px] px-1.5 py-0.2 rounded-full font-bold',
                starredConvosCount > 0 && filterMode !== 'starred' ? 'bg-amber-500 text-slate-950' : 'opacity-80'
              )}>
                {starredConvosCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilterMode('handoff')}
              className={cn(
                'text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 border',
                filterMode === 'handoff'
                  ? 'bg-amber-500 text-slate-950 font-bold border-amber-400 shadow-xs'
                  : handoffConvosCount > 0
                  ? 'bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20'
                  : 'bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted'
              )}
            >
              <span>🚨 Handoff</span>
              <span className={cn(
                'text-[10px] px-1.5 py-0.2 rounded-full font-bold',
                handoffConvosCount > 0 && filterMode !== 'handoff' ? 'bg-amber-500 text-slate-950' : 'opacity-80'
              )}>
                {handoffConvosCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilterMode('bot_active')}
              className={cn(
                'text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 border',
                filterMode === 'bot_active'
                  ? 'bg-emerald-600 text-white font-bold border-emerald-500 shadow-xs'
                  : 'bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted'
              )}
            >
              <span>🤖 Auto AI</span>
              <span className="text-[10px] opacity-80">({botActiveConvosCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setFilterMode('resolved')}
              className={cn(
                'text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 border',
                filterMode === 'resolved'
                  ? 'bg-slate-700 text-white font-bold border-slate-600 shadow-xs'
                  : 'bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted'
              )}
            >
              <span>✓ Resolved</span>
              <span className="text-[10px] opacity-80">({resolvedConvosCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setFilterMode('churned')}
              className={cn(
                'text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 border',
                filterMode === 'churned'
                  ? 'bg-rose-500 text-white font-bold border-rose-400 shadow-xs'
                  : churnedConvosCount > 0
                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/20'
                  : 'bg-muted/50 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted'
              )}
            >
              <span>⚠️ Churned</span>
              <span className={cn(
                'text-[10px] px-1.5 py-0.2 rounded-full font-bold',
                churnedConvosCount > 0 && filterMode !== 'churned' ? 'bg-rose-500 text-white' : 'opacity-80'
              )}>
                {churnedConvosCount}
              </span>
            </button>
          </div>
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
              const ident = getContactIdentifier(convo.name, convo.id, convo.company);
              const displayName = ident.displayName;
              const phoneNumber = ident.phoneNumber;
              const hasCustomName = ident.hasCustomName;
              const avatarInitials = ident.avatarInitials;

              return (
                <div
                  key={`${convo.id}_${idx}`}
                  onClick={() => handleSelectConversation(convo)}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 p-3 transition-colors hover:bg-muted/50 border-b border-border/40',
                    selectedConversationId === convo.id && 'bg-muted/80',
                    isResolved && 'opacity-70 bg-muted/20'
                  )}
                >
                  <div className="relative shrink-0 mt-0.5">
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
                      <p className="font-semibold text-sm truncate text-foreground">{displayName}</p>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <button
                          type="button"
                          onClick={(e) => handleToggleStar(convo.id, e)}
                          className="text-muted-foreground hover:text-amber-400 p-0.5 rounded transition-colors cursor-pointer"
                          title={convo.isStarred ? 'Starred favorite (Click to unstar)' : 'Star conversation as favorite'}
                        >
                          <Star className={cn('h-3.5 w-3.5', convo.isStarred ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30 hover:text-amber-400')} />
                        </button>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {formatTimestamp(convo.lastMessage.timestamp)}
                        </span>
                      </div>
                    </div>

                    {/* Prominent phone number display if the user has a custom name */}
                    {hasCustomName && phoneNumber && (
                      <p className="text-[11px] text-primary/90 font-mono mb-1 truncate flex items-center gap-1 font-medium">
                        <Phone className="w-3 h-3 text-primary/70 shrink-0" />
                        <span>{phoneNumber}</span>
                      </p>
                    )}

                    <p className="truncate text-xs text-muted-foreground mb-1.5">
                      {convo.lastMessage.text || 'No messages yet'}
                    </p>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isResolved ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1 bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
                          ✓ Resolved
                        </span>
                      ) : isPaused || convo.handoffReason ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-1 bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                          🚨 Handoff
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          🤖 AI Active
                        </span>
                      )}

                      {convo.stage && (
                        <span className={cn('text-[9px] px-1.5 py-0 rounded border capitalize font-medium', {
                          'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20': convo.stage === 'lead',
                          'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20': convo.stage === 'prospect',
                          'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20': convo.stage === 'customer',
                          'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-semibold': convo.stage === 'vip',
                          'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20': convo.stage === 'churned',
                        })}>
                          {convo.stage === 'vip' ? '★ VIP' : convo.stage === 'lead' ? '🎯 Lead' : convo.stage === 'prospect' ? '⚡ Prospect' : convo.stage === 'customer' ? '💎 Customer' : convo.stage === 'churned' ? '⚠️ Churned' : convo.stage}
                        </span>
                      )}

                      {member && !isResolved && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border truncate max-w-[100px]">
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

                  {(() => {
                    const ident = getContactIdentifier(selectedConversation.name, selectedConversation.id, selectedConversation.company);
                    return (
                      <>
                        <div className="relative shrink-0">
                          <Avatar className="h-9 w-9 border bg-muted/40 shrink-0">
                            <AvatarImage src={selectedConversation.avatar} alt={ident.displayName} />
                            <AvatarFallback className="font-semibold text-xs text-primary bg-primary/10">
                              {ident.avatarInitials}
                            </AvatarFallback>
                          </Avatar>
                          <span
                            className={cn(
                              'absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full ring-2 ring-background text-[7px]',
                              isSelectedConvoResolved
                                ? 'bg-slate-500 text-white'
                                : isSelectedConvoPaused
                                ? 'bg-amber-500 text-white'
                                : 'bg-emerald-500 text-white'
                            )}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <h3 className="font-headline font-bold text-sm truncate text-foreground">
                              {ident.displayName}
                            </h3>

                            {/* Star Favorite Toggle Button */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 text-muted-foreground hover:text-amber-400 cursor-pointer"
                              onClick={(e) => handleToggleStar(selectedConversation.id, e)}
                              title={selectedConversation.isStarred ? 'Starred favorite (Click to unstar)' : 'Star conversation as favorite'}
                            >
                              <Star className={cn('h-3.5 w-3.5', selectedConversation.isStarred ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30 hover:text-amber-400')} />
                            </Button>

                            {/* Interactive Lifecycle Stage Selector Dropdown */}
                            <Select
                              value={selectedConversation.stage || 'lead'}
                              onValueChange={(val: any) => handleUpdateStage(selectedConversation.id, val)}
                            >
                              <SelectTrigger className={cn(
                                'h-5 text-[10px] px-2 font-semibold border rounded-md shadow-none cursor-pointer',
                                selectedConversation.stage === 'lead' && 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
                                selectedConversation.stage === 'prospect' && 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
                                selectedConversation.stage === 'customer' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
                                selectedConversation.stage === 'vip' && 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-bold',
                                selectedConversation.stage === 'churned' && 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
                              )}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="lead" className="text-xs">🎯 Lead</SelectItem>
                                <SelectItem value="prospect" className="text-xs">⚡ Prospect</SelectItem>
                                <SelectItem value="customer" className="text-xs">💎 Customer</SelectItem>
                                <SelectItem value="vip" className="text-xs font-semibold text-amber-500">★ VIP</SelectItem>
                                <SelectItem value="churned" className="text-xs text-rose-500">⚠️ Churned</SelectItem>
                              </SelectContent>
                            </Select>

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
                            {isSelectedConvoPaused && !isSelectedConvoResolved && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-bold flex items-center gap-1">
                                🚨 Handoff
                              </Badge>
                            )}
                            {isSelectedConvoResolved && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-slate-500/10 text-slate-600 dark:text-slate-400">
                                Resolved
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground truncate">
                            <span className="font-mono flex items-center gap-1 text-muted-foreground">
                              <Phone className="w-3 h-3 text-emerald-500 shrink-0" />
                              <span>{ident.phoneNumber}</span>
                            </span>
                            {selectedConversation.company && (
                              <span>• {selectedConversation.company}</span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleCopyPhone(ident.phoneNumber)}
                              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 px-1.5 py-0.5 rounded border border-border/50 bg-muted/40 hover:bg-muted cursor-pointer ml-1"
                              title="Copy phone number"
                            >
                              {isCopiedPhone ? (
                                <>
                                  <Check className="w-2.5 h-2.5 text-emerald-400" /> <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-2.5 h-2.5" /> <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* Header Action Controls */}
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {/* Contact CRM Profile Drawer Button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5 px-2.5 rounded-lg cursor-pointer"
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
                    className="h-8 text-xs gap-1.5 px-2.5 rounded-lg cursor-pointer"
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
                    <SelectTrigger className="h-8 text-xs w-[130px] sm:w-[150px] bg-background gap-1.5 px-2.5 cursor-pointer rounded-lg">
                      <UserCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <SelectValue placeholder="Assign Agent">
                        <span className="truncate text-xs">
                          {selectedConversation.assignedUserId && selectedConversation.assignedUserId !== 'unassigned'
                            ? (teamMembers.find(m => m.id === selectedConversation.assignedUserId)?.fullName || selectedConversation.assignedUser?.fullName || 'Assigned')
                            : 'Unassigned'}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="unassigned" className="text-xs font-medium">
                        Unassigned Queue
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
                          ? 'text-amber-500 font-bold'
                          : 'text-emerald-500 font-bold'
                      )}
                    >
                      {isSelectedConvoPaused ? 'Takeover' : 'Auto AI'}
                    </label>
                  </div>
                </div>
              </div>

              {/* Live Escalation Banner with Collapsible AI Catch-Up Briefing */}
              {isSelectedConvoPaused && !isSelectedConvoResolved && (
                <div className="bg-amber-500/10 border-t border-b border-amber-500/20 text-xs text-amber-900 dark:text-amber-200 transition-all">
                  <div className="px-3.5 py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0 animate-pulse" />
                      <span className="font-bold text-amber-600 dark:text-amber-400 shrink-0">Live Takeover Active:</span>
                      <span className="truncate opacity-90 text-[11px] text-foreground">
                        {selectedConversation.handoffReason || 'AI auto-reply is paused for this customer.'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {(selectedConversation.handoffMetadata?.takeoverBriefing || selectedConversation.takeoverBriefing) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[11px] px-2 gap-1 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 cursor-pointer font-medium rounded-md"
                          onClick={() => setIsBriefingExpanded(p => !p)}
                        >
                          <Sparkles className="h-3 w-3 text-amber-500" />
                          <span>{isBriefingExpanded ? 'Hide Brief' : 'AI Brief'}</span>
                          <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', isBriefingExpanded && 'rotate-180')} />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[11px] px-2.5 bg-amber-500 text-slate-950 font-bold border-amber-400 hover:bg-amber-400 cursor-pointer shadow-xs rounded-md"
                        onClick={() => handleToggleTakeover(selectedConversation.id, 'ai')}
                      >
                        Resume Bot
                      </Button>
                    </div>
                  </div>

                  {/* AI Catch-Up Briefing Card (Collapsible) */}
                  {isBriefingExpanded && (selectedConversation.handoffMetadata?.takeoverBriefing || selectedConversation.takeoverBriefing) && (
                    <div className="px-3.5 pb-2.5 pt-0">
                      <div className="bg-background/90 border border-amber-500/30 rounded-lg p-2.5 space-y-1.5 text-[11px] text-foreground shadow-xs">
                        <div className="flex items-center justify-between pb-1 border-b border-border/50">
                          <div className="flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400">
                            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                            <span>AI Hand-Off Catch-Up Briefing</span>
                          </div>
                          {(selectedConversation.handoffMetadata?.takeoverBriefing?.customerFrustration || selectedConversation.takeoverBriefing?.customerFrustration) && (
                            <Badge
                              variant="outline"
                              className={cn('text-[9px] px-1.5 py-0 uppercase font-bold', {
                                'bg-rose-500/10 text-rose-600 border-rose-500/30': (selectedConversation.handoffMetadata?.takeoverBriefing?.customerFrustration || selectedConversation.takeoverBriefing?.customerFrustration) === 'high',
                                'bg-amber-500/10 text-amber-600 border-amber-500/30': (selectedConversation.handoffMetadata?.takeoverBriefing?.customerFrustration || selectedConversation.takeoverBriefing?.customerFrustration) === 'medium',
                                'bg-emerald-500/10 text-emerald-600 border-emerald-500/30': (selectedConversation.handoffMetadata?.takeoverBriefing?.customerFrustration || selectedConversation.takeoverBriefing?.customerFrustration) === 'low',
                              })}
                            >
                              Frustration: {selectedConversation.handoffMetadata?.takeoverBriefing?.customerFrustration || selectedConversation.takeoverBriefing?.customerFrustration}
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground leading-relaxed">
                          <strong className="text-foreground">Issue:</strong>{' '}
                          {selectedConversation.handoffMetadata?.takeoverBriefing?.keyIssue || selectedConversation.takeoverBriefing?.keyIssue}
                        </p>
                        <p className="text-muted-foreground leading-relaxed">
                          <strong className="text-foreground">Bot Attempted:</strong>{' '}
                          {selectedConversation.handoffMetadata?.takeoverBriefing?.botAttemptsSummary || selectedConversation.takeoverBriefing?.botAttemptsSummary}
                        </p>
                        <p className="text-emerald-600 dark:text-emerald-400 font-medium leading-relaxed bg-emerald-500/5 px-2 py-1 rounded border border-emerald-500/15">
                          <strong>Recommended Next Step:</strong>{' '}
                          {selectedConversation.handoffMetadata?.takeoverBriefing?.recommendedNextAction || selectedConversation.takeoverBriefing?.recommendedNextAction}
                        </p>
                      </div>
                    </div>
                  )}
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
                                onClick={() => setNoteToDelete(note.id)}
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
                    const prevItem = idx > 0 ? timelineItems[idx - 1] : null;
                    const isSameSenderAsPrev = Boolean(
                      prevItem &&
                      prevItem.type === 'message' &&
                      prevItem.data.fromMe === msg.fromMe &&
                      Math.abs(msg.timestamp - prevItem.timestamp) < 3 * 60 * 1000
                    );

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
                        className={cn(
                          'flex items-end gap-2',
                          isOutbound ? 'justify-end' : 'justify-start',
                          isSameSenderAsPrev ? 'mt-1' : 'mt-3'
                        )}
                      >
                        {!isOutbound && (
                          !isSameSenderAsPrev ? (
                            <Avatar className="h-7 w-7 border shrink-0 bg-muted/40 mb-1">
                              <AvatarImage src={selectedConversation.avatar} alt={senderDisplayName} />
                              <AvatarFallback className="text-[10px] font-semibold text-primary bg-primary/10">
                                {getAvatarInitials(msg.senderName || selectedConversation.name, selectedConversation.id)}
                              </AvatarFallback>
                            </Avatar>
                          ) : (
                            <div className="w-7 shrink-0" />
                          )
                        )}

                        <div className="space-y-1 max-w-xs md:max-w-md lg:max-w-lg">
                          {!isOutbound && !isSameSenderAsPrev && (
                            <div className="text-[11px] font-medium text-muted-foreground pl-1">
                              {senderDisplayName}
                            </div>
                          )}
                          <div
                            className={cn(
                              'rounded-2xl px-4 py-2 shadow-xs text-sm space-y-1',
                              isFailed
                                ? 'bg-destructive/10 border border-destructive/30 text-foreground rounded-br-xs'
                                : isOutbound
                                ? 'bg-primary text-primary-foreground rounded-br-xs font-normal'
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
                                  ? 'text-primary-foreground opacity-80'
                                  : 'text-muted-foreground opacity-80'
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

      {/* Start New Conversation Modal */}
      <Dialog open={isNewChatOpen} onOpenChange={setIsNewChatOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <form onSubmit={handleCreateNewChat}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-headline">
                <Plus className="h-5 w-5 text-primary" />
                <span>Start New Conversation</span>
              </DialogTitle>
              <DialogDescription>
                Initiate a new WhatsApp thread, assign an initial customer lifecycle stage, and optionally hand off directly to Auto AI to resolve.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Phone Number / WhatsApp JID <span className="text-rose-500">*</span>
                  </label>
                  <Input
                    value={newChatPhone}
                    onChange={(e) => setNewChatPhone(e.target.value)}
                    placeholder="+1 786 814 8367"
                    required
                    className="h-9 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">With country code (e.g. 17868148367)</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Contact Full Name (Optional)
                  </label>
                  <Input
                    value={newChatName}
                    onChange={(e) => setNewChatName(e.target.value)}
                    placeholder="e.g. Sarah Connor"
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Resolution Mode
                  </label>
                  <Select
                    value={newChatResolutionMode}
                    onValueChange={(val: 'ai' | 'human') => setNewChatResolutionMode(val)}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ai" className="text-xs">
                        🤖 Auto AI (Autonomous Bot)
                      </SelectItem>
                      <SelectItem value="human" className="text-xs">
                        👤 Human Operator Takeover
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    {newChatResolutionMode === 'ai'
                      ? 'AI will automatically process and respond to messages'
                      : 'Bot will be paused; you will reply manually'}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Lifecycle Stage
                  </label>
                  <Select
                    value={newChatStage}
                    onValueChange={(val: any) => setNewChatStage(val)}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lead" className="text-xs">🎯 Lead</SelectItem>
                      <SelectItem value="prospect" className="text-xs">⚡ Prospect</SelectItem>
                      <SelectItem value="customer" className="text-xs">💎 Customer</SelectItem>
                      <SelectItem value="vip" className="text-xs font-semibold text-amber-500">★ VIP</SelectItem>
                      <SelectItem value="churned" className="text-xs text-rose-500">⚠️ Churned</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Initial Outbound Message (Optional)
                </label>
                <Input
                  value={newChatInitialMsg}
                  onChange={(e) => setNewChatInitialMsg(e.target.value)}
                  placeholder="Hi! Following up on your inquiry..."
                  className="h-9 text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  If provided, this message will be sent immediately via WhatsApp.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsNewChatOpen(false)}
                disabled={isCreatingChat}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="gap-1.5 font-semibold bg-primary text-primary-foreground"
                disabled={isCreatingChat}
              >
                {isCreatingChat ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>{newChatResolutionMode === 'ai' ? 'Start & Hand Off to AI' : 'Start Conversation'}</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Note Dialog */}
      <ConfirmDeleteDialog
        isOpen={!!noteToDelete}
        onOpenChange={(open) => !open && setNoteToDelete(null)}
        title="Delete Internal Note?"
        description="Are you sure you want to delete this internal team note? This action cannot be undone."
        itemType="note"
        confirmLabel="Yes, Delete"
        cancelLabel="No, Cancel"
        onConfirm={confirmDeleteNote}
      />

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
