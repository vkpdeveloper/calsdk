import { InvalidArgumentError, type ProviderOptionsV1, type WarningV1 } from '@calsdk/provider';
import { formatSchemaIssues, type StandardSchemaV1, validateSchema } from './validate-schema';

/**
 * Reads and validates this provider's entry in `providerOptions`.
 *
 * Invalid values throw `InvalidArgumentError`. Keys the schema strips (unknown
 * options) produce an `unsupported` warning instead of failing the call.
 *
 * @example
 * const { options, warnings } = await parseProviderOptions({
 *   provider: 'google',
 *   providerOptions,
 *   schema: googleProviderOptionsSchema,
 * });
 */
export async function parseProviderOptions<Output extends object>({
  provider,
  providerOptions,
  schema,
}: {
  provider: string;
  providerOptions: ProviderOptionsV1 | undefined;
  schema: StandardSchemaV1<unknown, Output>;
}): Promise<{ options: Output | undefined; warnings: WarningV1[] }> {
  const input = providerOptions?.[provider];
  if (input === undefined) return { options: undefined, warnings: [] };

  const result = await validateSchema(schema, input);
  if (!result.success) {
    throw new InvalidArgumentError({
      argument: `providerOptions.${provider}`,
      message: formatSchemaIssues(result.issues),
    });
  }

  const warnings: WarningV1[] = Object.keys(input)
    .filter((key) => !Object.hasOwn(result.value, key))
    .map((key) => ({
      type: 'unsupported',
      feature: `providerOptions.${provider}.${key}`,
      details: `Unknown option for provider "${provider}", it was ignored.`,
    }));

  return { options: result.value, warnings };
}
