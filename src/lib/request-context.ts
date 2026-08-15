export interface RequestContext {
  tenantId: string;
  userId?: string;
  userEmail?: string;
  userRole?: 'admin' | 'operator' | 'viewer';
  jwtToken?: string;
}

let storageInstance: any = null;

if (typeof window === 'undefined') {
  try {
    // Use dynamic require so browser/client Webpack bundle doesn't attempt to bundle async_hooks
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AsyncLocalStorage } = require('async_hooks');
    storageInstance = new AsyncLocalStorage();
  } catch (_) {
    // Fallback if async_hooks not present
  }
}

/**
 * Returns the current request context for the active async execution chain.
 */
export function getRequestContext(): RequestContext | undefined {
  return storageInstance ? storageInstance.getStore() : undefined;
}

/**
 * Executes a function within the scope of a specific RequestContext.
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T | Promise<T>
): Promise<T> {
  if (!storageInstance) {
    return Promise.resolve(fn());
  }
  return storageInstance.run(context, () => Promise.resolve(fn()));
}
