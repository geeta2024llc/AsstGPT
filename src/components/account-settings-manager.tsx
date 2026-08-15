'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  LogOut,
  Loader2,
  AlertTriangle,
  UserCircle,
  KeyRound,
  Save,
  Check,
  Eye,
  EyeOff,
  ShieldCheck,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

const CONFIRM_PHRASE = 'DELETE';

export default function AccountSettingsManager() {
  const { toast } = useToast();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [role, setRole] = useState('operator');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Password Change State
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Delete Account Modal State
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchAccount = async () => {
    try {
      const res = await fetch('/api/account');
      if (res.ok) {
        const data = await res.json();
        setEmail(data.email || '');
        setFullName(data.fullName || '');
        setAvatarUrl(data.avatarUrl || '');
        setRole(data.role || 'operator');
      } else {
        const { data } = await supabase.auth.getUser();
        const authUser = data?.user;
        if (authUser) {
          setEmail(authUser.email || '');
          setFullName(authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || '');
          setAvatarUrl(authUser.user_metadata?.avatar_url || '');
        }
      }
    } catch (err) {
      console.error('Failed to load account profile:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAccount();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Name cannot be empty.' });
      return;
    }

    setIsSavingProfile(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          avatarUrl: avatarUrl.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update account profile');

      toast({
        title: 'Profile Updated',
        description: 'Your account details have been saved successfully.',
      });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: err.message,
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please enter a new password.' });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        variant: 'destructive',
        title: 'Weak Password',
        description: 'Password must be at least 6 characters long.',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        variant: 'destructive',
        title: 'Password Mismatch',
        description: 'New password and confirm password do not match.',
      });
      return;
    }

    setIsChangingPassword(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');

      toast({
        title: 'Password Changed 🔒',
        description: 'Your password has been securely updated.',
      });

      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Password Update Failed',
        description: err.message,
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile Details Card */}
      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg font-bold">
            <UserCircle className="h-5 w-5 text-primary" />
            <span>Personal Profile</span>
          </CardTitle>
          <CardDescription>Manage your display name, avatar, and personal login info.</CardDescription>
        </CardHeader>

        <form onSubmit={handleSaveProfile}>
          <CardContent className="space-y-5">
            {/* Avatar & Name Preview */}
            <div className="flex items-center gap-4 p-3 rounded-lg border bg-muted/20">
              <Avatar className="h-16 w-16 border-2 border-primary/20 bg-primary/10">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt={fullName} /> : null}
                <AvatarFallback className="text-lg font-bold text-primary bg-primary/15">
                  {(fullName || 'U').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-1 min-w-0">
                <p className="font-semibold text-sm truncate">{fullName || 'Your Name'}</p>
                <p className="text-xs text-muted-foreground font-mono truncate">{email}</p>
                <span className="inline-block text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                  Role: {role}
                </span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="account-fullname" className="text-xs font-semibold">
                  Display Name
                </Label>
                <Input
                  id="account-fullname"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="h-9 text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="account-email" className="text-xs font-semibold">
                  Email Address
                </Label>
                <Input
                  id="account-email"
                  value={email}
                  readOnly
                  disabled
                  className="h-9 text-xs opacity-75 bg-muted cursor-not-allowed"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="account-avatar" className="text-xs font-semibold">
                  Avatar Image URL (Optional)
                </Label>
                <Input
                  id="account-avatar"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://example.com/avatar.jpg"
                  className="h-9 text-xs"
                />
              </div>
            </div>
          </CardContent>

          <CardFooter className="border-t bg-muted/10 pt-4 flex justify-end">
            <Button
              type="submit"
              disabled={isSavingProfile}
              size="sm"
              className="gap-1.5 text-xs font-semibold cursor-pointer"
            >
              {isSavingProfile ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span>Save Profile</span>
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* Change Password Card */}
      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg font-bold">
            <KeyRound className="h-5 w-5 text-amber-500" />
            <span>Security & Password</span>
          </CardTitle>
          <CardDescription>Update your account password for enhanced authentication security.</CardDescription>
        </CardHeader>

        <form onSubmit={handleChangePassword}>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 max-w-xl">
              <div className="space-y-1.5">
                <Label htmlFor="account-new-password" className="text-xs font-semibold">
                  New Password
                </Label>
                <div className="relative">
                  <Input
                    id="account-new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="h-9 text-xs pr-9"
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="account-confirm-password" className="text-xs font-semibold">
                  Confirm New Password
                </Label>
                <Input
                  id="account-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {newPassword && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span>
                  {newPassword.length >= 8
                    ? 'Strong password length'
                    : 'Good password (min 6 characters)'}
                </span>
              </div>
            )}
          </CardContent>

          <CardFooter className="border-t bg-muted/10 pt-4 flex justify-end">
            <Button
              type="submit"
              disabled={isChangingPassword || !newPassword}
              size="sm"
              className="gap-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white cursor-pointer"
            >
              {isChangingPassword ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <KeyRound className="h-3.5 w-3.5" />
              )}
              <span>Update Password</span>
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* Session Management */}
      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <LogOut className="h-4 w-4 text-muted-foreground" />
            <span>Active Session</span>
          </CardTitle>
          <CardDescription>Log out of your current session on this browser.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-semibold">Sign out</Label>
              <p className="text-xs text-muted-foreground">
                End your authenticated session and return to the login screen.
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-2 cursor-pointer" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
              Log Out
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-rose-500/30 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-rose-500 text-base font-semibold">
            <AlertTriangle className="h-5 w-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Permanently delete your user account and personal access. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-rose-500/30 p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-semibold">Delete account</Label>
              <p className="text-xs text-muted-foreground max-w-md">
                Removes your login and user profile. If you solely own a workspace with other
                members, transfer ownership or remove them first.
              </p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setIsDeleteOpen(true)} className="cursor-pointer">
              Delete Account
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Modal */}
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
            <DialogTitle className="text-rose-500 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Delete your account?
            </DialogTitle>
            <DialogDescription className="space-y-2 text-xs">
              <p>
                This permanently deletes your login, personal profile, and any workspace you solely own.
              </p>
              <p>
                This action cannot be undone. Type <strong className="text-foreground">{CONFIRM_PHRASE}</strong> below to confirm.
              </p>
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            autoFocus
            disabled={isDeleting}
            className="text-xs"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsDeleteOpen(false)} disabled={isDeleting} className="cursor-pointer">
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={confirmText !== CONFIRM_PHRASE || isDeleting}
              onClick={handleDeleteAccount}
              className="cursor-pointer"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete My Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
