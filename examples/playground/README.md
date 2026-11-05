# calsdk playground

Two in-memory calendars in a browser page: a recurring standup with one occurrence moved, events from both calendars in one week view, and the hours when both are free. No accounts or credentials.

[Open it on StackBlitz](https://stackblitz.com/github/vkpdeveloper/calsdk/tree/main/examples/playground?file=src/main.ts), or run it here:

```sh
bun install
bun run --cwd examples/playground dev
```

Edit `src/main.ts` and the page redraws. To use a real calendar, replace a `mockCalendar(...)` line with `google({ accessToken })` from `@cal-sdk/google` or `microsoft({ accessToken })` from `@cal-sdk/microsoft`, and run it on a server, since tokens shouldn't reach the browser.
