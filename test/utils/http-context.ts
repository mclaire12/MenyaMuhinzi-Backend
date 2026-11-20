import type { ExecutionContext } from '@nestjs/common';

/** Minimal HTTP ExecutionContext for guard unit tests. */
export function httpContext(request: Record<string, unknown>): ExecutionContext {
  const handler = (): void => undefined;
  class TestController {}
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}
