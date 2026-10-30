import {
  InvalidResponseDataError,
  type SyncEventsResultV1,
  UnsupportedFunctionalityError,
} from '@calsdk/provider';
import type { CallSettings, ResultMetadata, SyncChange, Warning } from './types';
import { resultMetadata, runCall } from './util/prepare-call';
import { requireId } from './util/validate';

export type SyncEventsOptions = CallSettings & {
  /** Defaults to `'primary'`. */
  calendarId?: string;
  /**
   * `nextCursor` from the previous sync. Omit for the initial full sync. If the provider
   * rejects it, `SyncCursorExpiredError` is thrown: discard it and sync without a cursor.
   */
  cursor?: string;
};

export type SyncEventsResult = ResultMetadata & {
  /** Every change since `cursor`, oldest first. Apply them in order. */
  changes: SyncChange[];
  /** Store it and pass it as `cursor` next time. */
  nextCursor: string;
};

export type SyncEventsPageResult = ResultMetadata & {
  changes: SyncChange[];
  /** Pass as `pageToken` (with the same `cursor`) to get the next page of this round. */
  nextPageToken?: string;
  /** Present on the last page. Store it and pass it as `cursor` next time. */
  nextCursor?: string;
};

/**
 * Fetches what changed in a calendar since the last sync.
 *
 * By default it follows every page and returns all changes with the cursor for the
 * next sync. Pass `paginate: false` to fetch one page at a time, for example to
 * apply very large initial syncs incrementally.
 *
 * @example
 * const { changes, nextCursor } = await syncEvents({ calendar, cursor: stored });
 * for (const change of changes) apply(change);
 * await saveCursor(nextCursor);
 */
export async function syncEvents(
  options: SyncEventsOptions & { paginate?: true },
): Promise<SyncEventsResult>;
export async function syncEvents(
  options: SyncEventsOptions & { paginate: false; pageToken?: string },
): Promise<SyncEventsPageResult>;
export async function syncEvents(
  options: SyncEventsOptions & { paginate?: boolean; pageToken?: string },
): Promise<SyncEventsResult | SyncEventsPageResult>;
export async function syncEvents(
  options: SyncEventsOptions & { paginate?: boolean; pageToken?: string },
): Promise<SyncEventsResult | SyncEventsPageResult> {
  const calendarId = requireId(options.calendarId ?? 'primary', 'calendarId');
  const fetchPage = async (pageToken: string | undefined) => {
    const doSyncEvents = options.calendar.doSyncEvents?.bind(options.calendar);
    if (!doSyncEvents) {
      throw new UnsupportedFunctionalityError({
        provider: options.calendar.provider,
        functionality: 'sync',
      });
    }
    const page: SyncEventsResultV1 = await runCall(options, 'syncEvents', 'retryable', (call) =>
      doSyncEvents({ ...call, calendarId, cursor: options.cursor, pageToken }),
    );
    // Without either token the app could neither continue nor resume.
    if (page.nextPageToken === undefined && page.nextCursor === undefined) {
      throw new InvalidResponseDataError({
        data: page,
        message: `Provider "${options.calendar.provider}" returned a sync page without nextPageToken or nextCursor. This is a provider bug.`,
      });
    }
    return page;
  };

  if (options.paginate === false) {
    const page = await fetchPage(options.pageToken);
    return {
      changes: page.changes,
      nextPageToken: page.nextPageToken,
      nextCursor: page.nextCursor,
      ...resultMetadata(page),
    };
  }

  const changes: SyncChange[] = [];
  const warnings: Warning[] = [];
  const seen = new Set<string>();
  let page = await fetchPage(undefined);
  for (;;) {
    changes.push(...page.changes);
    warnings.push(...page.warnings);
    if (page.nextPageToken === undefined) break;
    // A provider returning the same token twice would loop forever.
    if (seen.has(page.nextPageToken)) {
      throw new InvalidResponseDataError({
        data: page.nextPageToken,
        message: `Provider "${options.calendar.provider}" returned the same sync page token twice. This is a provider bug.`,
      });
    }
    seen.add(page.nextPageToken);
    page = await fetchPage(page.nextPageToken);
  }
  return {
    changes,
    // The loop only ends on a page without nextPageToken, which fetchPage guarantees has a cursor.
    nextCursor: page.nextCursor as string,
    ...resultMetadata(page),
    warnings,
  };
}
