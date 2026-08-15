'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LogOut, Loader2, AlertTriangle, UserCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

const CONFIRM_PHRASE = 'DELETE';

export default function AccountSettingsManager() {
  const { toast } = useToast();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const authUser = data?.user;
      if (!authUser) return;
      setEmail(authUser.email || '');
      setFullName(authUser.user_metadata?.full_name || '');
    });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax; secure';
    router.push('/login');
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch('/api/account', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete account');
      }

      toast({ title: 'Account deleted', description: 'Your account has been permanently deleted.' });
      await supabase.auth.signOut();
      document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax; secure';
      router.push('/login');
    } catch (err: any) {
      toast({
        title: 'Could not delete account',
        description: err.message || 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
      setIsDeleting(false);
      setIsDeleteOpen(false);
      setConfirmText('');
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCircle className="h-5 w-5" />
            Your Account
          </CardTitle>
          <CardDescription>Manage your personal sign-in and session.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input value={fullName || '—'} readOnly disabled />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input value={email} readOnly disabled />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-base">Sign out</Label>
              <p className="text-sm text-muted-foreground">
                End your current session on this device.
              </p>
            </div>
            <Button variant="outline" className="gap-2" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
              Log Out
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-rose-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-rose-500">
            <AlertTriangle className="h-5 w-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Permanently delete your account and personal access. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-rose-500/30 p-4">
            <div className="space-y-0.5">
              <Label className="text-base">Delete account</Label>
              <p className="text-sm text-muted-foreground max-w-md">
                Removes your login and profile. If you solely own a workspace with other
                members, transfer ownership or remove them first.
              </p>
            </div>
            <Button variant="destructive" onClick={() => setIsDeleteOpen(true)}>
              Delete Account
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={isDeleteOpen}
        onOpenChange={(open) => {
          if (isDeleting) return;
          setIsDeleteOpen(open);
          if (!open) setConfirmText('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-rose-500">Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your login, profile, and any workspace you solely own.
              This action cannot be undone. Type <span className="font-semibold text-foreground">{CONFIRM_PHRASE}</span> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            autoFocus
            disabled={isDeleting}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== CONFIRM_PHRASE || isDeleting}
              onClick={handleDeleteAccount}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete My Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
