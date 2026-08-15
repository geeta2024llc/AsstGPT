'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  LayoutDashboard,
  Building2,
  Users,
  MessageSquare,
  Cpu,
  ToggleLeft,
  HeartPulse,
  ScrollText,
  ArrowLeftCircle,
  LogOut,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/super-admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/super-admin/organizations', label: 'Organizations', icon: Building2 },
  { href: '/super-admin/users', label: 'Admins & Users', icon: Users },
  { href: '/super-admin/whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { href: '/super-admin/ai-usage', label: 'AI Usage & Cost', icon: Cpu },
  { href: '/super-admin/feature-flags', label: 'Feature Flags', icon: ToggleLeft },
  { href: '/super-admin/health', label: 'System Health', icon: HeartPulse },
  { href: '/super-admin/audit-logs', label: 'Audit Logs', icon: ScrollText },
];

export default function SuperAdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [platformRole, setPlatformRole] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/super-admin/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setPlatformRole(data?.platformRole || null))
      .catch(() => {});
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax; secure';
    router.push('/super-admin/login');
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-8 text-amber-500" />
            <div className="flex flex-col group-data-[collapsible=icon]:hidden">
              <span className="font-headline text-xl font-semibold">Super Admin</span>
              <span className="text-xs text-muted-foreground">Platform Control</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {NAV_ITEMS.map((item) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex flex-col gap-2 p-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">{email}</span>
              {platformRole && (
                <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium capitalize text-amber-400">
                  {platformRole.replace('_', ' ')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="gap-1.5 flex-1 text-xs" asChild>
                <Link href="/dashboard">
                  <ArrowLeftCircle className="h-3.5 w-3.5" />
                  <span>Workspace</span>
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                onClick={handleSignOut}
                title="Sign out of platform session"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="group-data-[collapsible=icon]:hidden">Logout</span>
              </Button>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-amber-500/10 px-4 backdrop-blur-sm md:px-6">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <span className="text-sm font-medium text-amber-600 dark:text-amber-400">Platform-level access &mdash; every action here is audited</span>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
