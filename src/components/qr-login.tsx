
'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type Status = 'connecting' | 'connected' | 'disconnected' | 'error';

export default function QRLogin() {
  const router = useRouter();
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
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
      const data = await res.json();
      
      setStatus(data.status);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('whatsapp-status-changed', { detail: data }));
      }

      if (data.status === 'connected') {
        setMessage('Successfully connected! Redirecting to Dashboard...');
        stopPolling();
        setTimeout(() => router.push('/dashboard'), 600);
        return data;
      } else if (data.status === 'connecting') {
        if (data.qr) {
          setQrCode(data.qr);
          setMessage('Scan this QR code with the WhatsApp mobile app.');
        } else {
          setQrCode(null);
          setMessage('Connecting to WhatsApp, please wait...');
        }
      } else { // disconnected or error
        setQrCode(null);
        setMessage(data.lastDisconnect?.reason || 'WhatsApp is disconnected. Click Retry or scan new QR code.');
      }
      return data;
    } catch (error) {
      console.error('Failed to fetch WhatsApp status:', error);
      setStatus('error');
      setMessage('An error occurred while checking WhatsApp status.');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('whatsapp-status-changed', { detail: { status: 'error' } }));
      }
      return null;
    }
  }, [router, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollIntervalRef.current = setInterval(async () => {
      await checkStatusOnce();
    }, 2000);
  }, [checkStatusOnce, stopPolling]);

  // Safe initialize: checks status first, inits only if disconnected, NEVER forces a logout
  const initializeConnection = useCallback(async () => {
    stopPolling();
    setStatus('connecting');
    setMessage('Checking existing WhatsApp session...');

    try {
      const initialStatus = await checkStatusOnce();
      if (initialStatus?.status === 'connected') {
        return;
      }

      // If disconnected, trigger backend init to load existing saved credentials
      if (initialStatus?.status === 'disconnected') {
        await fetch('/api/whatsapp/init', { method: 'POST' });
      }

      startPolling();
    } catch (e) {
      setStatus('error');
      setMessage('Failed to contact server. Please check your network connection.');
      stopPolling();
    }
  }, [checkStatusOnce, startPolling, stopPolling]);

  // Explicit session reset (ONLY when user explicitly clicks "Reset & Generate New QR")
  const forceFreshSession = useCallback(async () => {
    setIsResetting(true);
    stopPolling();
    setStatus('connecting');
    setMessage('Resetting session and requesting new QR code...');
    setQrCode(null);

    try {
      await fetch('/api/whatsapp/logout', { method: 'POST' });
      await fetch('/api/whatsapp/init', { method: 'POST' });
      startPolling();
    } catch (e) {
      setStatus('error');
      setMessage('Failed to reset WhatsApp session.');
      stopPolling();
    } finally {
      setIsResetting(false);
    }
  }, [startPolling, stopPolling]);

  useEffect(() => {
    initializeConnection();
    return () => {
      stopPolling();
    };
  }, [initializeConnection, stopPolling]);

  const showLoading = status === 'connecting' && !qrCode;
  const showQR = status === 'connecting' && qrCode;
  const showError = status === 'disconnected' || status === 'error';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="mb-8 text-center">
        <h1 className="font-headline text-5xl font-bold text-primary">
          AsstGPT
        </h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Your AI-Powered WhatsApp Hub
        </p>
      </div>
      <Card className="w-full max-w-sm shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="font-headline text-2xl">
            Link your WhatsApp
          </CardTitle>
          <CardDescription className="min-h-[40px] flex items-center justify-center px-4">
              {message}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
            <div className="relative flex h-64 w-64 items-center justify-center rounded-lg bg-white p-4">
              {showLoading && <Loader2 className="h-12 w-12 animate-spin text-primary" />}
              {showQR && (
                <Image
                  src={qrCode!}
                  alt="WhatsApp QR Code"
                  width={256}
                  height={256}
                  priority
                />
              )}
              {showError && (
                  <div className="flex flex-col items-center text-center text-destructive">
                      <AlertCircle className="h-12 w-12" />
                      <p className="mt-4 font-semibold">Disconnected</p>
                  </div>
              )}
            </div>
          {showError && (
            <Alert variant="destructive" className="w-full">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Connection Status</AlertTitle>
              <AlertDescription className="break-words">
                {message}
              </AlertDescription>
              <div className="mt-4 flex flex-col gap-2 w-full">
                <Button onClick={initializeConnection} className="w-full">
                  Retry Connection
                </Button>
                <Button onClick={forceFreshSession} variant="outline" disabled={isResetting} className="w-full">
                  {isResetting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Reset & Generate New QR
                </Button>
              </div>
            </Alert>
          )}
        </CardContent>
      </Card>
      <p className="mt-8 max-w-sm text-center text-sm text-muted-foreground">
        Open WhatsApp on your phone, go to Settings &gt; Linked Devices, and scan the code.
      </p>
    </div>
  );
}
