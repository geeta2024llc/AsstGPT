'use client';

import WhatsAppConnectPanel from '@/components/whatsapp-connect-panel';

export default function WhatsAppPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline text-3xl font-bold">WhatsApp Connection</h1>
        <p className="mt-1 text-muted-foreground">
          Link a WhatsApp number to this workspace by scanning a QR code, or reset the session to connect a
          different number.
        </p>
      </div>

      <div className="max-w-xl">
        <WhatsAppConnectPanel />
      </div>
    </div>
  );
}
