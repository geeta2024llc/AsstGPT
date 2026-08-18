
'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Bot,
  LayoutDashboard,
  MessageSquare,
  Users,
  Settings,
  BookMarked,
  History,
  QrCode,
  CheckCircle2,
  LogOut,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ImpersonationBanner from '@/components/impersonation-banner';
import { supabase } from '@/lib/supabase';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const [workspace, setWorkspace] = React.useState({
    name: 'Default Workspace',
    logoUrl: '',
  });
  const [user, setUser] = React.useState({
    name: 'Account',
    email: '',
    avatar: '',
  });
  const [waConnected, setWaConnected] = React.useState<boolean>(false);

  const loadWorkspace = React.useCallback(() => {
    fetch('/api/tenant')
      .then((res) => res.json())
      .then((data) => {
        if (data?.name) {
          setWorkspace({
            name: data.name,
            logoUrl: data.logoUrl || '',
          });
        }
      })
      .catch(() => {});
  }, []);

  const checkWhatsAppStatus = React.useCallback(() => {
    fetch('/api/whatsapp/status', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        setWaConnected(data?.status === 'connected');
      })
      .catch(() => {
        setWaConnected(false);
      });
  }, []);

  React.useEffect(() => {
    loadWorkspace();
    checkWhatsAppStatus();

    const handleWorkspaceUpdated = (e: any) => {
      if (e?.detail?.name) {
        setWorkspace({
          name: e.detail.name,
          logoUrl: e.detail.logoUrl || '',
        });
      } else {
        loadWorkspace();
      }
    };

    const handleWaStatus = (e: any) => {
      if (e?.detail?.status) {
        setWaConnected(e.detail.status === 'connected');
      } else {
        checkWhatsAppStatus();
      }
    };

    window.addEventListener('workspace-updated', handleWorkspaceUpdated);
    window.addEventListener('whatsapp-status-changed', handleWaStatus);
    const interval = setInterval(checkWhatsAppStatus, 10000);

    supabase.auth.getUser().then(({ data }) => {
      const authUser = data?.user;
      if (!authUser) return;
      const name = authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Account';
      const email = authUser.email || '';
      setUser({
        name,
        email,
        avatar: authUser.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FF9800&color=fff`,
      });
    });

    return () => {
      window.removeEventListener('workspace-updated', handleWorkspaceUpdated);
      window.removeEventListener('whatsapp-status-changed', handleWaStatus);
      clearInterval(interval);
    };
  }, [loadWorkspace, checkWhatsAppStatus]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax; secure';
    router.push('/login');
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="space-y-2.5 pb-2">
          <div className="flex items-center gap-3 px-1">
            <Bot className="size-8 text-primary shrink-0" />
            <div className="flex flex-col group-data-[collapsible=icon]:hidden">
              <span className="font-headline text-xl font-semibold">
                AsstGPT
              </span>
            </div>
          </div>
          <div className="px-0.5">
            <Button
              asChild
              className={`w-full justify-start gap-2.5 font-medium transition-all ${
                pathname.startsWith('/whatsapp')
                  ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-md shadow-emerald-500/25'
                  : waConnected
                  ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30'
                  : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30'
              } group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:h-9`}
              size="sm"
            >
              <Link href="/whatsapp" title={waConnected ? 'WhatsApp Connected' : 'Connect WhatsApp'}>
                {waConnected ? (
                  <span className="relative flex h-3.5 w-3.5 items-center justify-center shrink-0">
                    <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 opacity-75"></span>
                    <CheckCircle2 className={`h-3.5 w-3.5 relative ${pathname.startsWith('/whatsapp') ? 'text-slate-950' : 'text-emerald-400'}`} />
                  </span>
                ) : (
                  <QrCode className="h-4 w-4 shrink-0" />
                )}
                <span className="group-data-[collapsible=icon]:hidden truncate">
                  {waConnected ? 'Connected' : 'Connect'}
                </span>
              </Link>
            </Button>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname === '/dashboard'}
                tooltip="Dashboard"
              >
                <Link href="/dashboard">
                  <LayoutDashboard />
                  <span>Dashboard</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith('/inbox')}
                tooltip="Inbox"
              >
                <Link href="/inbox">
                  <MessageSquare />
                  <span>Inbox</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith('/clients')}
                tooltip="Client Details & CRM"
              >
                <Link href="/clients">
                  <Users />
                  <span>Client Details</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith('/knowledge-base')}
                tooltip="AI Memory"
              >
                <Link href="/knowledge-base">
                  <BookMarked />
                  <span>AI Memory</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
             <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith('/activity')}
                tooltip="Activity Feed"
              >
                <Link href="/activity">
                  <History />
                  <span>Activity</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith('/settings')}
                tooltip="Settings"
              >
                <Link href="/settings">
                  <Settings />
                  <span>Settings</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex w-full items-center gap-2 p-1">
            <Avatar className="h-8 w-8 rounded-lg border border-primary/30 bg-primary/10 shrink-0">
              {workspace.logoUrl ? (
                <AvatarImage
                  src={workspace.logoUrl}
                  alt={workspace.name}
                  className="rounded-lg object-cover"
                />
              ) : null}
              <AvatarFallback className="rounded-lg font-bold text-xs text-primary bg-primary/15">
                {workspace.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden text-sm flex-1 min-w-0">
              <span className="truncate font-semibold text-foreground text-xs leading-tight" title={workspace.name}>
                {workspace.name}
              </span>
              <span className="truncate text-[11px] text-muted-foreground leading-tight" title={user.email}>
                {user.email || 'Workspace Member'}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
              onClick={handleSignOut}
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
              <span className="sr-only">Sign out</span>
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <ImpersonationBanner />
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background/80 px-3 sm:px-4 backdrop-blur-sm md:px-6">
          <div className="flex items-center gap-2.5 min-w-0">
            <SidebarTrigger className="cursor-pointer" />
            <div className="flex items-center gap-2 md:hidden">
              <Bot className="size-5 text-primary shrink-0" />
              <span className="font-headline font-semibold text-sm truncate">AsstGPT</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild className="h-8 w-8 sm:h-9 sm:w-9">
              <Link href="/settings">
                <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="sr-only">Settings</span>
              </Link>
            </Button>
          </div>
        </header>
        <main className={`flex-1 max-w-full overflow-x-hidden ${pathname.startsWith('/inbox') ? 'p-0 sm:p-2 md:p-4' : 'p-3 sm:p-4 md:p-6'}`}>{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
