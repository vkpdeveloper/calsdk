import { z } from 'zod';

/** `providerOptions.microsoft` for `createEvent` and `updateEvent`. */
export const microsoftEventOptionsSchema = z.object({
  /** Outlook's own availability. Overrides `showAs`. */
  showAs: z.enum(['free', 'tentative', 'busy', 'oof', 'workingElsewhere']).optional(),
  importance: z.enum(['low', 'normal', 'high']).optional(),
  /** Outlook category names. Categories also carry Outlook's event colors. */
  categories: z.array(z.string()).optional(),
  /** Client-generated id that makes a create safe to retry: Outlook will not create it twice. */
  transactionId: z.string().optional(),
});
export type MicrosoftEventOptions = z.infer<typeof microsoftEventOptionsSchema>;

/** `providerOptions.microsoft` for `syncEvents`. */
export const microsoftSyncOptionsSchema = z.object({
  /**
   * Window an initial sync covers, as ISO 8601 instants. Outlook syncs a fixed window, kept
   * in the cursor. Defaults to one year back and two years ahead of the initial sync.
   */
  timeMin: z.iso.datetime({ offset: true }).optional(),
  timeMax: z.iso.datetime({ offset: true }).optional(),
});
export type MicrosoftSyncOptions = z.infer<typeof microsoftSyncOptionsSchema>;

/** The option and metadata types of the Microsoft provider, for type checking in `calsdk`. */
export type MicrosoftProviderTypes = {
  options: {
    createEvent: MicrosoftEventOptions;
    updateEvent: MicrosoftEventOptions;
    syncEvents: MicrosoftSyncOptions;
  };
  eventMetadata: MicrosoftEventMetadata;
};

/** `providerMetadata.microsoft` on events. */
export type MicrosoftEventMetadata = {
  /**
   * Outlook's availability, which `showAs` reduces to busy or free: `'free'`, `'tentative'`,
   * `'busy'`, `'oof'`, `'workingElsewhere'` or `'unknown'`.
   */
  showAs?: string;
  importance?: string;
  categories?: string[];
  iCalUId?: string;
};
