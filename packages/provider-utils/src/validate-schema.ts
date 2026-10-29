import type { StandardSchemaV1 } from '@standard-schema/spec';

export type { StandardSchemaV1 };

/**
 * Validates `value` against any Standard Schema (zod, valibot, arktype, ...).
 * Returns the parsed output or the list of issues.
 */
export async function validateSchema<Output>(
  schema: StandardSchemaV1<unknown, Output>,
  value: unknown,
): Promise<
  { success: true; value: Output } | { success: false; issues: readonly StandardSchemaV1.Issue[] }
> {
  const result = await schema['~standard'].validate(value);
  if (result.issues) return { success: false, issues: result.issues };
  return { success: true, value: result.value };
}

/** Formats schema issues as `path: message` lines for error messages. */
export function formatSchemaIssues(issues: readonly StandardSchemaV1.Issue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path
        ?.map((segment) => String(typeof segment === 'object' ? segment.key : segment))
        .join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
