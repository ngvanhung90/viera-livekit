import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { LocalSpeech } from "../src/tts.mjs";
test(
  "Windows system voice generates a real WAV through the fixed stdin-based helper",
  { skip: process.platform !== "win32" },
  async () => {
    const root = fileURLToPath(
      new URL("../work/tts-" + randomUUID(), import.meta.url),
    );
    mkdirSync(root, { recursive: true });
    const speech = new LocalSpeech(root);
    try {
      const id = await speech.generate(
        "Viera LiveKit. Your stream, your rules.",
      );
      const a = speech.assets.get(id);
      assert.ok(a.target.startsWith(root));
      const b = readFileSync(a.target);
      assert.equal(b.subarray(0, 4).toString(), "RIFF");
      assert.equal(b.subarray(8, 12).toString(), "WAVE");
      assert.ok(b.length > 10000);
    } finally {
      speech.stop();
    }
  },
);
