'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Users2, Play, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export default function ContactDedupManager() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; mergedGroups: number } | null>(null);
  const { toast } = useToast();

  const handleRunNow = async () => {
    setIsRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/contacts/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!res.ok) throw new Error('Duplicate-contact merge failed.');

      const data = await res.json();
      setResult(data);

      toast({
        title: 'Merge Complete',
        description: `Merged ${data.mergedGroups} duplicate contact group(s).`,
      });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Merge Error',
        description: err.message,
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <Users2 className="h-5 w-5 text-indigo-500" />
            <span>Duplicate Contact Cleanup</span>
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-1">
            Automatically merges "ghost" contacts that share the same phone number across different
            WhatsApp JIDs. Contacts identified only by an @lid (privacy-preserving) identifier cannot be
            detected automatically -- link those manually from the contact profile instead.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {result && (
            <div className="p-3.5 rounded-lg border bg-muted/40 text-xs space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                {result.mergedGroups > 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                )}
                <span>
                  {result.mergedGroups > 0
                    ? `Merged ${result.mergedGroups} duplicate contact group(s).`
                    : 'No duplicate contacts found.'}
                </span>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="border-t bg-muted/10 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunNow}
            disabled={isRunning}
            className="text-xs gap-1.5"
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 text-indigo-500 fill-indigo-500" />
            )}
            <span>Run Auto-Merge Now</span>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
