import WebSocket from "ws";
const BASE = "wss://eventsub.wss.twitch.tv/ws";
export class TwitchAdapter {
  constructor({
    onChat,
    log,
    onStatus,
    fetchImpl = fetch,
    Socket = WebSocket,
  }) {
    Object.assign(this, { onChat, log, onStatus, fetchImpl, Socket });
    this.status = { connected: false, state: "disconnected", realChats: 0 };
    this.sockets = new Set();
    this.generation = 0;
  }
  set(data) {
    Object.assign(this.status, data);
    this.onStatus(this.status);
  }
  async validate(token, clientId) {
    const r = await this.fetchImpl("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${token}` },
    });
    if (!r.ok) throw new Error("Twitch authorization expired; reconnect");
    const v = await r.json();
    if (v.client_id !== clientId || !v.scopes?.includes("user:read:chat"))
      throw new Error(
        "Twitch token must belong to this app with user:read:chat",
      );
    return v;
  }
  async start(token, clientId) {
    this.stop();
    const v = await this.validate(token, clientId);
    Object.assign(this, { token, clientId, userId: v.user_id, login: v.login });
    this.stopped = false;
    this.attempt = 0;
    this.set({ state: "connecting", login: v.login, connected: false });
    this.connect(BASE, false, this.generation);
    this.validateTimer = setInterval(
      () =>
        this.validate(token, clientId).catch(() => {
          this.stop();
          this.set({ state: "authorization_expired" });
        }),
      3600000,
    );
    this.validateTimer.unref?.();
  }
  connect(url, transferred, generation) {
    if (this.stopped || generation !== this.generation) return;
    const ws = new this.Socket(url);
    this.sockets.add(ws);
    let watchdog;
    const reset = (seconds = 15) => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => ws.terminate(), (seconds + 3) * 1000);
      watchdog.unref?.();
    };
    reset();
    ws.on("message", async (raw) => {
      if (generation !== this.generation) return;
      try {
        const m = JSON.parse(raw);
        reset(this.keepalive || 15);
        const type = m.metadata?.message_type;
        if (type === "session_welcome") {
          this.keepalive = m.payload.session.keepalive_timeout_seconds || 15;
          reset(this.keepalive);
          if (!transferred) {
            const response = await this.fetchImpl(
              "https://api.twitch.tv/helix/eventsub/subscriptions",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${this.token}`,
                  "Client-Id": this.clientId,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  type: "channel.chat.message",
                  version: "1",
                  condition: {
                    broadcaster_user_id: this.userId,
                    user_id: this.userId,
                  },
                  transport: {
                    method: "websocket",
                    session_id: m.payload.session.id,
                  },
                }),
              },
            );
            if (!response.ok)
              throw new Error(
                `EventSub subscription rejected (${response.status})`,
              );
          }
          if (generation !== this.generation) return;
          const old = this.current;
          this.current = ws;
          this.attempt = 0;
          this.set({ connected: true, state: "subscribed" });
          this.log("twitch_subscribed", {
            transport: "EventSub WebSocket",
            transferred,
          });
          if (old && old !== ws) old.close();
        }
        if (type === "session_reconnect") {
          const u = new URL(m.payload.session.reconnect_url);
          if (u.protocol !== "wss:" || u.hostname !== "eventsub.wss.twitch.tv")
            throw new Error("Rejected reconnect host");
          this.connect(u.href, true, generation);
        }
        if (type === "revocation") {
          this.stop();
          this.set({ state: "revoked" });
        }
        if (
          type === "notification" &&
          m.payload.subscription?.type === "channel.chat.message" &&
          m.payload.event?.broadcaster_user_id === this.userId
        ) {
          const e = m.payload.event;
          this.status.realChats++;
          this.onChat({
            id: m.metadata.message_id,
            viewerId: e.chatter_user_id,
            viewer: e.chatter_user_name,
            text: e.message.text,
            source: "twitch-live",
          });
          this.log("twitch_chat_received", { eventId: m.metadata.message_id });
          this.onStatus(this.status);
        }
      } catch (e) {
        this.log("twitch_error", { message: e.message });
        this.set({ state: e.message });
        ws.close();
      }
    });
    ws.on("error", () => this.log("twitch_socket_error", {}));
    ws.on("close", () => {
      clearTimeout(watchdog);
      this.sockets.delete(ws);
      if (
        this.stopped ||
        generation !== this.generation ||
        (this.current && this.current !== ws && this.current.readyState === 1)
      )
        return;
      this.set({ connected: false, state: "reconnecting" });
      clearTimeout(this.retry);
      this.retry = setTimeout(
        () => this.connect(BASE, false, generation),
        Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5)),
      );
      this.retry.unref?.();
    });
  }
  stop() {
    this.stopped = true;
    this.generation++;
    clearInterval(this.validateTimer);
    clearTimeout(this.retry);
    for (const ws of this.sockets) ws.close();
    this.sockets.clear();
    this.current = null;
    this.token = null;
    this.set({ connected: false, state: "disconnected" });
  }
}
