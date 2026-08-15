'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Users,
  Search,
  Download,
  RefreshCw,
  MessageSquare,
  Mail,
  Building2,
  Phone,
  Calendar,
  Star,
  UserPlus,
  UserCheck,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  SlidersHorizontal,
  ChevronRight,
  Filter,
  UserCog,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import ContactProfileDrawer from '@/components/contact-profile-drawer';
import type { ClientDetailItem, LeadStage } from '@/types';
import { format, formatDistanceToNow } from 'date-fns';

const STAGE_CONFIG: Record<
  LeadStage,
  { label: string; badgeClass: string; icon: string }
> = {
  lead: {
    label: 'Lead',
    badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    icon: '🎯',
  },
  prospect: {
    label: 'Prospect',
    badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    icon: '⚡',
  },
  customer: {
    label: 'Customer',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    icon: '💎',
  },
  vip: {
    label: 'VIP',
    badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-semibold',
    icon: '★',
  },
  churned: {
    label: 'Churned',
    badgeClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    icon: '⚠️',
  },
};

export default function ClientDetailPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [clients, setClients] = useState<ClientDetailItem[]>([]);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({
    all: 0,
    lead: 0,
    prospect: 0,
    customer: 0,
    vip: 0,
    churned: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStage, setSelectedStage] = useState<LeadStage | 'all'>('all');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'messages_desc' | 'name_asc'>('date_desc');
  const [copiedPhoneMap, setCopiedPhoneMap] = useState<Record<string, boolean>>({});

  // Drawer state
  const [activeDrawerChatId, setActiveDrawerChatId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const fetchClients = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch('/api/contacts');
      if (!res.ok) throw new Error('Failed to fetch clients');
      const data = await res.json();
      setClients(data.clients || []);
      setStageCounts(data.stageCounts || {});
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error Loading Clients',
        description: error.message || 'Unable to retrieve client directory.',
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const handleCopyPhone = (phone: string, id: string) => {
    if (!phone) return;
    navigator.clipboard.writeText(phone);
    setCopiedPhoneMap((prev) => ({ ...prev, [id]: true }));
    toast({ title: 'Phone Number Copied 📋', description: phone });
    setTimeout(() => {
      setCopiedPhoneMap((prev) => ({ ...prev, [id]: false }));
    }, 2000);
  };

  const handleStageChange = async (client: ClientDetailItem, newStage: LeadStage) => {
    const originalStage = client.stage;
    // Optimistic update
    setClients((prev) =>
      prev.map((c) => (c.id === client.id ? { ...c, stage: newStage } : c))
    );

    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(client.externalId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      });

      if (!res.ok) throw new Error('Failed to update stage');

      toast({
        title: 'Lifecycle Stage Updated',
        description: `${client.name} moved to ${STAGE_CONFIG[newStage]?.label || newStage}.`,
      });

      // Update counters
      setStageCounts((prev) => ({
        ...prev,
        [originalStage]: Math.max(0, (prev[originalStage] || 1) - 1),
        [newStage]: (prev[newStage] || 0) + 1,
      }));
    } catch (err: any) {
      // Revert on error
      setClients((prev) =>
        prev.map((c) => (c.id === client.id ? { ...c, stage: originalStage } : c))
      );
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: err.message,
      });
    }
  };

  const handleOpenDrawer = (externalId: string) => {
    setActiveDrawerChatId(externalId);
    setIsDrawerOpen(true);
  };

  const handleDrawerProfileUpdated = (updated: any) => {
    setClients((prev) =>
      prev.map((c) =>
        c.externalId === activeDrawerChatId
          ? {
              ...c,
              name: updated.name || c.name,
              email: updated.email,
              company: updated.company,
              stage: updated.stage,
              tags: updated.tags || [],
              notes: updated.notes,
            }
          : c
      )
    );
  };

  // Filter and sort clients
  const filteredAndSortedClients = useMemo(() => {
    let result = [...clients];

    // Stage filter
    if (selectedStage !== 'all') {
      result = result.filter((c) => c.stage === selectedStage);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.formattedPhone.toLowerCase().includes(q) ||
          (c.email && c.email.toLowerCase().includes(q)) ||
          (c.company && c.company.toLowerCase().includes(q)) ||
          (c.tags && c.tags.some((t) => t.toLowerCase().includes(q)))
      );
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'date_desc') return b.createdAt - a.createdAt;
      if (sortBy === 'date_asc') return a.createdAt - b.createdAt;
      if (sortBy === 'messages_desc') return (b.messageCount || 0) - (a.messageCount || 0);
      if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
      return 0;
    });

    return result;
  }, [clients, selectedStage, searchQuery, sortBy]);

  // Export to CSV
  const handleExportCSV = () => {
    if (filteredAndSortedClients.length === 0) {
      toast({ title: 'No Data to Export', description: 'There are no clients matching the filter.' });
      return;
    }

    const headers = [
      'SN',
      'Client Name',
      'Phone Number',
      'Date Contacted',
      'Lifecycle Stage',
      'Email Address',
      'Company Name',
      'Total Messages',
      'Tags',
      'Notes',
    ];

    const rows = filteredAndSortedClients.map((c, idx) => [
      idx + 1,
      `"${c.name.replace(/"/g, '""')}"`,
      `"${c.formattedPhone || c.phone || ''}"`,
      `"${format(new Date(c.createdAt), 'yyyy-MM-dd HH:mm:ss')}"`,
      `"${c.stage}"`,
      `"${c.email || ''}"`,
      `"${(c.company || '').replace(/"/g, '""')}"`,
      c.messageCount || 0,
      `"${(c.tags || []).join(', ')}"`,
      `"${(c.notes || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `client_detail_export_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: 'CSV Export Generated 📥',
      description: `Exported ${filteredAndSortedClients.length} client records.`,
    });
  };

  // Metrics calculations
  const totalClientsCount = clients.length;
  const activeLeadsCount = (stageCounts.lead || 0) + (stageCounts.prospect || 0);
  const customersCount = (stageCounts.customer || 0) + (stageCounts.vip || 0);
  const totalMessageVolume = clients.reduce((sum, c) => sum + (c.messageCount || 0), 0);

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-2xl font-bold font-headline tracking-tight">
              Client Detail
            </h1>
            <Badge variant="outline" className="ml-2 font-mono text-xs">
              CRM Directory
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Complete database of all customer profiles, contact history, lifecycle stages, and conversation volume.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchClients}
            disabled={isRefreshing}
            className="gap-1.5 h-9"
          >
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            <span>Refresh</span>
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={handleExportCSV}
            className="gap-1.5 h-9 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Clients */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 h-16 w-16 bg-blue-500/10 rounded-full blur-2xl -mr-4 -mt-4" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Clients
            </CardTitle>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
              <Users className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{totalClientsCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Registered WhatsApp contacts
            </p>
          </CardContent>
        </Card>

        {/* Card 2: Leads & Prospects */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 h-16 w-16 bg-purple-500/10 rounded-full blur-2xl -mr-4 -mt-4" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Leads & Prospects
            </CardTitle>
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
              <UserPlus className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-purple-600 dark:text-purple-400">
              {activeLeadsCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stageCounts.lead || 0} Leads • {stageCounts.prospect || 0} In Evaluation
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Customers & VIP */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 h-16 w-16 bg-emerald-500/10 rounded-full blur-2xl -mr-4 -mt-4" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Paying & VIP Clients
            </CardTitle>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <Star className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {customersCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stageCounts.customer || 0} Active • {stageCounts.vip || 0} VIP Members
            </p>
          </CardContent>
        </Card>

        {/* Card 4: Total Messages */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 h-16 w-16 bg-amber-500/10 rounded-full blur-2xl -mr-4 -mt-4" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Messages
            </CardTitle>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
              <MessageSquare className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
              {totalMessageVolume.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Total customer interactions logged
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter & Search Bar */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, phone, email, company, tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 bg-background/80"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Sort By:
              </span>
              <Select
                value={sortBy}
                onValueChange={(val: any) => setSortBy(val)}
              >
                <SelectTrigger className="h-9 w-[180px] bg-background/80 text-xs">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date_desc">Newest Contact First</SelectItem>
                  <SelectItem value="date_asc">Oldest Contact First</SelectItem>
                  <SelectItem value="messages_desc">Most Messages</SelectItem>
                  <SelectItem value="name_asc">Name (A to Z)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Lifecycle Stage Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border/40">
            <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1 font-medium">
              <Filter className="h-3 w-3" /> Stage:
            </span>

            <Button
              variant={selectedStage === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedStage('all')}
              className={cn(
                'h-7 text-xs px-2.5 rounded-full',
                selectedStage === 'all'
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : 'bg-background/60 hover:bg-muted/80'
              )}
            >
              All Clients ({stageCounts.all || clients.length})
            </Button>

            <Button
              variant={selectedStage === 'lead' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedStage('lead')}
              className={cn(
                'h-7 text-xs px-2.5 rounded-full gap-1',
                selectedStage === 'lead'
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-background/60 hover:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30'
              )}
            >
              <span>🎯 Lead</span>
              <span className="text-[10px] opacity-80">({stageCounts.lead || 0})</span>
            </Button>

            <Button
              variant={selectedStage === 'prospect' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedStage('prospect')}
              className={cn(
                'h-7 text-xs px-2.5 rounded-full gap-1',
                selectedStage === 'prospect'
                  ? 'bg-purple-600 text-white font-semibold'
                  : 'bg-background/60 hover:bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30'
              )}
            >
              <span>⚡ Prospect</span>
              <span className="text-[10px] opacity-80">({stageCounts.prospect || 0})</span>
            </Button>

            <Button
              variant={selectedStage === 'customer' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedStage('customer')}
              className={cn(
                'h-7 text-xs px-2.5 rounded-full gap-1',
                selectedStage === 'customer'
                  ? 'bg-emerald-600 text-white font-semibold'
                  : 'bg-background/60 hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
              )}
            >
              <span>💎 Customer</span>
              <span className="text-[10px] opacity-80">({stageCounts.customer || 0})</span>
            </Button>

            <Button
              variant={selectedStage === 'vip' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedStage('vip')}
              className={cn(
                'h-7 text-xs px-2.5 rounded-full gap-1',
                selectedStage === 'vip'
                  ? 'bg-amber-600 text-white font-semibold'
                  : 'bg-background/60 hover:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
              )}
            >
              <span>★ VIP</span>
              <span className="text-[10px] opacity-80">({stageCounts.vip || 0})</span>
            </Button>

            <Button
              variant={selectedStage === 'churned' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedStage('churned')}
              className={cn(
                'h-7 text-xs px-2.5 rounded-full gap-1',
                selectedStage === 'churned'
                  ? 'bg-rose-600 text-white font-semibold'
                  : 'bg-background/60 hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
              )}
            >
              <span>⚠️ Churned</span>
              <span className="text-[10px] opacity-80">({stageCounts.churned || 0})</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Main CRM Table Card */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="border-b border-border/60 hover:bg-transparent">
                <TableHead className="w-14 text-center font-bold text-xs uppercase tracking-wider">
                  SN
                </TableHead>
                <TableHead className="min-w-[220px] font-bold text-xs uppercase tracking-wider">
                  Client Name
                </TableHead>
                <TableHead className="min-w-[180px] font-bold text-xs uppercase tracking-wider">
                  Phone Number
                </TableHead>
                <TableHead className="min-w-[160px] font-bold text-xs uppercase tracking-wider">
                  Date Contacted
                </TableHead>
                <TableHead className="min-w-[150px] font-bold text-xs uppercase tracking-wider">
                  Lifecycle Stage
                </TableHead>
                <TableHead className="min-w-[200px] font-bold text-xs uppercase tracking-wider">
                  Email Address
                </TableHead>
                <TableHead className="min-w-[160px] font-bold text-xs uppercase tracking-wider">
                  Company Name
                </TableHead>
                <TableHead className="min-w-[130px] text-center font-bold text-xs uppercase tracking-wider">
                  Total Messages
                </TableHead>
                <TableHead className="w-24 text-right font-bold text-xs uppercase tracking-wider pr-4">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-48 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-7 w-7 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground font-medium">
                        Loading CRM client profiles...
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredAndSortedClients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-48 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Users className="h-8 w-8 text-muted-foreground/50" />
                      <p className="text-base font-semibold">No client records found</p>
                      <p className="text-xs text-muted-foreground max-w-sm">
                        {searchQuery || selectedStage !== 'all'
                          ? 'Try adjusting your search criteria or stage filter to find clients.'
                          : 'As customers interact via WhatsApp, their CRM profiles will appear here automatically.'}
                      </p>
                      {(searchQuery || selectedStage !== 'all') && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSearchQuery('');
                            setSelectedStage('all');
                          }}
                          className="mt-2 text-xs"
                        >
                          Reset Filters
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSortedClients.map((client, idx) => {
                  const stageMeta = STAGE_CONFIG[client.stage] || STAGE_CONFIG.lead;
                  const isCopied = copiedPhoneMap[client.id];
                  const displayPhone = client.formattedPhone || client.phone || 'No phone';

                  return (
                    <TableRow
                      key={client.id}
                      className="border-b border-border/40 hover:bg-muted/40 transition-colors group"
                    >
                      {/* 1. SN Symbol Number */}
                      <TableCell className="text-center font-mono text-xs font-semibold text-muted-foreground">
                        #{idx + 1}
                      </TableCell>

                      {/* 2. Client Name */}
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9 border border-border/60 shrink-0 bg-muted/40">
                            <AvatarImage src={client.avatarUrl} alt={client.name} />
                            <AvatarFallback className="font-semibold text-xs text-primary bg-primary/10">
                              {client.initials}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                              {client.name}
                            </p>
                            {client.tags && client.tags.length > 0 && (
                              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                {client.tags.slice(0, 2).map((tag, tIdx) => (
                                  <span
                                    key={tIdx}
                                    className="text-[10px] px-1.5 py-0.2 rounded bg-muted/80 text-muted-foreground border border-border/40 font-medium"
                                  >
                                    {tag}
                                  </span>
                                ))}
                                {client.tags.length > 2 && (
                                  <span className="text-[9px] text-muted-foreground">
                                    +{client.tags.length - 2}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>

                      {/* 3. Phone Number */}
                      <TableCell>
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <span className="text-foreground font-medium">{displayPhone}</span>
                          {displayPhone !== 'No phone' && (
                            <button
                              type="button"
                              onClick={() => handleCopyPhone(displayPhone, client.id)}
                              className="text-muted-foreground hover:text-primary transition-colors p-1 rounded hover:bg-muted"
                              title="Copy phone number"
                            >
                              {isCopied ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </TableCell>

                      {/* 4. Date Contacted */}
                      <TableCell>
                        <div className="flex flex-col text-xs">
                          <span className="font-medium text-foreground">
                            {format(new Date(client.createdAt), 'MMM d, yyyy')}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {format(new Date(client.createdAt), 'h:mm a')} •{' '}
                            {formatDistanceToNow(new Date(client.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                      </TableCell>

                      {/* 5. Client Lifecycle Stages (Interactive) */}
                      <TableCell>
                        <Select
                          value={client.stage}
                          onValueChange={(val: LeadStage) => handleStageChange(client, val)}
                        >
                          <SelectTrigger className="h-7 w-[125px] text-xs font-medium border bg-background/60 shadow-none px-2">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lead" className="text-xs">
                              🎯 Lead
                            </SelectItem>
                            <SelectItem value="prospect" className="text-xs">
                              ⚡ Prospect
                            </SelectItem>
                            <SelectItem value="customer" className="text-xs">
                              💎 Customer
                            </SelectItem>
                            <SelectItem value="vip" className="text-xs font-semibold text-amber-500">
                              ★ VIP
                            </SelectItem>
                            <SelectItem value="churned" className="text-xs text-rose-500">
                              ⚠️ Churned
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>

                      {/* 6. Email Address */}
                      <TableCell>
                        {client.email ? (
                          <a
                            href={`mailto:${client.email}`}
                            className="text-xs text-primary hover:underline flex items-center gap-1.5 truncate max-w-[190px]"
                          >
                            <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{client.email}</span>
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground/60 italic">—</span>
                        )}
                      </TableCell>

                      {/* 7. Company Name */}
                      <TableCell>
                        {client.company ? (
                          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground truncate max-w-[160px]">
                            <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{client.company}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60 italic">—</span>
                        )}
                      </TableCell>

                      {/* 8. Total Messages Done */}
                      <TableCell className="text-center">
                        <Badge
                          variant="secondary"
                          className={cn(
                            'font-mono text-xs px-2.5 py-0.5 inline-flex items-center gap-1.5',
                            (client.messageCount || 0) > 20
                              ? 'bg-primary/10 text-primary border-primary/20 font-semibold'
                              : 'bg-muted/80 text-muted-foreground'
                          )}
                        >
                          <MessageSquare className="h-3 w-3" />
                          <span>{client.messageCount || 0}</span>
                        </Badge>
                      </TableCell>

                      {/* 9. Actions */}
                      <TableCell className="text-right pr-4">
                        <div className="flex items-center justify-end gap-1">
                          {/* Jump to Inbox */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={() => router.push(`/inbox?chat=${encodeURIComponent(client.externalId)}`)}
                            title="Open Conversation in Inbox"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>

                          {/* Edit CRM Profile Drawer */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={() => handleOpenDrawer(client.externalId)}
                            title="Edit CRM Profile & Notes"
                          >
                            <UserCog className="h-4 w-4 text-primary" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Table Footer Summary */}
        <div className="flex items-center justify-between p-4 border-t border-border/60 bg-muted/20 text-xs text-muted-foreground">
          <span>
            Showing <strong className="text-foreground">{filteredAndSortedClients.length}</strong> of{' '}
            <strong className="text-foreground">{clients.length}</strong> client records
          </span>
          {filteredAndSortedClients.length > 0 && (
            <span className="font-mono">
              Total Engagement:{' '}
              <strong className="text-foreground">
                {filteredAndSortedClients.reduce((sum, c) => sum + (c.messageCount || 0), 0)}
              </strong>{' '}
              messages
            </span>
          )}
        </div>
      </Card>

      {/* Slide-Over Contact Profile Drawer */}
      <ContactProfileDrawer
        chatId={activeDrawerChatId}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onProfileUpdated={handleDrawerProfileUpdated}
      />
    </div>
  );
}
