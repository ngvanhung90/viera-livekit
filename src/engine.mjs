import { randomUUID } from "node:crypto";

export function safeText(value, max = 200) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/g, "")
    .slice(0, max)
    .trim();
}
export function viewerText(value) {
  const text = safeText(value);
  if (
    !text ||
    /(?:https?:|www\.|file:|javascript:|data:|[a-z]:\\|\\\\)/i.test(text)
  )
    throw new Error("Message blocked: links and file paths are not allowed");
  return text;
}
export function validateRule(r, assets) {
  if (!r || typeof r !== "object") throw new Error("Invalid interaction");
  const id = /^[\w-]{1,80}$/.test(r.id || "") ? r.id : randomUUID();
  const name = safeText(r.name, 80);
  if (!name) throw new Error("Name is required");
  const trigger = r.trigger;
  if (!["chat", "button", "hotkey"].includes(trigger?.type))
    throw new Error("Unsupported trigger");
  const command = String(trigger.command || "")
    .trim()
    .toLowerCase();
  if (trigger.type === "chat" && !/^![a-z0-9_]{1,30}$/.test(command))
    throw new Error("Use a chat command such as !wow");
  if (
    trigger.type === "hotkey" &&
    !/^F(?:[1-9]|1[0-2])$/.test(trigger.key || "")
  )
    throw new Error("Use F1 to F12");
  const threshold = Number(r.threshold ?? 1),
    cooldown = Number(r.cooldown ?? 5),
    duration = Number(r.duration ?? 6);
  if (
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > 10000 ||
    !Number.isFinite(cooldown) ||
    cooldown < 1 ||
    cooldown > 3600 ||
    !Number.isFinite(duration) ||
    duration < 1 ||
    duration > 30
  )
    throw new Error("Invalid threshold, cooldown, or duration");
  if (!Array.isArray(r.actions) || !r.actions.length || r.actions.length > 8)
    throw new Error("Choose 1 to 8 results");
  const actions = r.actions.map((a) => {
    if (
      ![
        "video",
        "audio",
        "image",
        "effect",
        "text",
        "tts",
        "entitlement",
      ].includes(a.type)
    )
      throw new Error("Unsupported result");
    if (
      ["video", "audio", "image"].includes(a.type) &&
      !assets.some((x) => x.id === a.assetId && x.type === a.type)
    )
      throw new Error("Choose an uploaded or bundled media file");
    if (
      a.type === "effect" &&
      !["confetti", "pulse", "stars", "hearts"].includes(a.effect)
    )
      throw new Error("Unknown effect");
    if (a.type === "entitlement") {
      if (
        !/^![a-z0-9_]{1,30}$/.test(a.command || "") ||
        !["text", "tts"].includes(a.result)
      )
        throw new Error("Invalid entitlement command");
      if (
        ![a.uses, a.ttl].every(Number.isInteger) ||
        a.uses < 1 ||
        a.uses > 20 ||
        a.ttl < 10 ||
        a.ttl > 3600
      )
        throw new Error("Invalid entitlement limits");
      return {
        type: a.type,
        command: a.command,
        result: a.result,
        uses: a.uses,
        ttl: a.ttl,
      };
    }
    return {
      type: a.type,
      assetId: a.assetId,
      effect: a.effect,
      text: safeText(a.text || "{viewer}, thank you!"),
      volume: Math.max(
        0,
        Math.min(1, Number.isFinite(a.volume) ? a.volume : 0.7),
      ),
    };
  });
  return {
    id,
    name,
    enabled: r.enabled !== false,
    trigger: {
      type: trigger.type,
      ...(trigger.type === "chat"
        ? { command }
        : trigger.type === "hotkey"
          ? { key: trigger.key }
          : {}),
    },
    threshold,
    cooldown,
    duration,
    actions,
  };
}

