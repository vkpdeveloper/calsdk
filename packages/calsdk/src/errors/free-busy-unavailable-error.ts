import { CalsdkError } from '@calsdk/provider';

const name = 'FreeBusyUnavailableError';
const marker = `calsdk.error.${name}`;
const symbol = Symbol.for(marker);

/**
 * `findFreeTime` could not read one of the calendars, so it cannot know when everyone
 * is free. The default message leaves out `calendarId`, which is often an email address.
 */
export class FreeBusyUnavailableError extends CalsdkError {
  private readonly [symbol] = true;

  readonly provider: string;
  readonly calendarId: string;

  constructor({
    provider,
    calendarId,
    reason,
  }: {
    provider: string;
    calendarId: string;
    reason: string;
  }) {
    super({
      name,
      message: `Could not read the free/busy times of a calendar on provider "${provider}": ${reason}`,
    });
    this.provider = provider;
    this.calendarId = calendarId;
  }

  static override isInstance(error: unknown): error is FreeBusyUnavailableError {
    return CalsdkError.hasMarker(error, marker);
  }
}
