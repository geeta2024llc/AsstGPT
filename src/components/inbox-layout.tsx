
'use client';

import { useState, useEffect, useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Paperclip, Loader2, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { Conversation, Message } from '@/types';
import { format } from 'date-fns';

export default function InboxLayout() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const [newMessage, setNewMessage] = useState('');
    const [isLoading, setIsLoading] = useState({ convos: true, messages: false });
    const { toast } = useToast();
    const scrollAreaRef = useRef<HTMLDivElement>(null);

    const [searchQuery, setSearchQuery] = useState('');
    const [filterMode, setFilterMode] = useState<'all' | 'unread'>('all');
    const [isTogglingTakeover, setIsTogglingTakeover] = useState(false);

    const selectedConversation = conversations.find(c => c.id === selectedConversationId);

    const filteredConversations = conversations.filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.id.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesFilter = filterMode === 'unread' ? c.unreadCount > 0 : true;
        return matchesSearch && matchesFilter;
    });

    const handleToggleTakeover = async (chatId: string, targetMode: 'human' | 'ai') => {
        setIsTogglingTakeover(true);
        try {
            const res = await fetch('/api/inbox/takeover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId, mode: targetMode }),
            });
            if (!res.ok) throw new Error('Failed to toggle takeover');
            toast({
                title: targetMode === 'human' ? 'Human Takeover Activated' : 'AI Auto-Reply Resumed',
                description: targetMode === 'human' ? 'AI auto-reply paused for this conversation.' : 'AI will now auto-respond to incoming messages.',
            });
            fetchConversations();
        } catch (err) {
            toast({ variant: 'destructive', title: 'Action Failed', description: (err as Error).message });
        } finally {
            setIsTogglingTakeover(false);
        }
    };

    const fetchConversations = async () => {
        try {
            const res = await fetch('/api/inbox/conversations');
            if (!res.ok) throw new Error('Failed to fetch conversations');
            const data: Conversation[] = await res.json();
            setConversations(data);
             if (!selectedConversationId && data.length > 0 && window.innerWidth >= 768) {
                setSelectedConversationId(data[0].id);
            }
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: (error as Error).message });
        } finally {
            setIsLoading(prevState => ({ ...prevState, convos: false }));
        }
    };

    const fetchMessages = async (chatId: string) => {
        setIsLoading(prevState => ({ ...prevState, messages: true }));
        try {
            const res = await fetch(`/api/inbox/messages/${chatId}`);
            if (!res.ok) throw new Error('Failed to fetch messages');
            const data: Message[] = await res.json();
            setMessages(data.sort((a,b) => a.timestamp - b.timestamp));
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: (error as Error).message });
        } finally {
            setIsLoading(prevState => ({ ...prevState, messages: false }));
        }
    };

    useEffect(() => {
        fetchConversations();
        const interval = setInterval(fetchConversations, 5000); // Poll for new convos/messages
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (selectedConversationId) {
            fetchMessages(selectedConversationId);
        } else {
            setMessages([]);
        }
    }, [selectedConversationId]);

    useEffect(() => {
        if(scrollAreaRef.current){
            scrollAreaRef.current.scrollTo(0, scrollAreaRef.current.scrollHeight);
        }
    }, [messages]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMessage.trim() || !selectedConversationId) return;

        const originalMessage = newMessage;
        setNewMessage('');

        try {
            await fetch('/api/whatsapp/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: selectedConversationId, text: originalMessage }),
            });
            // Optimistically add message, will be confirmed by poller
            const optimisticMessage: Message = {
                id: `temp_${Date.now()}`,
                chatId: selectedConversationId,
                fromMe: true,
                text: originalMessage,
                timestamp: Date.now(),
                senderName: 'Me'
            };
            setMessages(prev => [...prev, optimisticMessage]);
        } catch (error) {
            setNewMessage(originalMessage);
            toast({ variant: 'destructive', title: 'Send Failed', description: (error as Error).message });
        }
    };
    
    const formatTimestamp = (ts: number) => {
        const date = new Date(ts);
        const now = new Date();
        if(format(date, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd')) {
            return format(date, 'p');
        }
        if(format(date, 'yyyy') === format(now, 'yyyy')) {
            return format(date, 'MMM d');
        }
        return format(date, 'PP');
    }

    return (
        <div className="relative flex h-[calc(100vh-theme(spacing.36))] rounded-lg border bg-card overflow-hidden">
            <aside className={cn(
                "w-full transition-transform duration-300 ease-in-out md:w-1/3 md:border-r md:translate-x-0",
                selectedConversationId && "-translate-x-full"
            )}>
                <div className="border-b p-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <h2 className="font-headline text-lg font-semibold">Conversations</h2>
                        <select
                            value={filterMode}
                            onChange={(e) => setFilterMode(e.target.value as any)}
                            className="text-xs border rounded px-2 py-1 bg-background text-foreground"
                        >
                            <option value="all">All</option>
                            <option value="unread">Unread</option>
                        </select>
                    </div>
                    <Input
                        placeholder="Search contact..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-8 text-xs"
                    />
                </div>
                <ScrollArea className="h-full">
                    {isLoading.convos ? (
                        <div className="flex items-center justify-center p-8">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : filteredConversations.length === 0 ? (
                        <p className="p-4 text-center text-muted-foreground text-sm">No matching conversations.</p>
                    ) : (
                        filteredConversations.map(convo => (
                            <div key={convo.id} onClick={() => setSelectedConversationId(convo.id)} className={cn("flex cursor-pointer items-center gap-3 p-3 hover:bg-muted/50", selectedConversationId === convo.id && 'bg-muted')}>
                                <Avatar>
                                    <AvatarImage src={convo.avatar} alt={convo.name} />
                                    <AvatarFallback>{convo.name.charAt(0).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1 truncate">
                                    <p className="font-semibold">{convo.name}</p>
                                    <p className="truncate text-sm text-muted-foreground">{convo.lastMessage.text}</p>
                                </div>
                                <div className="text-right text-xs text-muted-foreground">
                                    <p>{formatTimestamp(convo.lastMessage.timestamp)}</p>
                                    {convo.unreadCount > 0 && <span className="mt-1 flex justify-end"><div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{convo.unreadCount}</div></span>}
                                </div>
                            </div>
                        ))
                    )}
                </ScrollArea>
            </aside>
            <main className={cn(
                "absolute top-0 left-0 flex h-full w-full flex-col bg-card transition-transform duration-300 ease-in-out md:static md:w-2/3 md:translate-x-0",
                selectedConversationId ? "translate-x-0" : "translate-x-full",
            )}>
                {selectedConversation ? (
                    <>
                        <header className="flex shrink-0 items-center justify-between border-b p-3">
                            <div className="flex items-center gap-3">
                                <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSelectedConversationId(null)}>
                                    <ArrowLeft className="h-5 w-5" />
                                    <span className="sr-only">Back to conversations</span>
                                </Button>
                                <Avatar>
                                     <AvatarImage src={selectedConversation.avatar} alt={selectedConversation.name} />
                                    <AvatarFallback>{selectedConversation.name.charAt(0).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <h3 className="font-headline font-semibold">{selectedConversation.name}</h3>
                                    <span className={cn(
                                        "text-xs px-2 py-0.5 rounded font-medium",
                                        (selectedConversation.assignedAgentId === null || selectedConversation.assignedAgentId === '')
                                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                                    )}>
                                        {(selectedConversation.assignedAgentId === null || selectedConversation.assignedAgentId === '') ? '👤 Human Takeover' : '🤖 AI Auto-Reply'}
                                    </span>
                                </div>
                            </div>
                            <Button
                                variant={(selectedConversation.assignedAgentId === null || selectedConversation.assignedAgentId === '') ? "default" : "outline"}
                                size="sm"
                                disabled={isTogglingTakeover}
                                onClick={() => handleToggleTakeover(selectedConversation.id, (selectedConversation.assignedAgentId === null || selectedConversation.assignedAgentId === '') ? 'ai' : 'human')}
                            >
                                {(selectedConversation.assignedAgentId === null || selectedConversation.assignedAgentId === '') ? 'Resume AI' : 'Takeover'}
                            </Button>
                        </header>
                        <ScrollArea className="flex-1 bg-background/50 p-4" ref={scrollAreaRef}>
                            {isLoading.messages ? (
                                <div className="flex h-full items-center justify-center">
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {messages.map((msg) => (
                                        <div key={msg.id} className={cn("flex items-end gap-2", msg.fromMe ? 'justify-end' : 'justify-start')}>
                                            {!msg.fromMe && <Avatar className="h-8 w-8"><AvatarImage src={selectedConversation.avatar} alt={selectedConversation.name} /><AvatarFallback>{selectedConversation.name.charAt(0).toUpperCase()}</AvatarFallback></Avatar>}
                                            <div className={cn("max-w-xs rounded-lg px-4 py-2 md:max-w-md lg:max-w-lg", msg.fromMe ? 'bg-primary text-primary-foreground' : 'border bg-card')}>
                                                <p>{msg.text}</p>
                                                <p className="mt-1 text-right text-xs opacity-70">{format(new Date(msg.timestamp), 'p')}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ScrollArea>
                        <footer className="shrink-0 border-t bg-card p-4">
                            <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                                <Button variant="ghost" size="icon" type="button"><Paperclip className="h-5 w-5"/></Button>
                                <Input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type a message..." className="flex-1"/>
                                <Button type="submit" size="icon"><Send className="h-5 w-5"/></Button>
                            </form>
                        </footer>
                    </>
                ) : (
                    <div className="hidden flex-1 items-center justify-center text-muted-foreground md:flex">
                        {isLoading.convos ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : 'Select a conversation to start chatting.'}
                    </div>
                )}
            </main>
        </div>
    )
}
