
'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import Image from 'next/image';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, RefreshCw, CheckCircle2, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { format } from 'date-fns';

type Status = 'connecting' | 'connected' | 'disconnected' | 'error';

interface WhatsAppState {
  status: Status;
  qr?: string | null;
  account?: { id: string; name: string } | null;
  lastDisconnect?: { date: string; reason: string } | null;
}

export default function WhatsAppConnectPanel() {
  const [state, setState] = useState<WhatsAppState>({ status: 'connecting' });
  const [message, setMessage] = useState('Checking WhatsApp connection...');
  const [isResetting, setIsResetting] = useState(false);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const checkStatusOnce = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/status', { cache: 'no-store' });
      if (!res.ok) throw new Error('Status check failed');
      const data: WhatsAppState = await res.json();
      setState(data);

      if (data.status === 'connected') {
        setMessage('WhatsApp is linked and active.');
        stopPolling();
      } else if (data.status === 'connecting') {
        setMessage(data.qr ? 'Scan this QR code with the WhatsApp mobile app.' : 'Connecting to WhatsApp, please wait...');
      } else {
        setMessage(data.lastDisconnect?.reason || 'WhatsApp is disconnected. Click Retry or scan a new QR code.');
      }
      return data;
    } catch (error) {
      console.error('Failed to fetch WhatsApp status:', error);
      setState({ status: 'error' });
      setMessage('An error occurred while checking WhatsApp status.');
      return null;
    }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollIntervalRef.current = setInterval(() => {
      checkStatusOnce();
    }, 2000);
  }, [checkStatusOnce, stopPolling]);

  // Safe initialize: checks status first, inits only if disconnected, NEVER forces a logout
  const initializeConnection = useCallback(async () => {
    stopPolling();
    setMessage('Checking existing WhatsApp session...');

    try {
      const initialStatus = await checkStatusOnce();
      if (initialStatus?.status === 'connected') return;

      if (initialStatus?.status === 'disconnected') {
        await fetch('/api/whatsapp/init', { method: 'POST' });
      }

      startPolling();
    } catch (e) {
      setState({ status: 'error' });
      setMessage('Failed to contact server. Please check your network connection.');
      stopPolling();
    }
  }, [checkStatusOnce, startPolling, stopPolling]);

  // Explicit session reset (ONLY when user explicitly clicks "Reset & Generate New QR")
  const forceFreshSession = useCallback(async () => {
    setIsResetting(true);
    stopPolling();
    setState({ status: 'connecting', qr: null });
    setMessage('Resetting session and requesting new QR code...');

    try {
      await fetch('/api/whatsapp/logout', { method: 'POST' });
      await fetch('/api/whatsapp/init', { method: 'POST' });
      startPolling();
    } catch (e) {
      setState({ status: 'error' });
      setMessage('Failed to reset WhatsApp session.');
      stopPolling();
    } finally {
      setIsResetting(false);
    }
  }, [startPolling, stopPolling]);

  useEffect(() => {
    initializeConnection();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showLoading = state.status === 'connecting' && !state.qr;
  const showQR = state.status === 'connecting' && !!state.qr;
  const showConnected = state.status === 'connected';
  const showError = state.status === 'disconnected' || state.status === 'error';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="h-5 w-5" />
          WhatsApp Connection
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {showConnected ? (
          <div className="flex w-full flex-col items-center gap-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-6 text-center sm:flex-row sm:text-left">
            <Avatar className="h-14 w-14 border-2 border-emerald-500/40">
              <AvatarImage
                src={`https://ui-avatars.com/api/?name=${state.account?.name || '?'}&background=10b981&color=fff`}
                alt={state.account?.name || ''}
              />
              <AvatarFallback className="bg-emerald-500/20 text-emerald-400 font-bold">
                {state.account ? state.account.name.charAt(0) : '?'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-1">
              <p className="text-lg font-semibold">{state.account?.name || 'Connected'}</p>
              <p className="text-xs text-muted-foreground font-mono">{state.account?.id?.split(':')[0] || '---'}</p>
              <Badge className="gap-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30" variant="outline">
                <CheckCircle2 className="h-3 w-3" /> Active
              </Badge>
            </div>
            <Button variant="outline" onClick={forceFreshSession} disabled={isResetting}>
              {isResetting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Reconnect a Different Number
            </Button>
          </div>
        ) : (
          <>
            <div className="relative flex h-64 w-64 items-center justify-center rounded-lg bg-white p-4">
              {showLoading && <Loader2 className="h-12 w-12 animate-spin text-primary" />}
              {showQR && (
                <Image src={state.qr!} alt="WhatsApp QR Code" width={256} height={256} priority />
              )}
              {showError && (
                <div className="flex flex-col items-center text-center text-destructive">
                  <AlertCircle className="h-12 w-12" />
                  <p className="mt-4 font-semibold">Disconnected</p>
                </div>
              )}
            </div>
            {showQR && (
              <p className="max-w-sm text-center text-sm text-muted-foreground">
                Open WhatsApp on your phone, go to Settings &gt; Linked Devices, and scan the code.
              </p>
            )}
            {showError && (
              <Alert variant="destructive" className="w-full">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Connection Status</AlertTitle>
                <AlertDescription className="break-words">{message}</AlertDescription>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Button onClick={initializeConnection} className="w-full sm:w-auto">
                    Retry Connection
                  </Button>
                  <Button onClick={forceFreshSession} variant="outline" disabled={isResetting} className="w-full sm:w-auto">
                    {isResetting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Reset & Generate New QR
                  </Button>
                </div>
              </Alert>
            )}
          </>
        )}

        {state.lastDisconnect && !showError && state.status !== 'connected' && (
          <div className="w-full rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            <p>
              <strong>Last Disconnection:</strong> {format(new Date(state.lastDisconnect.date), 'PPp')}
            </p>
            <p className="mt-0.5 truncate">
              <strong>Reason:</strong> {state.lastDisconnect.reason}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
