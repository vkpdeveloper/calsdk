import type { WarningV1 } from '@calsdk/provider';

/**
 * How calsdk reports warnings, in addition to returning them on every result.
 *
 * - `'console'` (default): `console.warn` each distinct warning once per process.
 * - `'silent'`: only return them on results.
 * - a function: called with the warnings of every call that has any.
 *
 * @example
 * globalThis.CALSDK_WARNINGS = 'silent';
 */
export type WarningsSetting =
  | 'console'
  | 'silent'
  | ((warnings: WarningV1[], context: { provider: string; operation: string }) => void);

declare global {
  var CALSDK_WARNINGS: WarningsSetting | undefined;
}

const logged = new Set<string>();

function describe(warning: WarningV1): string {
  if (warning.type === 'other') return warning.message;
  const kind = warning.type === 'unsupported' ? 'is not supported' : 'uses a fallback';
  return `${warning.feature} ${kind}${warning.details ? `: ${warning.details}` : '.'}`;
}

export function logWarnings(
  warnings: WarningV1[],
  context: { provider: string; operation: string },
): void {
  if (warnings.length === 0) return;
  const setting = globalThis.CALSDK_WARNINGS ?? 'console';
  if (setting === 'silent') return;
  if (typeof setting === 'function') {
    setting(warnings, context);
    return;
  }

  for (const warning of warnings) {
    const message = `calsdk warning (${context.provider}, ${context.operation}): ${describe(warning)}`;
    if (logged.has(message)) continue;
    logged.add(message);
    console.warn(message);
  }
}
