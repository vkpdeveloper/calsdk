# calsdk AI agent example

A scheduling agent built with the [AI SDK](https://ai-sdk.dev): it reads a calendar, finds a free hour and books it, through three small tools in [`src/index.ts`](src/index.ts).

```bash
bun install
bun run build          # from the repo root, once
export ANTHROPIC_API_KEY=...
bun run start          # in this folder
bun run start "What does my Thursday look like?"
```

Without `GOOGLE_ACCESS_TOKEN` it runs on an in-memory calendar with a busy tomorrow. Set the token to use your real Google Calendar.

Guide: [cal-sdk.com/docs/guides/ai-sdk](https://www.cal-sdk.com/docs/guides/ai-sdk)
