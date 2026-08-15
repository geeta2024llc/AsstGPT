'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Sparkles, Loader2 } from 'lucide-react';
import type { Message, WidgetConfig } from '@/types';

export default function StandaloneWidgetPage() {
  const [config, setConfig] = useState<WidgetConfig>({
    title: 'Chat with Support',
    primaryColor: '#6366F1',
    greeting: 'Hi there! 👋 How can we help you today?',
    botAvatar: '🤖',
    botName: 'AI Assistant',
    placeholder: 'Type your message...',
  });

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [sessionToken, setSessionToken] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize or restore session ID from localStorage
  useEffect(() => {
    let currentSession = localStorage.getItem('aiwhisper_widget_session_id');
    if (!currentSession) {
      currentSession = `visitor_${Math.random().toString(36).substring(2, 11)}`;
      localStorage.setItem('aiwhisper_widget_session_id', currentSession);
    }
    setSessionId(currentSession);

    // Fetch widget branding config + signed session token
    fetch(`/api/widget/config?sessionId=${encodeURIComponent(currentSession)}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.title) {
          setConfig(data);
        }
        if (data?.sessionToken) {
          setSessionToken(data.sessionToken);
        }

        // Fetch existing messages once the session token is available
        fetch(`/api/widget/messages?sessionId=${encodeURIComponent(currentSession!)}&token=${encodeURIComponent(data?.sessionToken || '')}`)
          .then(res => res.json())
          .then(msgData => {
            if (Array.isArray(msgData) && msgData.length > 0) {
              setMessages(msgData);
            }
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isSending]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || !sessionId || isSending) return;

    setInputText('');

    // Optimistic visitor message
    const tempVisitorMsg: Message = {
      id: `temp_${Date.now()}`,
      chatId: `${sessionId}@webchat`,
      fromMe: false,
      text,
      timestamp: Date.now(),
      senderName: 'You',
    };

    setMessages(prev => [...prev, tempVisitorMsg]);
    setIsSending(true);

    try {
      const res = await fetch('/api/widget/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          text,
          visitorName: 'Website Visitor',
          token: sessionToken,
        }),
      });

      const data = await res.json();
      if (data.replyMessage) {
        setMessages(prev => [...prev, data.replyMessage]);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100 font-sans antialiased select-none">
      {/* Header */}
      <header
        className="flex items-center justify-between p-3.5 border-b border-white/10 shadow-sm shrink-0"
        style={{
          background: `linear-gradient(135deg, ${config.primaryColor}22 0%, #0f172a 100%)`,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="h-9 w-9 rounded-full flex items-center justify-center text-base font-bold shadow-sm"
            style={{ backgroundColor: config.primaryColor }}
          >
            {config.botAvatar}
          </div>
          <div>
            <h3 className="font-semibold text-sm leading-tight">{config.title}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-slate-400 font-medium">Online & Ready</span>
            </div>
          </div>
        </div>
      </header>

      {/* Message Timeline */}
      <main className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-900/60">
        {/* Welcome Greeting */}
        <div className="flex items-start gap-2.5 max-w-[85%]">
          <div
            className="h-7 w-7 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5"
            style={{ backgroundColor: config.primaryColor }}
          >
            {config.botAvatar}
          </div>
          <div className="p-3 rounded-2xl rounded-tl-sm bg-slate-800/90 border border-white/10 text-xs leading-relaxed shadow-sm">
            <p>{config.greeting}</p>
          </div>
        </div>

        {/* Dynamic Messages */}
        {messages.map((m) => {
          const isMe = !m.fromMe; // from visitor perspective: fromMe === false means visitor sent it
          return (
            <div
              key={m.id}
              className={`flex items-start gap-2 max-w-[85%] ${
                isMe ? 'ml-auto justify-end' : 'mr-auto justify-start'
              }`}
            >
              {!isMe && (
                <div
                  className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] shrink-0 mt-1"
                  style={{ backgroundColor: config.primaryColor }}
                >
                  {config.botAvatar}
                </div>
              )}
              <div
                className={`p-3 rounded-2xl text-xs leading-relaxed break-words shadow-sm ${
                  isMe
                    ? 'rounded-tr-sm text-white'
                    : 'rounded-tl-sm bg-slate-800/90 border border-white/10 text-slate-200'
                }`}
                style={isMe ? { backgroundColor: config.primaryColor } : {}}
              >
                <p>{m.text}</p>
              </div>
            </div>
          );
        })}

        {/* Typing Indicator */}
        {isSending && (
          <div className="flex items-center gap-2 text-xs text-slate-400 italic pl-8">
            <div className="flex gap-1 items-center bg-slate-800/80 px-3 py-1.5 rounded-full border border-white/10">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Composer Footer */}
      <footer className="p-3 border-t border-white/10 bg-slate-950 shrink-0">
        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={config.placeholder || 'Type your message...'}
            disabled={isSending}
            className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isSending}
            className="h-8 w-8 rounded-xl flex items-center justify-center text-white transition-opacity disabled:opacity-40 shadow-sm"
            style={{ backgroundColor: config.primaryColor }}
          >
            {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </form>
        <div className="text-center mt-2">
          <span className="text-[10px] text-slate-500 inline-flex items-center gap-1 font-mono">
            Powered by <strong className="text-slate-400 font-semibold">AIWhisper</strong>
          </span>
        </div>
      </footer>
    </div>
  );
}
