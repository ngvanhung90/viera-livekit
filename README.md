# Viera LiveKit

**Your stream. Your rules.** A Windows app that turns Twitch chat into streamer-defined OBS media moments and viewer rewards. Built with Codex for the Codex x TwitchCon Hackathon 2026.

## Run

Install Node.js 22 or newer (tested with 24.15.0), then:

```sh
git clone https://github.com/ngvanhung90/viera-livekit.git
cd viera-livekit
npm ci
npm start
```

Open <http://localhost:3210>. You can also double-click `Launch.cmd` after installing Node.js. No FFmpeg, Python, cloud backend, database, paid AI API or subscription is needed to run the shipped app. OBS Studio with Browser Source support is needed for the stream overlay. Windows system TTS requires an installed Windows desktop speech voice.

## Start with a moment

The starter library contains **12 working templates and 24 configurable recipes**, including two original MP4 animations, four original WAV sounds, four original image cards and four CSS effects. Every template can be previewed without Twitch authorization, customized or copied into your own interaction. An overlay must be open in OBS or a browser to receive previews.

1. Open **Set up OBS & Twitch** and copy the OBS URL.
2. Add one OBS Browser Source at 1920 x 1080; enable **Control audio via OBS**.
3. Click a template's **Preview**. Preview is visibly labelled and does not issue viewer entitlements.
4. Choose **Use & customize**, or **+ Add milestone / reward**. Change the trigger, threshold, cooldown and outputs. Preview, then save.
5. Click **Connect Twitch**, open the Twitch device authorization link and approve **user:read:chat**. The app's public client is included; streamers do not need to register their own developer app. No client secret is collected. The Advanced field supports a different public client if desired.
6. Send the configured command in the authenticated streamer's own Twitch channel. Valid chat events run the saved interaction automatically through EventSub WebSocket.

Buttons and F1-F12 are also available. Shortcuts work while the dashboard is focused, rather than globally across Windows. Use one overlay source to avoid duplicate sound. **STOP ALL** stops the active job, pending jobs and active system speech generation.

## Viewer rewards

A rule has a trigger, streamer-defined threshold and one or more results. Results can play video/audio, show images/GIFs, display text, run effects, speak through a Windows system voice or grant a viewer a message action. Multiple results start together in one job.

Example configuration, all editable:

- `!heart`, threshold 3, cooldown 5 seconds: earn one `!scroll your message` use, valid for 120 seconds.
- `!cheer`, threshold 5: earn one `!speak your message` use, valid for 120 seconds.
- `!thanks`, threshold 1: play a selected video, speak a thank-you message and display the viewer's name.

Entitlements belong to the Twitch user who earned them, include allowed uses and expiry, and cannot be consumed through preview or another event source. Deleted or disabled rules cannot redeem. Progress and grants are session-only and reset when the app restarts. There are no fixed gift tiers or platform-specific heart/tap claims.

The **Viewer Rewards Board** uses the same OBS source. It shows only enabled chat rules, the real threshold, cooldown, redemption command, allowed uses and expiry. Show/hide and compact controls update it immediately. Individual progress is available in the local engine state; the public board does not invent a shared progress total.

## Your own content

Upload MP4/WebM/MOV video, WAV/MP3/Ogg/M4A audio, PNG/JPEG/WebP images or GIFs, up to 100 MB each. MP4 H.264/AAC is the recommended video format. Files are copied to app storage and selected by generated IDs, so their original location is no longer needed. Playback stops at the configured maximum duration (1-30 seconds). A job can contain up to eight simultaneous results.

**Record microphone** uses MediaRecorder and saves real browser microphone input locally as WebM/Opus. It needs a working input device and browser permission. On the acceptance host this request was refused/unavailable; **real microphone recording is not accepted or claimed PASS**. The upload-video and upload-audio paths were verified through the browser and OBS. No voice cloning is included. TTS is an offline Windows system voice and is distinct from uploaded/recorded audio.

