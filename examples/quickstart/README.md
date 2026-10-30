# calsdk quickstart

A tour of calsdk on an in-memory calendar: list calendars, create a recurring event, list a week, move one occurrence, find free time, sync changes and handle a deleted event. It runs offline with no credentials.

```sh
bun install
bun run --cwd examples/quickstart start
```

To use a real calendar, replace the mock with `google({ accessToken })` from `@calsdk/google` or `microsoft({ accessToken })` from `@calsdk/microsoft`. The rest of the code stays the same.
