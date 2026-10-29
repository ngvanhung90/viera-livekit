import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { templates, recipes } from "../src/templates.mjs";
import { Engine, validateRule } from "../src/engine.mjs";
const assets = JSON.parse(
  readFileSync(new URL("../assets/manifest.json", import.meta.url)),
);
test("all 12 starters and 24 recipes validate against shipped media and produce preview output", () => {
  assert.equal(templates.length, 12);
  assert.equal(recipes.length, 24);
  for (const t of [...templates, ...recipes]) {
    const rule = validateRule(t, assets);
    const events = [];
    const engine = new Engine({
      emit: (type, data) => events.push({ type, data }),
    });
    assert.equal(engine.preview(rule), true);
    assert.ok(events.some((e) => e.type === "play" && e.data.actions.length));
    assert.equal(engine.grants.size, 0);
    engine.stop();
  }
});
test("every shipped asset exists and has the expected media signature", () => {
  assert.equal(assets.filter((a) => a.type === "video").length, 2);
  assert.equal(assets.filter((a) => a.type === "audio").length, 4);
  assert.equal(assets.filter((a) => a.type === "image").length, 4);
  for (const a of assets) {
    const bytes = readFileSync(new URL("../assets/" + a.file, import.meta.url));
    assert.ok(bytes.length > 1000);
    if (a.type === "video")
      assert.equal(bytes.subarray(4, 8).toString(), "ftyp");
    if (a.type === "audio") {
      assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
      assert.equal(bytes.subarray(8, 12).toString(), "WAVE");
      let peak = 0;
      for (let i = 44; i + 1 < bytes.length; i += 2)
        peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
      assert.ok(
        peak > 3000 && peak < 32767,
        "sound must have usable unclipped signal",
      );
    }
    if (a.type === "image")
      assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  }
});
