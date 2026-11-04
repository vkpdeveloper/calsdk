/** Any value that survives a `JSON.stringify` / `JSON.parse` round-trip unchanged. */
export type JSONValue = null | string | number | boolean | JSONObject | JSONArray;

export type JSONObject = { [key: string]: JSONValue | undefined };

export type JSONArray = JSONValue[];
