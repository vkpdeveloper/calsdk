# @cal-sdk/mcp

An MCP server that gives Claude, Cursor or any [Model Context Protocol](https://modelcontextprotocol.io) client your Google Calendar, Outlook, iCloud or CalDAV calendars. The model can list events, find a free slot across every calendar and book, move or cancel meetings. It runs locally and calls the calendar APIs directly, built on [calsdk](https://www.cal-sdk.com).

Try it on two in-memory calendars, no account needed:

```bash
npx -y @cal-sdk/mcp --demo
```

## Tools

- `list_calendars`: calendars on every connected account
- `list_events`: events in a window, recurring events expanded
- `find_free_time`: slots when every chosen calendar is free, across accounts
- `create_event`, `update_event`, `delete_event`: including single occurrences of a series

## Setup

Claude Code:

```bash
claude mcp add calendar \
  -e ICLOUD_APPLE_ID=me@icloud.com -e ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
  -- npx -y @cal-sdk/mcp
```

Claude Desktop, Cursor and other clients:

```json
{
  "mcpServers": {
    "calendar": {
      "command": "npx",
      "args": ["-y", "@cal-sdk/mcp"],
      "env": {
        "GOOGLE_CLIENT_ID": "...",
        "GOOGLE_CLIENT_SECRET": "...",
        "GOOGLE_REFRESH_TOKEN": "..."
      }
    }
  }
}
```

| Calendar | Variables                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (or `GOOGLE_ACCESS_TOKEN`)                                                             |
| Outlook  | `MICROSOFT_CLIENT_ID`, `MICROSOFT_REFRESH_TOKEN`, optional `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT`, `MICROSOFT_SCOPE` (or `MICROSOFT_ACCESS_TOKEN`) |
| iCloud   | `ICLOUD_APPLE_ID`, `ICLOUD_APP_PASSWORD`                                                                                                                  |
| CalDAV   | `CALDAV_URL`, `CALDAV_USERNAME`, `CALDAV_PASSWORD`                                                                                                        |

How to get each token: [cal-sdk.com/docs/guides/mcp](https://www.cal-sdk.com/docs/guides/mcp).

## From code

```ts
import { google } from '@cal-sdk/google';
import { createCalendarServer } from '@cal-sdk/mcp';

const server = createCalendarServer({ work: google({ accessToken: () => getToken() }) });
```

MIT licensed.
