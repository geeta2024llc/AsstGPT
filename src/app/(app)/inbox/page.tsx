import { Suspense } from 'react';
import InboxLayout from '@/components/inbox-layout';
import { Loader2 } from 'lucide-react';

export default function InboxPage() {
    return (
        <div className="space-y-6">
            <h1 className="font-headline text-3xl font-bold">Inbox</h1>
            <Suspense fallback={
                <div className="flex h-96 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            }>
                <InboxLayout />
            </Suspense>
        </div>
    );
}
