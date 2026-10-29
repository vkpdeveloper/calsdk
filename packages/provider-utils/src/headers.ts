/**
 * Merges header records left to right. Names are compared case-insensitively and lower-cased
 * in the result, later values win and `undefined` values are dropped.
 */
export function combineHeaders(
  ...headers: (Record<string, string | undefined> | undefined)[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const record of headers) {
    if (record == null) continue;
    for (const [key, value] of Object.entries(record)) {
      if (value !== undefined) result[key.toLowerCase()] = value;
    }
  }
  return result;
}

/**
 * Appends `suffix` to the `user-agent` header, e.g. `calsdk-google/1.0.0`.
 * Header names are matched case-insensitively.
 */
export function withUserAgentSuffix(
  headers: Record<string, string>,
  ...suffix: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  let userAgent: string | undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'user-agent') userAgent = value;
    else result[key] = value;
  }
  result['user-agent'] = [userAgent, ...suffix].filter(Boolean).join(' ');
  return result;
}