export class Engine {
  constructor({
    rules = [],
    clock = Date.now,
    emit = () => {},
    log = () => {},
  } = {}) {
    Object.assign(this, { rules, clock, emit, log });
    this.counts = new Map();
    this.grants = new Map();
    this.cooldowns = new Map();
    this.seen = new Map();
    this.queue = [];
    this.active = null;
    this.timer = null;
    this.spam = new Map();
  }
  record(type, data = {}) {
    this.log(type, data);
  }
  state() {
    return {
      active: this.active,
      queued: this.queue.length,
      progress: [...this.counts].map(([key, count]) => ({ key, count })),
      entitlements: [...this.grants]
        .filter(([, g]) => g.expires > this.clock() && g.uses > 0)
        .map(([key, g]) => ({ key, ...g })),
    };
  }
  enqueue(rule, viewer, source, message = "") {
    if (this.queue.length >= 30) {
      this.record("queue_rejected", { reason: "full" });
      return false;
    }
    const job = {
      id: randomUUID(),
      ruleId: rule.id,
      name: rule.name,
      viewer: safeText(viewer, 50),
      source,
      duration: rule.duration,
      actions: rule.actions
        .filter((a) => a.type !== "entitlement")
        .map((a) => ({
          ...a,
          text: (message || a.text || "").replaceAll(
            "{viewer}",
            safeText(viewer, 50),
          ),
        })),
    };
    if (!job.actions.length) return true;
    this.queue.push(job);
    this.record("queued", { jobId: job.id, ruleId: rule.id, source });
    this.next();
    return true;
  }
  next() {
    if (this.active || !this.queue.length) return;
    this.active = this.queue.shift();
    this.emit("play", this.active);
    this.timer = setTimeout(
      () => this.finish(this.active?.id, "timeout"),
      (this.active.duration + 4) * 1000,
    );
    this.timer.unref?.();
  }
  finish(id, reason = "ended") {
    if (!this.active || this.active.id !== id) return;
    clearTimeout(this.timer);
    this.record("playback_finished", { jobId: id, reason });
    this.active = null;
    this.emit("state", this.state());
    this.next();
  }
  stop() {
    clearTimeout(this.timer);
    this.queue = [];
    this.active = null;
    this.emit("stop", {});
    this.record("stop_all");
  }
  preview(rule, viewer = "Streamer") {
    return this.enqueue(rule, viewer, "preview");
  }
  manual(id, source = "button") {
    const r = this.rules.find((r) => r.id === id && r.enabled);
    if (!r) return false;
    const key = `manual:${id}`;
    if ((this.cooldowns.get(key) || 0) > this.clock()) return false;
    if (!this.enqueue(r, "Streamer", source)) return false;
    this.cooldowns.set(key, this.clock() + r.cooldown * 1000);
    return true;
  }
  chat({ id, viewerId, viewer, text, source = "twitch-live" }) {
    if (!id || !viewerId || typeof text !== "string" || text.length > 1000)
      return { accepted: false, reason: "invalid" };
    const now = this.clock();
    for (const [key, ts] of this.seen)
      if (now - ts > 600000) this.seen.delete(key);
    if (this.seen.has(id)) return { accepted: false, reason: "duplicate" };
    this.seen.set(id, now);
    if (this.seen.size > 20000) this.seen.delete(this.seen.keys().next().value);
    const spamKey = `${source}:${viewerId}`;
    if ((this.spam.get(spamKey) || 0) + 750 > now)
      return { accepted: false, reason: "rate_limit" };
    this.spam.set(spamKey, now);
    if (this.spam.size > 20000) this.spam.delete(this.spam.keys().next().value);
    const [command, ...words] = text.trim().split(/\s+/);
    const cmd = command.toLowerCase();
    let matched = false;
    for (const [key, g] of this.grants) {
      if (g.expires <= now || g.uses <= 0) {
        this.grants.delete(key);
        continue;
      }
      if (g.viewerId !== viewerId || g.source !== source || g.command !== cmd)
        continue;
      const owner = this.rules.find((r) => r.id === g.ruleId && r.enabled);
      if (!owner) continue;
      if ((this.cooldowns.get(key) || 0) > now)
        return { accepted: false, reason: "cooldown" };
      let message;
      try {
        message = viewerText(words.join(" "));
      } catch {
        return { accepted: false, reason: "blocked_text" };
      }
      if (
        !this.enqueue(
          {
            ...owner,
            actions: [{ type: g.result, text: message, volume: 0.7 }],
          },
          viewer,
          source,
          message,
        )
      )
        return { accepted: false, reason: "queue_full" };
      g.uses--;
      this.cooldowns.set(key, now + owner.cooldown * 1000);
      this.emit("state", this.state());
      return { accepted: true, reason: "redeemed" };
    }
    for (const r of this.rules.filter(
      (r) =>
        r.enabled && r.trigger.type === "chat" && r.trigger.command === cmd,
    )) {
      const key = `${source}:${r.id}:${viewerId}`;
      if ((this.cooldowns.get(key) || 0) > now) continue;
      const count = (this.counts.get(key) || 0) + 1;
      this.counts.set(key, count);
      matched = true;
      this.cooldowns.set(key, now + r.cooldown * 1000);
      if (count >= r.threshold) {
        if (this.queue.length >= 30) {
          this.counts.set(key, count - 1);
          continue;
        }
        this.counts.set(key, 0);
        for (const a of r.actions.filter((a) => a.type === "entitlement"))
          this.grants.set(`${key}:${a.command}`, {
            viewerId,
            viewer: safeText(viewer, 50),
            source,
            ruleId: r.id,
            command: a.command,
            result: a.result,
            uses: a.uses,
            expires: now + a.ttl * 1000,
          });
        this.enqueue(r, viewer, source);
        this.record("threshold_reached", { ruleId: r.id, source });
      }
    }
    this.emit("state", this.state());
    return { accepted: matched, reason: matched ? "counted" : "no_match" };
  }
}
