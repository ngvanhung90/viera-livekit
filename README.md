# Viera LiveKit

Your stream. Your rules. A local Windows control room that turns streamer-defined Twitch chat milestones into OBS media and viewer message permissions.

## Current checkpoint — 30 October 2026

This is an **engineering checkpoint, not a completed hackathon submission**. The app and OBS Browser Source have been run locally. The initial original MP4 and its audio were captured in an actual OBS recording. The registered Twitch OAuth app is blocked by Twitch's requirement to enable two-factor authentication on the developer account. **Real Twitch OAuth/EventSub/chat E2E is NOT verified.** Protocol fixtures are explicitly separate from live evidence. The full 12-template pack, final demo and submission remain pending. No claim of submission is made.

## Run locally

Requirements: Windows 10/11, Node.js 22 or newer (tested with 24.15.0), npm, OBS Studio with Browser Source support. No paid service or cloud backend is required.

```sh
npm ci
npm start
```

Open <http://localhost:3210>. To stop, press Ctrl+C in the terminal. Configurations and uploaded media live in `data/`, alongside a stable overlay access key. Keep this folder when updating the app. The last config is backed up as `data/config.json.backup` before saving. Twitch access tokens remain in memory; restart requires authorization again. Viewer progress and entitlements are session-only and reset at restart.

For a separate QA instance, set `PORT` and `LIVEKIT_DATA` before starting. Do not run two processes against the same data directory.

## OBS setup

1. Start LiveKit and copy **OBS Browser Source URL** from the dashboard.
2. In OBS, add one **Browser** source, set the URL and resolution to 1920 × 1080.
3. Enable **Control audio via OBS** and check its mixer volume. Keep the source enabled and do not use multiple copies of the overlay with audio enabled.
4. Click **Preview** or **Trigger on overlay**. A bundled 6-second animated MP4 plays alongside viewer-name text. Preview is visibly labelled and never grants viewer entitlements.
5. Use **STOP ALL** to stop the active job, all queued media, and speech synthesis if present.

The rewards board shows enabled chat rules, exact thresholds, redemption commands, allowed uses, expiry and cooldown. Show/hide and compact controls update the same OBS source.

## Twitch setup

1. Sign into <https://dev.twitch.tv/console/apps>. Twitch requires 2FA enabled on the account to register an application. The account owner must complete their own identity/2FA challenges.
2. Register a **Public** application such as Viera LiveKit in **Broadcaster Suite**. If a redirect URL is requested, use `http://localhost:3210/auth/callback`; this build uses device authorization, not that redirect route.
3. Copy the public client ID into LiveKit and click **Connect Twitch**.
4. Follow the Twitch authorization link, enter the displayed device code and approve **user:read:chat** only. No client secret is required or collected.
5. LiveKit validates the token, connects to EventSub WebSocket and subscribes to `channel.chat.message` for the authenticated streamer's own channel. Connected means the subscription was accepted. It does not by itself prove chat-to-OBS E2E.
6. Send `!wow` in that channel. Only after the event receipt, queue entry and actual OBS playback are verified can the live E2E gate pass.

Device authorization follows [Twitch's OAuth documentation](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow). Keepalive, reconnect transfer and subscription recreation follow [Twitch's WebSocket protocol](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/). Validation runs at connection and hourly while authorized.

## Configure interactions

Choose **Edit**, **Duplicate**, or **+ Add milestone / reward**. Select chat command, dashboard button or F1–F12 while the dashboard has keyboard focus. Set your own threshold and cooldown, choose up to eight simultaneous results, preview, then save. There are no fixed “heart” or gift tiers in the engine.

Results available in the editor: video, audio/recording, image/GIF, plain text, four CSS effects, and a viewer-bound scrolling message entitlement. Uploaded files are copied into local app storage, so the original file is not needed afterwards. Uploads are limited to 100 MB, checked for a supported media signature, and addressed by generated IDs rather than supplied paths. Browser/codec support still matters; MP4 H.264/AAC is the recommended video format.

**Record microphone** uses the browser's real microphone and saves WebM/Opus audio locally. Microphone permission and an actual working device are required. This path is implemented but not yet accepted on a real microphone. No voice cloning is included.

Example: chat command `!heart`, threshold `3`, cooldown `5`, result **Unlock scrolling viewer message**, redemption `!scroll`, uses `1`, expiry `120`. The same viewer must send three eligible messages at least five seconds apart, then `!scroll Your message` within 120 seconds. Another viewer cannot consume that permission. Preview creates no grants.

## Execution and moderation

- One active job with up to 30 pending jobs; all outputs in a job start together. Duration is limited to 1–30 seconds.
- Per-viewer cooldown and a 750 ms chat burst limiter; EventSub delivery IDs are deduplicated for 10 minutes (20,000-ID cap).
- Entitlements are tied to the viewer, rule and event source, have expiry and bounded uses, and are ignored if their rule is disabled/deleted.
- Viewer text is length-limited, stripped of control/bidirectional characters and HTML angle brackets, then rendered with `textContent`. URLs, script/data/file schemes, Windows paths and network paths are rejected. No viewer-supplied resource path is used.
- Binding is to `127.0.0.1`; Host and Origin checks reject browser cross-origin writes. Static routes do not expose `data/`, source files or tokens.
- Logs omit tokens and chat body text. OBS URLs contain a local overlay capability; do not publish your personal runtime URL. Stop LiveKit when not in use.

## Tests and evidence

```sh
npm test
```

Tests cover schema, configurable thresholds, viewer ownership, expiry, uses, cooldown, spam, deduplication, FIFO, STOP ALL, media ranges/upload signatures, persistence and HTTP origin checks. EventSub tests use injected socket/fetch fixtures and **are not live Twitch evidence**. See the sibling `evidence/` directory in the delivered workspace for actual OBS screenshots and capture. The source repository excludes runtime data and QA directories.

## Limits and pending acceptance

- Only Twitch chat commands are supported. Bits, gifted subscriptions, Channel Points, TikTok, YouTube and Facebook are not enabled.
- Only one bundled media interaction exists at this checkpoint. The 12-template/24-variant library is deferred until GATE 1 passes.
- TTS code exists internally as an unverified browser capability; TTS is not offered in the editor or claimed as supported in OBS. No paid TTS API is used.
- No real Twitch events, real viewer reward E2E, microphone acceptance, final YouTube demo, public repository receipt or Devpost Submitted receipt have been obtained yet.
- Clean install tests validate a separate local directory on this host, not a fresh Windows VM.
- This local tool does not capture/broadcast the stream itself. Add the Browser Source to your existing OBS scene; begin a livestream only when you choose to.

## Hackathon build provenance

Created from new source on 30 October 2026 in Codex session `01a189a4-81a1-7080-9b5b-c9b32b86a8b2`, within the contest build period. No source from Chat Builds the Bridge, VIEVOT, VieCore, Shopify or another Viera product was imported. Codex directly authored the local server, engine, Twitch adapter, UI, overlay and automated tests and generated the original sample clip with FFmpeg. Runtime screenshots/recordings must be distinguished from generated sample media.

See `ASSET_LICENSES.md` and `LICENSE` for source/media licensing.
