import { InvalidArgumentError } from '@calsdk/provider';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseProviderOptions } from './parse-provider-options';

const schema = z.object({ sendUpdates: z.enum(['all', 'none']).optional() });

describe('parseProviderOptions', () => {
  it('returns undefined when the provider has no entry', async () => {
    const result = await parseProviderOptions({
      provider: 'google',
      providerOptions: { microsoft: { x: 1 } },
      schema,
    });
    expect(result).toEqual({ options: undefined, warnings: [] });
  });

  it('warns about unknown keys instead of failing', async () => {
    const result = await parseProviderOptions({
      provider: 'google',
      providerOptions: { google: { sendUpdates: 'all', colour: 'red' } },
      schema,
    });
    expect(result.options).toEqual({ sendUpdates: 'all' });
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'providerOptions.google.colour' }),
    ]);
  });

  it('throws InvalidArgumentError for invalid values', async () => {
    await expect(
      parseProviderOptions({
        provider: 'google',
        providerOptions: { google: { sendUpdates: 'everyone' } },
        schema,
      }),
    ).rejects.toSatisfy(
      (error) =>
        InvalidArgumentError.isInstance(error) &&
        error.argument === 'providerOptions.google' &&
        error.message.includes('sendUpdates'),
    );
  });
});
