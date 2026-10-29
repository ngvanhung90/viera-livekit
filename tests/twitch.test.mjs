import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { TwitchAdapter } from "../src/twitch.mjs";
// Protocol fixtures only: these tests do not create Twitch live E2E evidence.
class Socket extends EventEmitter {
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 1;
    Socket.instances.push(this);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close");
  }
  terminate() {
    this.close();
  }
  receive(message) {
    this.emit("message", JSON.stringify(message));
  }
}
const tick = () => new Promise((r) => setImmediate(r));
function setup({
  scopes = ["user:read:chat"],
  client = "client",
  subStatus = 202,
} = {}) {
  Socket.instances = [];
  const requests = [],
    chats = [],
    statuses = [],
    logs = [];
  const adapter = new TwitchAdapter({
    Socket,
    onChat: (e) => chats.push(e),
    log: (type, data) => logs.push({ type, data }),
    onStatus: (s) => statuses.push({ ...s }),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.includes("/validate"))
        return {
          ok: true,
          json: async () => ({
            client_id: client,
            user_id: "123",
            login: "fixture_streamer",
            scopes,
          }),
        };
      return {
        ok: subStatus === 202,
        status: subStatus,
        json: async () => ({ data: [] }),
      };
    },
  });
  return { adapter, requests, chats, statuses, logs };
}
const welcome = (id) => ({
  metadata: { message_type: "session_welcome" },
  payload: { session: { id, keepalive_timeout_seconds: 10 } },
});
test("fixture: subscribes to chat on the authenticated broadcaster only", async () => {
  const x = setup();
  try {
    await x.adapter.start("FIXTURE_TOKEN", "client");
    Socket.instances[0].receive(welcome("session"));
    await tick();
    const request = x.requests.find((r) => r.url.includes("/subscriptions"));
    const body = JSON.parse(request.options.body);
    assert.deepEqual(body.condition, {
      broadcaster_user_id: "123",
      user_id: "123",
    });
    assert.equal(body.type, "channel.chat.message");
    assert.equal(x.adapter.status.connected, true);
  } finally {
    x.adapter.stop();
  }
});
test("fixture: refuses wrong client ID and missing chat scope", async () => {
  for (const options of [{ client: "other" }, { scopes: [] }]) {
    const x = setup(options);
    try {
      await assert.rejects(x.adapter.start("FIXTURE_TOKEN", "client"));
      assert.equal(Socket.instances.length, 0);
    } finally {
      x.adapter.stop();
    }
  }
});
test("fixture: subscription rejection never reports connected", async () => {
  const x = setup({ subStatus: 403 });
  try {
    await x.adapter.start("FIXTURE_TOKEN", "client");
    Socket.instances[0].receive(welcome("s"));
    await tick();
    assert.equal(x.adapter.status.connected, false);
    assert.ok(x.logs.some((l) => l.type === "twitch_error"));
  } finally {
    x.adapter.stop();
  }
});
test("fixture: channel and subscription type are checked before delivering chat", async () => {
  const x = setup();
  try {
    await x.adapter.start("FIXTURE_TOKEN", "client");
    const socket = Socket.instances[0];
    socket.receive(welcome("s"));
    await tick();
    const packet = {
      metadata: { message_type: "notification", message_id: "one" },
      payload: {
        subscription: { type: "channel.chat.message" },
        event: {
          broadcaster_user_id: "other",
          chatter_user_id: "viewer",
          chatter_user_name: "Viewer",
          message: { text: "!wow" },
        },
      },
    };
    socket.receive(packet);
    assert.equal(x.chats.length, 0);
    packet.payload.event.broadcaster_user_id = "123";
    socket.receive(packet);
    assert.equal(x.chats.length, 1);
    assert.equal(x.chats[0].id, "one");
  } finally {
    x.adapter.stop();
  }
});
test("fixture: Twitch-directed reconnect preserves subscription without recreating it", async () => {
  const x = setup();
  try {
    await x.adapter.start("FIXTURE_TOKEN", "client");
    Socket.instances[0].receive(welcome("first"));
    await tick();
    Socket.instances[0].receive({
      metadata: { message_type: "session_reconnect" },
      payload: {
        session: {
          reconnect_url: "wss://eventsub.wss.twitch.tv/ws?fixture=transfer",
        },
      },
    });
    Socket.instances[1].receive(welcome("second"));
    await tick();
    assert.equal(
      x.requests.filter((r) => r.url.includes("/subscriptions")).length,
      1,
    );
    assert.equal(Socket.instances[0].readyState, 3);
    assert.equal(x.adapter.status.connected, true);
  } finally {
    x.adapter.stop();
  }
});
test("fixture: arbitrary reconnect hosts are rejected", async () => {
  const x = setup();
  try {
    await x.adapter.start("FIXTURE_TOKEN", "client");
    Socket.instances[0].receive({
      metadata: { message_type: "session_reconnect" },
      payload: { session: { reconnect_url: "wss://evil.invalid/steal" } },
    });
    await tick();
    assert.equal(Socket.instances.length, 1);
    assert.ok(
      x.logs.some((l) => l.data?.message === "Rejected reconnect host"),
    );
  } finally {
    x.adapter.stop();
  }
});
test("fixture: revoked authorization stops all sockets and clears token", async () => {
  const x = setup();
  try {
    await x.adapter.start("FIXTURE_TOKEN", "client");
    Socket.instances[0].receive({
      metadata: { message_type: "revocation" },
      payload: {},
    });
    assert.equal(x.adapter.token, null);
    assert.equal(x.adapter.status.state, "revoked");
    assert.equal(x.adapter.sockets.size, 0);
  } finally {
    x.adapter.stop();
  }
});
test("fixture: logs never include access token or chat contents", async () => {
  const x = setup();
  try {
    await x.adapter.start("FIXTURE_TOKEN", "client");
    Socket.instances[0].receive(welcome("s"));
    await tick();
    assert.ok(!JSON.stringify(x.logs).includes("FIXTURE_TOKEN"));
  } finally {
    x.adapter.stop();
  }
});
