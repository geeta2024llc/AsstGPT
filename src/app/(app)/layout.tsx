
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
  LogOut,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ImpersonationBanner from '@/components/impersonation-banner';
import { supabase } from '@/lib/supabase';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = React.useState({
    name: 'Account',
    email: '',
    avatar: `https://ui-avatars.com/api/?name=Account&background=FF9800&color=fff`,
  });

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const authUser = data?.user;
      if (!authUser) return;
      const name = authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Account';
      setUser({
        name,
        email: authUser.email || '',
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FF9800&color=fff`,
      });
    });
  }, []);

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
                  : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30'
              } group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:h-9`}
              size="sm"
            >
              <Link href="/whatsapp" title="Connect WhatsApp">
                <QrCode className="h-4 w-4 shrink-0" />
                <span className="group-data-[collapsible=icon]:hidden truncate">Connect</span>
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
            <Avatar className="h-8 w-8">
              <AvatarImage
                src={user.avatar}
                alt={user.name}
              />
              <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden text-sm flex-1">
              <span className="truncate font-semibold">{user.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10"
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
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm md:px-6">
          <SidebarTrigger />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/settings">
                <Settings className="h-5 w-5" />
                <span className="sr-only">Settings</span>
              </Link>
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
