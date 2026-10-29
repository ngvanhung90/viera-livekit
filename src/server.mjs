import http from "node:http";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  createReadStream,
  appendFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { Engine, validateRule, safeText } from "./engine.mjs";
import { TwitchAdapter } from "./twitch.mjs";
import { LocalSpeech } from "./tts.mjs";
import { templates, recipes } from "./templates.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const VERSION = JSON.parse(
  readFileSync(path.join(ROOT, "package.json")),
).version;
const DATA = process.env.LIVEKIT_DATA
  ? path.resolve(process.env.LIVEKIT_DATA)
  : path.join(ROOT, "data");
mkdirSync(DATA, { recursive: true });
mkdirSync(path.join(DATA, "media"), { recursive: true });
const PORT = Number(process.env.PORT || 3210),
  ORIGIN = `http://localhost:${PORT}`;
const keyFile = path.join(DATA, "overlay-key");
const overlayKey = existsSync(keyFile)
  ? readFileSync(keyFile, "utf8")
  : randomBytes(24).toString("hex");
if (!existsSync(keyFile)) writeFileSync(keyFile, overlayKey, { mode: 0o600 });
const peers = new Set(),
  wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
const log = (type, data = {}) => {
  const row = { at: new Date().toISOString(), type, ...data };
  appendFileSync(path.join(DATA, "events.jsonl"), JSON.stringify(row) + "\n");
};
const bundled = JSON.parse(
  readFileSync(path.join(ROOT, "assets", "manifest.json")),
);
const configFile = path.join(DATA, "config.json");
let config = existsSync(configFile)
  ? JSON.parse(readFileSync(configFile))
  : {
      version: 1,
      clientId:
        process.env.LIVEKIT_CLIENT_ID ?? "iuillny96jy5i6etws4lyub1odbfnj",
      board: { visible: true, compact: false },
      assets: [],
      rules: [
        {
          id: "first-wow",
          name: "Cosmic thank you",
          enabled: true,
          trigger: { type: "chat", command: "!wow" },
          threshold: 1,
          cooldown: 5,
          duration: 6,
          actions: [
            { type: "video", assetId: "cosmic-clip", volume: 0.7 },
            { type: "text", text: "{viewer}, you made the stream shine!" },
          ],
        },
      ],
    };
