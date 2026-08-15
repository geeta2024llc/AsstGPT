'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react';

export interface ConfirmDeleteDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string | React.ReactNode;
  itemName?: string;
  itemType?: string;
  onConfirm: () => Promise<void> | void;
  isLoading?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

export default function ConfirmDeleteDialog({
  isOpen,
  onOpenChange,
  title,
  description,
  itemName,
  itemType = 'item',
  onConfirm,
  isLoading = false,
  confirmLabel = 'Yes, Delete',
  cancelLabel = 'No, Cancel',
}: ConfirmDeleteDialogProps) {
  const [internalLoading, setInternalLoading] = React.useState(false);
  const loading = isLoading || internalLoading;

  const handleConfirm = async () => {
    try {
      setInternalLoading(true);
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      // Error handled by parent toast/callback
    } finally {
      setInternalLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !loading && onOpenChange(open)}>
      <DialogContent className="sm:max-w-[440px] border-rose-500/20 bg-card">
        <DialogHeader className="gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <DialogTitle className="text-lg font-headline font-semibold">
            {title || `Delete ${itemType}?`}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            {description || (
              <>
                Are you sure you want to delete{' '}
                {itemName ? (
                  <span className="font-semibold text-foreground">"{itemName}"</span>
                ) : (
                  `this ${itemType}`
                )}
                ? This action cannot be undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0 mt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="w-full sm:w-auto text-xs"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleConfirm}
            disabled={loading}
            className="w-full sm:w-auto text-xs font-semibold gap-1.5 bg-rose-600 hover:bg-rose-700 text-white shadow-xs"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Deleting...</span>
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5" />
                <span>{confirmLabel}</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
