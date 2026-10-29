import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DATA = path.join(ROOT, "work", "qa-" + randomUUID());
mkdirSync(DATA, { recursive: true });
const origin = "http://localhost:13210";
let child;
async function start() {
  child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: "13210",
      LIVEKIT_DATA: DATA,
      LIVEKIT_CLIENT_ID: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(origin + "/api/health");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("QA server did not start: " + err);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = once(child, "exit");
  child.kill();
  await done;
}
async function post(route, data, otherOrigin = origin) {
  const r = await fetch(origin + route, {
    method: "POST",
    headers: { Origin: otherOrigin, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return { status: r.status, data: await r.json() };
}
test("isolated HTTP application checks (no Twitch credentials)", async (t) => {
  await start();
  try {
    await t.test(
      "starts with a playable bundled MP4 and no token",
      async () => {
        const s = await (await fetch(origin + "/api/state")).json();
        assert.equal(s.twitch.connected, false);
        const r = await fetch(origin + "/media/cosmic-clip");
        const b = Buffer.from(await r.arrayBuffer());
        assert.equal(r.headers.get("content-type"), "video/mp4");
        assert.equal(b.subarray(4, 8).toString(), "ftyp");
        assert.ok(b.length > 10000);
      },
    );
    await t.test("OBS can request media byte ranges and HEAD", async () => {
      const r = await fetch(origin + "/media/cosmic-clip", {
        headers: { Range: "bytes=0-99" },
      });
      assert.equal(r.status, 206);
      assert.equal((await r.arrayBuffer()).byteLength, 100);
      const head = await fetch(origin + "/media/cosmic-clip", {
        method: "HEAD",
      });
      assert.ok(Number(head.headers.get("content-length")) > 10000);
    });
    await t.test("invalid range returns 416 instead of crashing", async () => {
      assert.equal(
        (
          await fetch(origin + "/media/cosmic-clip", {
            headers: { Range: "bytes=999999999-" },
          })
        ).status,
        416,
      );
    });
    await t.test("cross-origin writes are blocked", async () => {
      assert.equal(
        (await post("/api/stop", {}, "https://attacker.invalid")).status,
        403,
      );
    });
    await t.test(
      "private config and source code are not static routes",
      async () => {
        for (const p of [
          "/data/config.json",
          "/src/server.mjs",
          "/.env",
          "/assets/../src/server.mjs",
        ])
          assert.equal((await fetch(origin + p)).status, 404);
      },
    );
    await t.test("a fake media file is rejected by its signature", async () => {
      const r = await fetch(origin + "/api/upload", {
        method: "POST",
        headers: { Origin: origin, "X-File-Name": "evil.mp4" },
        body: Buffer.from("<script>alert(1)</script>"),
      });
      assert.equal(r.status, 400);
    });
    let asset;
    await t.test(
      "upload stores original media under a generated ID",
      async () => {
        const bytes = readFileSync(path.join(ROOT, "assets/cosmic-thanks.mp4"));
        const r = await fetch(origin + "/api/upload", {
          method: "POST",
          headers: { Origin: origin, "X-File-Name": "my-video.mp4" },
          body: bytes,
        });
        assert.equal(r.status, 200);
        asset = await r.json();
        assert.equal(asset.type, "video");
        const stored = Buffer.from(
          await (await fetch(origin + "/media/" + asset.id)).arrayBuffer(),
        );
        assert.deepEqual(stored, bytes);
      },
    );
    let id;
    await t.test(
      "streamer can save custom multi-output rules without JSON editing",
      async () => {
        const result = await post("/api/rules", {
          name: "Custom upload",
          trigger: { type: "chat", command: "!custom" },
          threshold: 7,
          cooldown: 2,
          duration: 6,
          actions: [
            { type: "video", assetId: asset.id },
            { type: "text", text: "Thank you {viewer}" },
          ],
        });
        assert.equal(result.status, 200);
        id = result.data.id;
      },
    );
    await t.test("unsupported Twitch events are refused", async () => {
      assert.equal(
        (
          await post("/api/rules", {
            name: "Unsupported",
            trigger: { type: "bits" },
            actions: [{ type: "text" }],
          })
        ).status,
        400,
      );
    });
    await t.test(
      "configuration, media and OBS URL survive process restart",
      async () => {
        const before = await (await fetch(origin + "/api/state")).json();
        await stop();
        await start();
        const after = await (await fetch(origin + "/api/state")).json();
        assert.equal(after.overlayUrl, before.overlayUrl);
        assert.deepEqual(after.config, before.config);
        assert.equal((await fetch(origin + "/media/" + asset.id)).status, 200);
      },
    );
    await t.test(
      "delete updates configuration and preserves a rollback copy",
      async () => {
        assert.equal((await post("/api/delete", { id })).status, 200);
        assert.ok(existsSync(path.join(DATA, "config.json.backup")));
        assert.ok(
          JSON.parse(
            readFileSync(path.join(DATA, "config.json.backup")),
          ).rules.some((r) => r.id === id),
        );
      },
    );
    await t.test("OAuth requires registered public client ID", async () => {
      assert.equal((await post("/api/twitch/connect", {})).status, 400);
    });
    await t.test("STOP ALL works without Twitch", async () => {
      await post("/api/preview", { id: "first-wow" });
      await post("/api/stop", {});
      const s = await (await fetch(origin + "/api/state")).json();
      assert.equal(s.engine.active, null);
      assert.equal(s.engine.queued, 0);
    });
  } finally {
    await stop();
  }
});
