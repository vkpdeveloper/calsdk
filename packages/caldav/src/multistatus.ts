import { InvalidResponseDataError } from '@calsdk/provider';
import { DOMParser, type Element } from '@xmldom/xmldom';

export const DAV = 'DAV:';
export const CALDAV = 'urn:ietf:params:xml:ns:caldav';
export const APPLE = 'http://apple.com/ns/ical/';
export const CALENDARSERVER = 'http://calendarserver.org/ns/';
const ELEMENT_NODE = 1;

/** One `<D:response>` of a multistatus. */
export type DavResource = {
  url: URL;
  /** `<D:status>` of the response itself, as sync reports deleted resources with 404. */
  status?: number;
  /** Properties the server returned with status 200. */
  props: Element[];
};

export type Multistatus = { resources: DavResource[]; syncToken?: string };

/** Parses a `207 Multi-Status` body. Hrefs are resolved against the request URL. */
export function parseMultistatus(text: string, base: URL): Multistatus {
  let root: Element | null;
  try {
    root = new DOMParser().parseFromString(text, 'application/xml').documentElement;
  } catch (error) {
    throw invalid(text, error);
  }
  if (!root || root.namespaceURI !== DAV || root.localName !== 'multistatus') throw invalid(text);

  const resources: DavResource[] = [];
  for (const response of children(root, DAV, 'response')) {
    const href = childText(response, DAV, 'href');
    if (href === undefined) continue;
    const props = children(response, DAV, 'propstat').flatMap((propstat) => {
      const prop = children(propstat, DAV, 'prop')[0];
      return prop && statusOf(propstat) === 200 ? elements(prop) : [];
    });
    resources.push({ url: new URL(href, base), status: statusOf(response), props });
  }
  return { resources, syncToken: childText(root, DAV, 'sync-token') };
}

/** A property of a resource, by namespace and local name. */
export function prop(resource: DavResource, namespace: string, name: string): Element | undefined {
  return resource.props.find(
    (element) => element.namespaceURI === namespace && element.localName === name,
  );
}

export function propText(resource: DavResource, namespace: string, name: string) {
  const text = prop(resource, namespace, name)?.textContent?.trim();
  return text ? text : undefined;
}

/** The `<D:href>`s inside a property, such as `calendar-home-set`, resolved against `base`. */
export function propHrefs(resource: DavResource, namespace: string, name: string, base: URL) {
  const element = prop(resource, namespace, name);
  if (!element) return [];
  return children(element, DAV, 'href').flatMap((href) => {
    const text = href.textContent?.trim();
    return text ? [new URL(text, base)] : [];
  });
}

export function children(parent: Element, namespace: string, name: string): Element[] {
  return elements(parent).filter(
    (element) => element.namespaceURI === namespace && element.localName === name,
  );
}

export function elements(parent: Element): Element[] {
  const result: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === ELEMENT_NODE) result.push(node as Element);
  }
  return result;
}

function childText(parent: Element, namespace: string, name: string): string | undefined {
  const text = children(parent, namespace, name)[0]?.textContent?.trim();
  return text ? text : undefined;
}

/** The code of a `<D:status>HTTP/1.1 200 OK</D:status>` child. */
function statusOf(parent: Element): number | undefined {
  const match = /^HTTP\/[\d.]+\s+(\d{3})/.exec(childText(parent, DAV, 'status') ?? '');
  return match ? Number(match[1]) : undefined;
}

function invalid(text: string, cause?: unknown) {
  return new InvalidResponseDataError({
    data: text,
    message: 'The CalDAV server answered without a valid multistatus.',
    cause,
  });
}

/** Escapes text for an XML element or attribute. */
export function xml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
