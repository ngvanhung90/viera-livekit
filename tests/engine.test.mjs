import test from "node:test";
import assert from "node:assert/strict";
import { Engine, validateRule, safeText, viewerText } from "../src/engine.mjs";
const assets = [{ id: "video", type: "video" }];
const rule = (patch = {}) =>
  validateRule(
    {
      id: "rule",
      name: "My reward",
      enabled: true,
      trigger: { type: "chat", command: "!heart" },
      threshold: 3,
      cooldown: 1,
      duration: 6,
      actions: [
        {
          type: "entitlement",
          command: "!scroll",
          result: "text",
          uses: 1,
          ttl: 60,
        },
      ],
      ...patch,
    },
    assets,
  );
function setup(rules = [rule()]) {
  let now = 100000;
  const events = [];
  const e = new Engine({
    rules,
    clock: () => now,
    emit: (type, data) => events.push({ type, data }),
  });
  let n = 0;
  return {
    e,
    events,
    tick: (ms = 1000) => (now += ms),
    chat: (viewerId = "a", text = "!heart", source = "twitch-live", id) =>
      e.chat({
        id: id || String(++n),
        viewerId,
        viewer: viewerId,
        text,
        source,
      }),
  };
}
test("custom thresholds earn only at the configured value", () => {
  const x = setup();
  x.chat();
  x.tick();
  x.chat();
  assert.equal(x.e.grants.size, 0);
  x.tick();
  x.chat();
  assert.equal(x.e.grants.size, 1);
  x.e.stop();
});
test("entitlements are bound to the earning viewer", () => {
  const x = setup([rule({ threshold: 1 })]);
  x.chat("alice");
  x.tick();
  assert.equal(x.chat("bob", "!scroll Hello").reason, "no_match");
  x.tick();
  assert.equal(x.chat("alice", "!scroll Hello").reason, "redeemed");
  assert.equal(x.e.active.viewer, "alice");
  x.e.stop();
});
test("uses are consumed exactly once", () => {
  const x = setup([rule({ threshold: 1 })]);
  x.chat();
  x.tick();
  assert.equal(x.chat("a", "!scroll Hi").reason, "redeemed");
  x.tick();
  assert.equal(x.chat("a", "!scroll Again").reason, "no_match");
  x.e.stop();
});
test("expired entitlements cannot be redeemed", () => {
  const x = setup([rule({ threshold: 1 })]);
  x.chat();
  x.tick(61000);
  assert.equal(x.chat("a", "!scroll Hello").reason, "no_match");
  x.e.stop();
});
test("duplicate EventSub delivery does not increment threshold", () => {
  const x = setup();
  x.chat("a", "!heart", "twitch-live", "same");
  x.tick();
  assert.equal(
    x.chat("a", "!heart", "twitch-live", "same").reason,
    "duplicate",
  );
  assert.equal([...x.e.counts.values()][0], 1);
  x.e.stop();
});
test("preview never grants viewer entitlements", () => {
  const x = setup();
  x.e.preview(rule());
  assert.equal(x.e.grants.size, 0);
  x.e.stop();
});
test("fixture grants cannot be spent by a live viewer", () => {
  const x = setup([rule({ threshold: 1 })]);
  x.chat("a", "!heart", "fixture");
  x.tick();
  assert.equal(x.chat("a", "!scroll Hi", "twitch-live").reason, "no_match");
  x.e.stop();
});
test("cooldown prevents rapid counting across separate event IDs", () => {
  const x = setup([rule({ cooldown: 5 })]);
  x.chat();
  x.tick();
  assert.equal(x.chat().accepted, false);
  assert.equal([...x.e.counts.values()][0], 1);
  x.e.stop();
});
test("viewer rate limit blocks bursts across commands", () => {
  const x = setup();
  x.chat();
  assert.equal(x.chat("a", "!scroll hi").reason, "rate_limit");
  x.e.stop();
});
test("different viewers keep independent progress", () => {
  const x = setup();
  x.chat("a");
  x.tick();
  x.chat("b");
  assert.equal(x.e.counts.size, 2);
  x.e.stop();
});
test("disabled reward cannot issue or redeem", () => {
  const x = setup([rule({ enabled: false })]);
  assert.equal(x.chat().reason, "no_match");
  x.e.stop();
});
test("disabling a rule invalidates outstanding redemption", () => {
  const x = setup([rule({ threshold: 1 })]);
  x.chat();
  x.e.rules[0].enabled = false;
  x.tick();
  assert.equal(x.chat("a", "!scroll Hi").reason, "no_match");
  x.e.stop();
});
test("FIFO preserves media order and a stale completion cannot skip active playback", () => {
  const x = setup();
  const r = rule({ actions: [{ type: "video", assetId: "video" }] });
  x.e.preview(r, "One");
  x.e.preview(r, "Two");
  assert.equal(x.e.active.viewer, "One");
  x.e.finish("stale");
  assert.equal(x.e.active.viewer, "One");
  x.e.finish(x.e.active.id);
  assert.equal(x.e.active.viewer, "Two");
  x.e.stop();
});
test("STOP ALL clears current playback and pending jobs", () => {
  const x = setup();
  const r = rule({ actions: [{ type: "text", text: "Hi" }] });
  x.e.preview(r);
  x.e.preview(r);
  x.e.stop();
  assert.equal(x.e.active, null);
  assert.equal(x.e.queue.length, 0);
  assert.equal(x.events.at(-1).type, "stop");
});
test("queue is bounded at thirty pending jobs", () => {
  const x = setup();
  const r = rule({ actions: [{ type: "text", text: "Hi" }] });
  for (let i = 0; i < 31; i++) assert.equal(x.e.preview(r), true);
  assert.equal(x.e.preview(r), false);
  assert.equal(x.e.queue.length, 30);
  x.e.stop();
});
test("malicious URL does not spend entitlement", () => {
  const x = setup([rule({ threshold: 1 })]);
  x.chat();
  x.tick();
  assert.equal(
    x.chat("a", "!scroll javascript:alert(1)").reason,
    "blocked_text",
  );
  assert.equal([...x.e.grants.values()][0].uses, 1);
  x.e.stop();
});
test("viewer text is plain sanitized text with no HTML delimiters", () => {
  assert.equal(
    viewerText("<script>alert(1)</script>"),
    "scriptalert(1)/script",
  );
  assert.equal(safeText("A\u202eB\u0000C"), "ABC");
});
test("viewer URL and filesystem payloads are refused", () => {
  for (const v of [
    "https://evil.test",
    "www.evil.test",
    "file:///secret",
    "C:\\secret",
    "\\\\server\\file",
    "data:text/html,Hi",
  ])
    assert.throws(() => viewerText(v));
});
test("schema rejects unknown platform and result types", () => {
  assert.throws(() => rule({ trigger: { type: "tiktok" } }));
  assert.throws(() =>
    rule({ actions: [{ type: "script", text: "alert(1)" }] }),
  );
});
test("schema refuses arbitrary file paths and mismatched media types", () => {
  assert.throws(() =>
    rule({ actions: [{ type: "video", assetId: "../../secret" }] }),
  );
  assert.throws(() => rule({ actions: [{ type: "audio", assetId: "video" }] }));
});
test("schema permits streamer defined commands and thresholds", () => {
  const r = rule({
    trigger: { type: "chat", command: "!my_event" },
    threshold: 17,
  });
  assert.equal(r.trigger.command, "!my_event");
  assert.equal(r.threshold, 17);
});
test("schema bounds duration, cooldown, grants and volume", () => {
  for (const value of [0, -1, 31, Infinity])
    assert.throws(() => rule({ duration: value }));
  assert.throws(() => rule({ cooldown: 0 }));
  assert.throws(() =>
    rule({
      actions: [
        {
          type: "entitlement",
          command: "!s",
          result: "text",
          uses: 99,
          ttl: 60,
        },
      ],
    }),
  );
  assert.equal(
    rule({ actions: [{ type: "video", assetId: "video", volume: 9 }] })
      .actions[0].volume,
    1,
  );
});
test("multiple outputs share one job", () => {
  const x = setup();
  x.e.preview(
    rule({
      actions: [
        { type: "video", assetId: "video" },
        { type: "text", text: "Hello {viewer}" },
      ],
    }),
    "Alice",
  );
  assert.equal(x.e.active.actions.length, 2);
  assert.equal(x.e.active.actions[1].text, "Hello Alice");
  x.e.stop();
});
test("button cooldown applies independently of preview", () => {
  const x = setup([rule({ actions: [{ type: "text", text: "Hi" }] })]);
  assert.equal(x.e.manual("rule"), true);
  assert.equal(x.e.manual("rule"), false);
  x.e.stop();
});
