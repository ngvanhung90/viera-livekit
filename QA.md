# Acceptance scope — 30 October 2026

The production Twitch channel chat was used with the broadcaster's account as the test participant. OBS 33.0.1 captured the actual overlay. No on-air broadcast or paid Twitch event is claimed. Screenshots and runtime event IDs are evidence of the named run, not independent platform certification.

| Check | Result and method |
| --- | --- |
| Clean project install | Initial separate-directory npm ci and test passed on this Windows host; fresh OS VM not tested. Final clean Git clone check is recorded separately in the delivery report. |
| README startup | PASS: npm start, local health endpoint and browser UI |
| Twitch OAuth / EventSub | PASS: public device OAuth, user:read:chat, accepted production channel.chat.message subscription |
| Real chat to OBS | PASS: !wow event queued 67a30869-64f3-44a1-8dcd-abba3ecac18a and obs-browser video playback receipt |
| Earn viewer permission | PASS for one real Twitch identity: three eligible !heart messages, extra inside cooldown ignored; cross-viewer isolation is additionally automated |
| Redeem scrolling text | PASS: production job 71fadb7c-6649-47eb-ae81-41ff55019c8b and actual OBS screenshot |
| Redeem system TTS | PASS: five eligible !cheer messages earned one !speak use; production job e8972843-20af-4efa-be22-23c2a5ea1242 has system-tts playing receipt and recorded audio |
| Upload and play own files | PASS: UI MP4/WAV upload, saved rule, OBS video/audio receipts in job 621ec461-89b3-40e1-9c7e-dc1411b88f09 |
| Queue and cooldown | PASS: two real chat jobs executed FIFO; video and speech started together in c75cae6f-b11a-4637-9156-0473b26cbb02. Preview queue was also stopped through the actual STOP ALL button. |
| Reconnect | PASS: explicit socket disconnect/new subscription followed by real !wow; protocol-directed transfer, revocation and validation races covered by labelled fixtures |
| Duplicate message ID | PASS automated engine fixture; no claim that Twitch was forced to redeliver in the live run |
| Malicious text | PASS live: javascript: payload did not queue speech or spend the earned use; HTML/path/scheme cases also covered by automated tests |
| Restart persistence | PASS: configuration, uploaded bytes and stable OBS URL retained through isolated process restarts; primary app also restarted with its custom rules/media preserved |
| Token-free sample pack | PASS: all 12 templates ran on actual OBS preview while Twitch was disconnected; 24 additional recipes validate against the same engine |
| Fixture labelling | PASS: tests name fixture cases explicitly; runtime previews carry source=preview and a visible PREVIEW label |

## Extra checks and limits

50 Node tests PASS, 0 FAIL, 0 skipped on Windows, including real Windows WAV synthesis. All 12 OBS starter previews completed without media errors. npm audit reported zero known dependency vulnerabilities at the check time.

**Microphone capture: BLOCKED / NOT ACCEPTED.** The browser/device refused or could not supply real microphone input on this host. MediaRecorder and local WebM/Opus upload are implemented, but physical microphone recording is not claimed PASS. Uploaded audio was independently exercised on OBS. The demo does not pretend microphone recording succeeded.

No multi-viewer production session, fresh Windows VM, Bits, gifted subscriptions, Channel Points, other-platform integration or public broadcast was performed. Per-viewer isolation and expiry use deterministic tests in addition to the single-identity production reward path.

See [production event log](evidence/runtime-events.jsonl), [12-template OBS acceptance](evidence/pack-acceptance.json), [test output](evidence/automated-tests.txt), [real OBS video trigger](evidence/obs-twitch-real-wow.png) and [real scrolling reward](evidence/obs-real-viewer-reward.png).