Rules, uploads and the stable OBS URL persist in `data/`. Keep this folder when updating. A previous config is kept as `data/config.json.backup`. Twitch access tokens are memory-only: after restarting, authorize again. Refresh the OBS Browser Source after upgrading app code. Do not run two processes against one data directory. Use `PORT` and `LIVEKIT_DATA` for isolated QA; `LIVEKIT_CLIENT_ID` can override the initial public client for an isolated install.

## Safety and execution

- One active job and up to 30 queued jobs; per-viewer cooldown and a 750 ms burst limiter.
- EventSub delivery IDs deduplicated for 10 minutes, with a 20,000-ID cap.
- Viewer text uses plain `textContent`, length limits, and removal of HTML delimiters, control and bidi characters. URLs, script/data/file schemes, Windows paths and network paths are rejected before entitlement consumption.
- Viewers cannot choose a media URL or filesystem path. Uploaded file signatures are checked and media routes resolve registered IDs only.
- Server listens on `127.0.0.1`. Host checks and same-origin write checks protect local APIs. No CORS wildcard, HTML from chat, eval, or viewer-authored script is used.
- Twitch access tokens and chat message bodies are omitted from application logs. Private runtime data is excluded from Git. The personal OBS URL contains a local overlay capability; do not publish it.
- Offline system TTS sends bounded text through stdin to one fixed PowerShell helper. Viewer input is never interpolated into a shell command. Generated speech is temporary.

## Acceptance evidence

Verified on 30 October 2026 with OBS 33.0.1:

- Production Twitch OAuth and accepted `channel.chat.message` EventSub subscription.
- Real `!wow` chat to MP4/audio on OBS with the Twitch display name.
- Three eligible chat messages to one scrolling-message entitlement; an extra message inside cooldown did not count; earned message appeared on OBS.
- Five eligible messages to one system-TTS entitlement; a `javascript:` payload was refused without spending the entitlement; valid speech played through OBS; a second use was denied.
- A real disconnect/reconnect created a new EventSub session and subsequent chat still played media.
- A real chat job queued behind another, then video and system speech started together through OBS.
- UI video/audio upload, configuration persistence through restart, all 12 template previews on actual OBS, and STOP ALL returning the queue to zero.

Live tests used the authenticated broadcaster's account as the chat participant. Separate-viewer isolation, duplicate delivery, revocation, keepalive/reconnect protocol cases and expiry are additionally tested with explicitly labelled automated fixtures. These fixtures are not presented as production Twitch events. No on-air broadcast, paid Bits, gifts or subscriptions are claimed.

Run automated checks:

```sh
npm test
```

The acceptance suite has 50 passing Node tests, including isolated HTTP process restarts, media validation, viewer permissions, protocol fixtures and native Windows WAV synthesis. A separate clean project install was tested on the same Windows host; a fresh Windows VM was not tested. Actual OBS recordings and screenshot receipts are retained with the build evidence. See `QA.md` for scope and limits.

## Supported scope

Twitch chat only. Bits, gifted subscriptions and Channel Points are not enabled. TikTok, YouTube and Facebook integrations are not implemented. The app does not start a broadcast; the streamer controls OBS. Samples are original, intentionally lightweight starters. Browser/codec and microphone-device support still apply.

## Codex build provenance

New source created on 30 October 2026 in Codex session **01a189a4-81a1-7080-9b5b-c9b32b86a8b2**, within the contest build period. Codex directly authored the local server, engine, Twitch adapter, interface, overlay, Windows speech helper and tests, generated the original sample assets and operated the acceptance checks. No source from Chat Builds the Bridge, VIEVOT, VieCore, Shopify or another Viera product was imported.

Source and original assets are MIT licensed. See `ASSET_LICENSES.md`. Optional asset rebuild tools are Python/Pillow plus FFmpeg (`scripts/build-pack.py` and `scripts/generate-sample.ps1`); generated assets are already included.
