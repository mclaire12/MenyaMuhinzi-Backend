/**
 * Produces a concise, single-line description of an error.
 * Handles `AggregateError` (empty message, e.g. ECONNREFUSED on IPv4 + IPv6),
 * errors that only carry a `code`, and multi-line driver messages.
 */
export function describeError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    const inner = [...new Set(error.errors.map((e) => describeError(e)))];
    return inner.join('; ');
  }

  if (error instanceof Error) {
    const cause = error.cause !== undefined ? describeError(error.cause) : '';
    // Header lines such as "Invalid `prisma.$queryRaw()` invocation:" carry no detail.
    const lines = error.message
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.endsWith(':'));
    const message = lines[lines.length - 1] ?? '';
    const code = (error as { code?: unknown }).code;
    const parts = [message, cause].filter(Boolean);
    if (parts.length > 0) return parts.join(': ');
    if (typeof code === 'string' && code.length > 0) return code;
    return error.name;
  }

  return String(error);
}