const allAssets = () => [...bundled, ...config.assets];
config.rules = config.rules.map((r) => validateRule(r, allAssets()));
const persist = () => {
  if (existsSync(configFile))
    writeFileSync(configFile + ".backup", readFileSync(configFile));
  writeFileSync(configFile + ".tmp", JSON.stringify(config, null, 2));
  renameSync(configFile + ".tmp", configFile);
};
persist();
const broadcast = (type, data) => {
  for (const peer of peers)
    if (peer.readyState === 1) peer.send(JSON.stringify({ type, data }));
};
const speech = new LocalSpeech(DATA);
async function deliver(job) {
  try {
    const actions = [];
    for (const action of job.actions) {
      if (engine.active?.id !== job.id) return;
      if (action.type === "tts") {
        const assetId = await speech.generate(action.text);
        actions.push({
          type: "audio",
          assetId,
          volume: action.volume ?? 0.7,
          systemVoice: true,
        });
      } else actions.push(action);
    }
    if (engine.active?.id === job.id) broadcast("play", { ...job, actions });
  } catch {
    log("tts_error", { jobId: job.id });
    engine.finish(job.id, "system_tts_error");
    broadcast("notice", { message: "System TTS failed; check Windows voices" });
  }
}
const engine = new Engine({
  rules: config.rules,
  emit: (type, data) =>
    type === "play" ? void deliver(data) : broadcast(type, data),
  log,
});
const twitch = new TwitchAdapter({
  onChat: (e) => engine.chat(e),
  log,
  onStatus: (s) => broadcast("twitch", s),
});
let deviceFlow = null;
let deviceTimer = null;
let overlayCount = 0;
function state() {
  return {
    version: VERSION,
    config: { ...config, assets: allAssets() },
    engine: engine.state(),
    twitch: twitch.status,
    overlayCount,
    overlayUrl: `${ORIGIN}/overlay?key=${overlayKey}`,
    capabilities: { systemTts: process.platform === "win32" },
  };
}
const json = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
async function body(req, limit = 1e6) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function pollDevice() {
  if (!deviceFlow) return;
  const flow = deviceFlow;
  if (Date.now() > flow.expires) {
    deviceFlow = null;
    return;
  }
  try {
    const r = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        device_code: flow.code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const result = await r.json();
    if (deviceFlow !== flow) return;
    if (r.ok) {
      deviceFlow = null;
      await twitch.start(result.access_token, config.clientId);
      broadcast("state", state());
      return;
    }
    if (result.message === "slow_down") flow.interval += 5;
    if (!["authorization_pending", "slow_down"].includes(result.message)) {
      deviceFlow = null;
      log("oauth_failed", { status: r.status });
      broadcast("oauth", {
        error: "Authorization denied or expired. Connect again.",
      });
      return;
    }
  } catch {
    log("oauth_poll_network_error");
  }
  if (deviceFlow === flow) {
    deviceTimer = setTimeout(pollDevice, flow.interval * 1000);
    deviceTimer.unref?.();
  }
}
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host;
    if (![`localhost:${PORT}`, `127.0.0.1:${PORT}`].includes(host)) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, ORIGIN);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self' ws://localhost:" +
        PORT +
        " ws://127.0.0.1:" +
        PORT +
        "; media-src 'self' blob:; img-src 'self' blob: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'",
    );
    if (req.method === "POST") {
      if (
        req.headers.origin !== ORIGIN &&
        req.headers.origin !== `http://127.0.0.1:${PORT}`
      ) {
        json(res, 403, {
          error: "Open the local LiveKit dashboard to make changes",
        });
        return;
      }
      if (url.pathname === "/api/upload") {
        const bytes = await body(req, 100 * 1024 * 1024);
        const name = safeText(
          decodeURIComponent(req.headers["x-file-name"] || "upload"),
          80,
        );
        const ext = path.extname(name).toLowerCase();
        const type = {
          ".mp4": "video",
          ".webm": "video",
          ".mov": "video",
          ".weba": "audio",
          ".wav": "audio",
          ".mp3": "audio",
          ".ogg": "audio",
          ".m4a": "audio",
          ".png": "image",
          ".jpg": "image",
          ".jpeg": "image",
          ".gif": "image",
          ".webp": "image",
        }[ext];
        if (!type || bytes.length < 12)
          throw new Error("Upload a supported media file");
        const valid =
          ext === ".mp4" || ext === ".mov" || ext === ".m4a"
            ? bytes.subarray(4, 8).toString() === "ftyp"
            : [".webm", ".weba"].includes(ext)
              ? bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
              : ext === ".wav"
                ? bytes.subarray(0, 4).toString() === "RIFF" &&
                  bytes.subarray(8, 12).toString() === "WAVE"
                : ext === ".png"
                  ? bytes
                      .subarray(0, 8)
                      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
                  : [".jpg", ".jpeg"].includes(ext)
                    ? bytes[0] === 255 && bytes[1] === 216
                    : ext === ".gif"
                      ? bytes.subarray(0, 6).toString().startsWith("GIF8")
                      : ext === ".webp"
                        ? bytes.subarray(0, 4).toString() === "RIFF" &&
                          bytes.subarray(8, 12).toString() === "WEBP"
                        : ext === ".ogg"
                          ? bytes.subarray(0, 4).toString() === "OggS"
                          : bytes.subarray(0, 3).toString() === "ID3" ||
                            (bytes[0] === 255 && (bytes[1] & 224) === 224);
        if (!valid)
          throw new Error("File content does not match its media type");
        const id = randomUUID();
        writeFileSync(path.join(DATA, "media", id + ext), bytes);
        const asset = { id, type, name, file: id + ext, custom: true };
        config.assets.push(asset);
        persist();
        broadcast("state", state());
        json(res, 200, asset);
        return;
      }
      const data = JSON.parse((await body(req)).toString() || "{}");
      if (url.pathname === "/api/preview") {
        const rule = data.rule
          ? validateRule(data.rule, allAssets())
          : config.rules.find((r) => r.id === data.id);
        if (!rule) throw new Error("Interaction not found");
        json(res, 200, { queued: engine.preview(rule) });
        return;
      }
      if (url.pathname === "/api/fire") {
        json(res, 200, {
          queued: engine.manual(
            data.id,
            data.source === "hotkey" ? "hotkey" : "button",
          ),
        });
        return;
      }
      if (url.pathname === "/api/stop") {
        speech.stop();
        engine.stop();
        json(res, 200, { stopped: true });
        return;
      }
      if (url.pathname === "/api/rules") {
        const rule = validateRule(data, allAssets());
        const others = config.rules.filter((r) => r.id !== rule.id);
        if (
          rule.actions.some(
            (a) =>
              a.type === "entitlement" && a.command === rule.trigger.command,
          )
        )
          throw new Error(
            "Redemption command must differ from earning command",
          );
        others.push(rule);
        config.rules = others;
        engine.rules = others;
        persist();
        broadcast("state", state());
        json(res, 200, rule);
        return;
      }
      if (url.pathname === "/api/delete") {
        config.rules = config.rules.filter((r) => r.id !== data.id);
        engine.rules = config.rules;
        persist();
        broadcast("state", state());
        json(res, 200, { deleted: true });
        return;
      }
      if (url.pathname === "/api/settings") {
        if (data.clientId !== undefined) {
          if (!/^[a-z0-9]{0,64}$/.test(data.clientId))
            throw new Error("Invalid Twitch client ID");
          if (data.clientId !== config.clientId) twitch.stop();
          config.clientId = data.clientId;
        }
        if (data.board)
          config.board = {
            visible: !!data.board.visible,
            compact: !!data.board.compact,
          };
        persist();
        broadcast("state", state());
        json(res, 200, { saved: true });
        return;
      }
      if (url.pathname === "/api/twitch/connect") {
        if (!config.clientId)
          throw new Error("Enter a Twitch public application client ID first");
        clearTimeout(deviceTimer);
        const r = await fetch("https://id.twitch.tv/oauth2/device", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: config.clientId,
            scopes: "user:read:chat",
          }),
        });
        if (!r.ok)
          throw new Error(
            `Twitch device authorization rejected (${r.status}). Use a public Twitch app.`,
          );
        const d = await r.json();
        deviceFlow = {
          code: d.device_code,
          interval: Math.max(5, d.interval || 5),
          expires: Date.now() + d.expires_in * 1000,
        };
        deviceTimer = setTimeout(pollDevice, deviceFlow.interval * 1000);
        json(res, 200, {
          verificationUri: d.verification_uri,
          userCode: d.user_code,
          expiresIn: d.expires_in,
        });
        return;
      }
      if (url.pathname === "/api/twitch/reconnect") {
        await twitch.reconnect();
        json(res, 200, { reconnecting: true });
        return;
      }
      if (url.pathname === "/api/twitch/disconnect") {
        twitch.stop();
        clearTimeout(deviceTimer);
        deviceFlow = null;
        json(res, 200, { disconnected: true });
        return;
      }
      if (url.pathname === "/api/receipt") {
        if (!["playing", "ended", "error", "tts_ended"].includes(data.type))
          throw new Error("Invalid receipt");
        if (data.jobId !== engine.active?.id)
          throw new Error("Playback no longer active");
        log("overlay_" + data.type, {
          jobId: data.jobId,
          client: "dashboard-preview",
          details: safeText(data.details, 150),
        });
        json(res, 200, { recorded: true });
        return;
      }
      json(res, 404, { error: "Unknown API" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    if (url.pathname === "/api/state") {
      json(res, 200, state());
      return;
    }
    if (url.pathname === "/api/library") {
      json(res, 200, { templates, recipes });
      return;
    }
    if (url.pathname === "/api/health") {
      json(res, 200, { ok: true, app: "Viera LiveKit", version: VERSION });
      return;
    }
    let file;
    if (url.pathname.startsWith("/media/")) {
      const id = url.pathname.slice(7);
      const asset =
        allAssets().find((a) => a.id === id) || speech.assets.get(id);
      if (!asset) {
        res.writeHead(404).end();
        return;
      }
      file =
        asset.target ||
        path.join(
          asset.custom ? path.join(DATA, "media") : path.join(ROOT, "assets"),
          asset.file,
        );
    } else {
      const routes = {
        "/": "index.html",
        "/overlay": "overlay.html",
        "/app.js": "app.js",
        "/overlay.js": "overlay.js",
        "/style.css": "style.css",
        "/overlay.css": "overlay.css",
      };
      const name = routes[url.pathname];
      if (!name) {
        res.writeHead(404).end();
        return;
      }
      file = path.join(ROOT, "public", name);
    }
    const ext = path.extname(file);
    const mime =
      {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".weba": "audio/webm",
        ".mov": "video/quicktime",
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
      }[ext] || "application/octet-stream";
    const size = statSync(file).size;
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Accept-Ranges", "bytes");
    let start = 0,
      end = size - 1;
    if (req.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (!match) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    res.setHeader("Content-Length", end - start + 1);
    if (req.method === "HEAD") res.end();
    else createReadStream(file, { start, end }).pipe(res);
  } catch (e) {
    json(res, 400, {
      error: e.message.startsWith("ENOENT") ? "File not found" : e.message,
    });
  }
});
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, ORIGIN);
  if (
    url.pathname !== "/events" ||
    url.searchParams.get("key") !== overlayKey ||
    !["localhost:" + PORT, "127.0.0.1:" + PORT].includes(req.headers.host)
  ) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    peers.add(ws);
    overlayCount++;
    broadcast("state", state());
    ws.send(JSON.stringify({ type: "state", data: state() }));
    ws.on("message", (raw) => {
      try {
        const m = JSON.parse(raw);
        if (m.jobId !== engine.active?.id) return;
        if (m.type === "receipt") {
          log("overlay_" + safeText(m.event, 30), {
            jobId: m.jobId,
            client: safeText(m.client, 30),
            details: safeText(m.details, 150),
          });
        }
        if (m.type === "done") engine.finish(m.jobId);
      } catch {}
    });
    ws.on("close", () => {
      peers.delete(ws);
      overlayCount--;
      broadcast("state", state());
    });
  });
});
server.listen(PORT, "127.0.0.1", () => {
  log("app_started", { port: PORT });
  console.log(`Viera LiveKit ready: ${ORIGIN}`);
});
process.on("SIGINT", () => {
  speech.stop();
  engine.stop();
  twitch.stop();
  server.close();
  process.exit(0);
});
