import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
const script = fileURLToPath(new URL("../scripts/speak.ps1", import.meta.url));
export class LocalSpeech {
  constructor(dataRoot) {
    this.root = path.join(dataRoot, "speech");
    mkdirSync(this.root, { recursive: true });
    this.children = new Set();
    this.assets = new Map();
  }
  async generate(text) {
    if (process.platform !== "win32")
      throw new Error("System TTS requires Windows");
    const id = "speech-" + randomUUID(),
      file = id + ".wav",
      target = path.join(this.root, file);
    const exe = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    await new Promise((resolve, reject) => {
      const child = spawn(
        exe,
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          script,
          "-OutputPath",
          target,
        ],
        { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
      );
      this.children.add(child);
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("System TTS timed out"));
      }, 7000);
      child.stderr.resume();
      child.on("error", () => {
        clearTimeout(timeout);
        this.children.delete(child);
        reject(new Error("System TTS unavailable"));
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        this.children.delete(child);
        code === 0 && existsSync(target)
          ? resolve()
          : reject(new Error("System TTS failed"));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ text }));
    });
    this.assets.set(id, {
      id,
      type: "audio",
      name: "Windows system voice",
      file,
      target,
    });
    const cleanup = setTimeout(() => {
      this.assets.delete(id);
      try {
        unlinkSync(target);
      } catch {}
    }, 120000);
    cleanup.unref();
    return id;
  }
  stop() {
    for (const child of this.children) child.kill();
    this.children.clear();
  }
}
