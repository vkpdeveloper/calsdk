import { type CalendarV1, InvalidResponseDataError } from '@calsdk/provider';
import type { Call, DavClient } from './dav-client';
import {
  APPLE,
  CALDAV,
  CALENDARSERVER,
  children,
  DAV,
  type DavResource,
  elements,
  parseMultistatus,
  prop,
  propHrefs,
  propText,
} from './multistatus';

export type Discovery = {
  /** The calendar home: the collection holding the account's calendars. */
  home: URL;
  /** The calendar `'primary'` stands for. */
  primary: URL;
  /** The account's email addresses, from `calendar-user-address-set`. */
  emails: string[];
};

export type DavCalendar = Omit<CalendarV1, 'isPrimary'> & { url: URL };

/**
 * Finds the calendar home from the server address (RFC 4791 and RFC 5397): the address
 * names the principal, and the principal names its calendar home.
 */
export async function discover(client: DavClient, serverUrl: URL, call: Call): Promise<Discovery> {
  const root = await propfind(client, serverUrl, '0', call, [
    '<D:current-user-principal/>',
    '<C:calendar-home-set/>',
  ]);
  const principalUrl = first(root, (resource) =>
    propHrefs(resource, DAV, 'current-user-principal', serverUrl),
  );
  const principal = principalUrl
    ? await propfind(client, principalUrl, '0', call, [
        '<C:calendar-home-set/>',
        '<C:calendar-user-address-set/>',
        '<C:schedule-inbox-URL/>',
      ])
    : root;
  const base = principalUrl ?? serverUrl;
  const home = first(principal, (resource) =>
    propHrefs(resource, CALDAV, 'calendar-home-set', base),
  );
  if (!home) {
    throw new InvalidResponseDataError({
      data: principalUrl?.href ?? serverUrl.href,
      message: 'The CalDAV server reported no calendar home for this account.',
    });
  }
  // iCloud keeps calendars on a host of their own. Credentials may go there over HTTPS.
  if (home.protocol === 'https:' || home.origin === serverUrl.origin) client.trust(home.origin);

  const emails = principal
    .flatMap((resource) => propHrefs(resource, CALDAV, 'calendar-user-address-set', base))
    .flatMap((url) => (url.protocol === 'mailto:' ? [decodeURIComponent(url.pathname)] : []));
  const inbox = first(principal, (resource) =>
    propHrefs(resource, CALDAV, 'schedule-inbox-URL', base),
  );

  const calendars = await listDavCalendars(client, home, call);
  const preferred = inbox && (await defaultCalendar(client, inbox, call));
  const primary =
    calendars.find((calendar) => calendar.url.pathname === preferred?.pathname) ?? calendars[0];
  if (!primary) {
    throw new InvalidResponseDataError({
      data: home.href,
      message: 'The CalDAV account has no calendar for events.',
    });
  }
  return { home, primary: primary.url, emails };
}

/** The calendars in a calendar home that hold events. Task lists are left out. */
export async function listDavCalendars(
  client: DavClient,
  home: URL,
  call: Call,
): Promise<DavCalendar[]> {
  const resources = await propfind(client, home, '1', call, [
    '<D:resourcetype/>',
    '<D:displayname/>',
    '<D:current-user-privilege-set/>',
    '<C:calendar-description/>',
    '<C:supported-calendar-component-set/>',
    '<A:calendar-color/>',
    '<CS:shared-url/>',
  ]);
  return resources.flatMap((resource): DavCalendar[] => {
    const type = prop(resource, DAV, 'resourcetype');
    if (!type || children(type, CALDAV, 'calendar').length === 0) return [];
    // Without the property, a calendar may hold any component.
    const components = prop(resource, CALDAV, 'supported-calendar-component-set');
    if (
      components &&
      !children(components, CALDAV, 'comp').some(
        (comp) => comp.getAttribute('name')?.toUpperCase() === 'VEVENT',
      )
    ) {
      return [];
    }
    const url = withSlash(resource.url);
    const name = propText(resource, DAV, 'displayname');
    const color = /^#[0-9a-f]{6}/i.exec(propText(resource, APPLE, 'calendar-color') ?? '')?.[0];
    return [
      {
        id: url.pathname,
        url,
        name: name ?? decodeURIComponent(url.pathname.split('/').at(-2) ?? ''),
        description: propText(resource, CALDAV, 'calendar-description'),
        color: color?.toUpperCase(),
        accessRole: accessRoleOf(resource),
      },
    ];
  });
}

function accessRoleOf(resource: DavResource): CalendarV1['accessRole'] {
  const set = prop(resource, DAV, 'current-user-privilege-set');
  // Servers that do not report privileges are the account's own calendars.
  if (!set) return 'owner';
  const privileges = new Set(
    children(set, DAV, 'privilege').flatMap((privilege) =>
      elements(privilege).flatMap((element) =>
        element.namespaceURI === DAV ? [element.localName] : [],
      ),
    ),
  );
  if (privileges.has('all')) return 'owner';
  if (!privileges.has('write') && !privileges.has('write-content')) return 'reader';
  // Calendar servers (iCloud among them) mark calendars others shared with the account.
  return prop(resource, CALENDARSERVER, 'shared-url') ? 'writer' : 'owner';
}

/** The default calendar for invitations (RFC 6638), when the server names one. */
async function defaultCalendar(client: DavClient, inbox: URL, call: Call) {
  const response = await client.request({
    method: 'PROPFIND',
    url: inbox,
    depth: '0',
    call,
    body: propfindBody(['<C:schedule-default-calendar-URL/>']),
    allow: [403, 404],
  });
  if (response.status !== 207) return undefined;
  const { resources } = parseMultistatus(response.text, response.url);
  return first(resources, (resource) =>
    propHrefs(resource, CALDAV, 'schedule-default-calendar-URL', response.url),
  );
}

async function propfind(
  client: DavClient,
  url: URL,
  depth: '0' | '1',
  call: Call,
  props: string[],
): Promise<DavResource[]> {
  const response = await client.request({
    method: 'PROPFIND',
    url,
    depth,
    call,
    body: propfindBody(props),
  });
  return parseMultistatus(response.text, response.url).resources;
}

const propfindBody = (props: string[]) =>
  `<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="${DAV}" xmlns:C="${CALDAV}" xmlns:A="${APPLE}" xmlns:CS="${CALENDARSERVER}"><D:prop>${props.join('')}</D:prop></D:propfind>`;

function first(resources: DavResource[], read: (resource: DavResource) => URL[]) {
  for (const resource of resources) {
    const url = read(resource)[0];
    if (url) return url;
  }
  return undefined;
}

export function withSlash(url: URL): URL {
  return url.pathname.endsWith('/') ? url : new URL(`${url.pathname}/`, url);
}
