import { Suspense } from 'react';
import InboxLayout from '@/components/inbox-layout';
import { Loader2 } from 'lucide-react';

export default function InboxPage() {
    return (
        <div className="h-[calc(100dvh-3.5rem)] sm:h-[calc(100vh-theme(spacing.20))] flex flex-col flex-1 w-full max-w-full">
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
