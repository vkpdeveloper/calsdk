# Booking page with calsdk and Next.js

A one-person booking page: visitors see your free times from Google Calendar, pick one, and get an invite with a Meet link. Without credentials it runs on a demo calendar, so you can deploy it first and connect your calendar later.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvkpdeveloper%2Fcalsdk%2Ftree%2Fmain%2Fexamples%2Fnextjs-booking&project-name=booking-page&repository-name=booking-page)

## How it works

- `lib/slots.ts` asks `findFreeTime` for open slots in your working hours over the next 14 days.
- `app/actions.ts` checks the slot is still free, then books it with `createEvent` and emails the invite.
- `lib/calendar.ts` picks Google Calendar when credentials are set, and a demo calendar otherwise.

Swapping `google()` for `microsoft()` or `icloud()` from calsdk is the only change needed for Outlook or iCloud.

## Connect your Google Calendar

1. In the Google Cloud console, enable the Google Calendar API and create an OAuth client of type "Web application" with `https://developers.google.com/oauthplayground` as a redirect URI.
2. Open the [OAuth Playground](https://developers.google.com/oauthplayground), tick "Use your own OAuth credentials" in the settings, authorize the `https://www.googleapis.com/auth/calendar` scope and exchange the code for a refresh token.
3. Publish the OAuth app (it can stay unverified for your own account). While it is in "Testing", Google expires refresh tokens after 7 days.
4. Set these environment variables in Vercel, or in `.env.local` when running locally:

| Variable               | Value                                                     |
| ---------------------- | --------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | OAuth client ID                                           |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret                                       |
| `GOOGLE_REFRESH_TOKEN` | Refresh token from step 2                                 |
| `BOOKING_OWNER`        | Your name, shown on the page                              |
| `BOOKING_TITLE`        | Meeting name, such as `Intro call`                        |
| `BOOKING_TIME_ZONE`    | IANA zone for your working hours, such as `Europe/Berlin` |

Meeting length, days ahead and working hours live in `lib/config.ts`.

## Run it locally

```sh
cp .env.example .env.local
npm install
npm run dev
```

From the calsdk repo, run `bun install`, `bun run build` and then `bun run --cwd examples/nextjs-booking dev` instead.
