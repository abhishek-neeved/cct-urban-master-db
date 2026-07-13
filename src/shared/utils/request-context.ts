import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

/**
 * AsyncLocalStorage keeps the current request's context available across the
 * entire async call chain (controller -> service -> repository) without having
 * to thread `requestId` through every function signature.
 */
const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const getRequestId = (): string | undefined => requestContextStorage.getStore()?.requestId;

export const runWithRequestContext = <T>(context: RequestContext, callback: () => T): T =>
  requestContextStorage.run(context, callback);
