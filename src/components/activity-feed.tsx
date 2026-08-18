'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import {
  Bot,
  FileText,
  Trash2,
  Loader2,
  List,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import type { LogEntry } from '@/types';
import { useToast } from '@/hooks/use-toast';

export default function ActivityFeed() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toast } = useToast();

  // Debounce search query changes
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1); // reset to page 1 on search change
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const fetchLogs = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) setIsRefreshing(true);
      else if (!logs.length) setIsLoading(true);

      try {
        const params = new URLSearchParams({
          page: page.toString(),
          pageSize: pageSize.toString(),
        });
        if (typeFilter && typeFilter !== 'all') {
          params.append('type', typeFilter);
        }
        if (debouncedSearch) {
          params.append('search', debouncedSearch);
        }

        const res = await fetch(`/api/logs?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch activity logs.');

        const data = await res.json();
        if (Array.isArray(data)) {
          setLogs(data);
          setTotal(data.length);
          setTotalPages(Math.ceil(data.length / pageSize) || 1);
        } else {
          setLogs(data.logs || []);
          setTotal(data.total || 0);
          setTotalPages(data.totalPages || 1);
        }
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: (error as Error).message,
        });
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [page, pageSize, typeFilter, debouncedSearch, toast, logs.length]
  );

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Polling every 15s for live updates
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLogs();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const getIcon = (action: string, type: LogEntry['type']) => {
    const act = action.toLowerCase();
    if (act.includes('bot') || act.includes('agent') || act.includes('ai')) {
      return <Bot className="h-5 w-5 text-indigo-500" />;
    }
    if (act.includes('upload') || act.includes('knowledge') || act.includes('file')) {
      return <FileText className="h-5 w-5 text-blue-500" />;
    }
    if (act.includes('delete') || act.includes('remove') || act.includes('purge')) {
      return <Trash2 className="h-5 w-5 text-destructive" />;
    }
    if (act.includes('security') || act.includes('auth') || act.includes('role')) {
      return <ShieldCheck className="h-5 w-5 text-emerald-500" />;
    }
    if (act.includes('webhook') || act.includes('handoff') || act.includes('event')) {
      return <Zap className="h-5 w-5 text-amber-500" />;
    }

    switch (type) {
      case 'success':
        return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
      case 'error':
        return <AlertCircle className="h-5 w-5 text-destructive" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-amber-500" />;
      case 'info':
        return <Info className="h-5 w-5 text-sky-500" />;
      default:
        return <List className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getBadgeVariant = (type: LogEntry['type']) => {
    switch (type) {
      case 'success':
        return 'default';
      case 'error':
        return 'destructive';
      case 'warning':
        return 'outline';
      case 'info':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  const startRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  return (
    <Card className="shadow-sm border border-border/70">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <span>System & User Activity</span>
              {total > 0 && (
                <Badge variant="secondary" className="text-xs font-semibold px-2 py-0.5">
                  {total} {total === 1 ? 'Event' : 'Events'}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-1">
              Audit trail of automated agent decisions, handoffs, and user operations.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchLogs(true)}
              disabled={isRefreshing || isLoading}
              className="h-8 gap-1 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="mt-3 sm:mt-4 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-2.5">
          <div className="relative sm:col-span-6 md:col-span-7">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search actions, details, or users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-8 text-xs sm:text-sm bg-background"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:col-span-6 md:col-span-5">
            <div>
              <Select
                value={typeFilter}
                onValueChange={(val) => {
                  setTypeFilter(val);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-9 text-xs bg-background">
                  <Filter className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">All Types</SelectItem>
                  <SelectItem value="info" className="text-xs">ℹ️ Info</SelectItem>
                  <SelectItem value="success" className="text-xs">✅ Success</SelectItem>
                  <SelectItem value="warning" className="text-xs">⚠️ Warning</SelectItem>
                  <SelectItem value="error" className="text-xs">🛑 Error</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Select
                value={pageSize.toString()}
                onValueChange={(val) => {
                  setPageSize(Number(val));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="10 / page" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10" className="text-xs">10 / page</SelectItem>
                  <SelectItem value="25" className="text-xs">25 / page</SelectItem>
                  <SelectItem value="50" className="text-xs">50 / page</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Loading activity feed...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center border rounded-lg bg-muted/20 border-dashed">
            <List className="h-10 w-10 text-muted-foreground/50 mb-2" />
            <p className="font-semibold text-sm">No activity logs found</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              {debouncedSearch || typeFilter !== 'all'
                ? 'Try clearing your search query or filter to see more events.'
                : 'System events and agent activities will appear here automatically.'}
            </p>
            {(debouncedSearch || typeFilter !== 'all') && (
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setTypeFilter('all');
                }}
                className="mt-2 text-xs"
              >
                Clear all filters
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="divide-y divide-border/50 rounded-md border bg-card">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3.5 p-3.5 transition-colors hover:bg-muted/40"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/70 border">
                    {getIcon(log.action, log.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-sm text-foreground">{log.action}</p>
                      <Badge
                        variant={getBadgeVariant(log.type)}
                        className="text-[10px] px-1.5 py-0 capitalize"
                      >
                        {log.type}
                      </Badge>
                    </div>

                    {log.details && (
                      <p className="text-xs text-muted-foreground mt-1 break-words leading-relaxed">
                        {log.details}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/80">
                      <span className="font-medium text-foreground/80">by {log.user}</span>
                      <span>•</span>
                      <span title={format(new Date(log.timestamp), 'PPpp')}>
                        {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}
                      </span>
                      <span>•</span>
                      <span className="text-[10px] opacity-70">
                        {format(new Date(log.timestamp), 'MMM d, yyyy h:mm a')}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2 border-t text-xs">
              <div className="text-muted-foreground text-center sm:text-left">
                Showing <span className="font-semibold text-foreground">{startRecord}</span> to{' '}
                <span className="font-semibold text-foreground">{endRecord}</span> of{' '}
                <span className="font-semibold text-foreground">{total}</span> entries
              </div>

              <div className="flex items-center justify-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setPage(1)}
                  disabled={page <= 1}
                  title="First Page"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  title="Previous Page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <div className="px-2.5 font-medium text-foreground">
                  Page {page} of {totalPages}
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  title="Next Page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages}
                  title="Last Page"
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
