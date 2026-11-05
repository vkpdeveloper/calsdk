# calsdk playground

Two in-memory calendars in a browser page: a recurring standup with one occurrence moved, events from both calendars in one week view, and the hours when both are free. No accounts or credentials.

[Open it on StackBlitz](https://stackblitz.com/github/vkpdeveloper/calsdk/tree/main/examples/playground?file=src/main.ts), or run it from this repo:

```sh
bun install
bun run build
bun run --cwd examples/playground dev
```

Edit `src/main.ts` and the page redraws. Real providers such as `google({ accessToken })` belong in server code, since a token gives full access to someone's calendar: create them behind your own API and have the page call that. The calsdk functions are the same either way.
