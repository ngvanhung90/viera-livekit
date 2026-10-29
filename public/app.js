let state;
const $ = (s) => document.querySelector(s);
async function api(url, data) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
}
function notice(text) {
  $("#notice").textContent = text;
  $("#notice").style.display = "block";
  setTimeout(() => ($("#notice").style.display = "none"), 6000);
}
function guarded(fn) {
  return async () => {
    try {
      await fn();
    } catch (e) {
      notice(e.message);
    }
  };
}
function render(s) {
  state = s;
  $("#overlay-url").value = s.overlayUrl;
  $("#open-overlay").href = s.overlayUrl;
  $("#overlay-count").textContent = `${s.overlayCount} overlay connection(s)`;
  if (document.activeElement !== $("#client-id"))
    $("#client-id").value = s.config.clientId;
  $("#connection").textContent = s.twitch.connected
    ? `● Twitch connected · ${s.twitch.login}`
    : "○ Twitch disconnected";
  $("#twitch-detail").textContent =
    `${s.twitch.state} · ${s.twitch.realChats} real chat event(s)`;
  $("#queue-status").textContent = s.engine.active
    ? `Playing: ${s.engine.active.name} · ${s.engine.active.source} · ${s.engine.queued} queued`
    : `Queue idle · ${s.engine.queued} queued`;
  const library = $("#library");
  const signature = JSON.stringify(s.config.rules);
  if (library.dataset.signature === signature) return;
  library.dataset.signature = signature;
  library.replaceChildren();
  for (const r of s.config.rules) {
    const card = document.createElement("article");
    card.className = "card";
    const media = r.actions.find((a) => a.type === "video");
    if (media) {
      const video = document.createElement("video");
      video.src = "/media/" + media.assetId;
      video.muted = true;
      video.controls = true;
      video.preload = "metadata";
      card.append(video);
    }
    const b = document.createElement("div");
    b.className = "card-body";
    const h = document.createElement("h3");
    h.textContent = r.name;
    b.append(h);
    const p = document.createElement("span");
    p.className = "pill";
    p.textContent = `${r.trigger.type === "chat" ? r.trigger.command : r.trigger.type === "hotkey" ? r.trigger.key : "Button"} · ${r.threshold} valid event(s) · ${r.cooldown}s cooldown`;
    b.append(p);
    const desc = document.createElement("p");
    desc.textContent = r.enabled
      ? "Active · streamer-defined interaction"
      : "Disabled";
    b.append(desc);
    const actions = document.createElement("div");
    actions.className = "card-actions";
    for (const [label, fn] of [
      ["▶ Preview", () => api("/api/preview", { id: r.id })],
      ["Trigger on overlay", () => api("/api/fire", { id: r.id })],
    ]) {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.onclick = guarded(fn);
      actions.append(btn);
    }
    b.append(actions);
    card.append(b);
    library.append(card);
  }
}
$("#stop").onclick = guarded(() => api("/api/stop", {}));
$("#disconnect").onclick = guarded(() => api("/api/twitch/disconnect", {}));
$("#connect").onclick = guarded(async () => {
  await api("/api/settings", { clientId: $("#client-id").value.trim() });
  const d = await api("/api/twitch/connect", {});
  const p = $("#oauth-status");
  p.replaceChildren();
  const a = document.createElement("a");
  a.href = d.verificationUri;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = `Authorize on Twitch ↗ — code: ${d.userCode}`;
  p.append(a);
  p.append(
    document.createTextNode(
      ` · expires in ${Math.floor(d.expiresIn / 60)} min`,
    ),
  );
});
const editor = document.createElement("dialog");
editor.id = "editor";
editor.innerHTML = `<form id="edit-form"><div class="section-title"><h2>Your stream. Your rules.</h2><button type="button" id="close-edit" class="quiet">Close</button></div><label>Interaction name<input id="rule-name" required maxlength="80"></label><label class="inline"><input id="rule-enabled" type="checkbox" checked> Enabled</label><h3>1 · Choose a trigger</h3><div class="form-grid"><label>Trigger<select id="trigger-type"><option value="chat">Twitch chat command</option><option value="button">Dashboard button</option><option value="hotkey">Shortcut (dashboard focused)</option></select></label><label id="command-label">Chat command<input id="trigger-command" value="!wow" maxlength="31"></label><label id="hotkey-label" hidden>Shortcut<select id="trigger-key">${Array.from({ length: 12 }, (_, i) => `<option>F${i + 1}</option>`).join("")}</select></label></div><div class="form-grid"><label>Events needed<input id="threshold" type="number" min="1" max="10000" value="1" required></label><label>Cooldown per viewer (seconds)<input id="cooldown" type="number" min="1" max="3600" value="5" required></label><label>Maximum play time (seconds)<input id="duration" type="number" min="1" max="30" value="6" required></label></div><h3>2 · Choose results</h3><p>Results run together. Use {viewer} to show the viewer's name.</p><div id="result-rows"></div><button id="add-result" type="button" class="quiet">+ Add result</button><h3>Bring your own media</h3><label>Upload video, audio, image or GIF (100 MB max)<input id="media-file" type="file" accept="video/mp4,video/webm,video/quicktime,audio/*,image/png,image/jpeg,image/gif,image/webp"></label><div class="recording"><button id="record" type="button" class="quiet">● Record microphone</button><button id="finish-record" type="button" class="quiet" disabled>■ Save recording</button><span id="record-status">Real recording · never voice cloning</span></div><p id="upload-status"></p><div class="editor-footer"><button type="button" id="preview-rule" class="quiet">▶ Preview results</button><button type="submit">Save interaction</button></div><p id="editor-error" role="alert"></p></form>`;
document.body.append(editor);
let editingId = null,
  recorder = null,
  recordStream = null,
  recordTimeout = null;
function triggerVisibility() {
  const type = $("#trigger-type").value;
  $("#command-label").hidden = type !== "chat";
  $("#hotkey-label").hidden = type !== "hotkey";
  $("#threshold").disabled = type !== "chat";
}
function option(value, text) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  return o;
}
function resultRow(action = { type: "text", text: "{viewer}, thank you!" }) {
  const row = document.createElement("div");
  row.className = "result-row";
  const type = document.createElement("select");
  type.setAttribute("aria-label", "Result type");
  for (const [v, n] of [
    ["video", "Play video"],
    ["audio", "Play audio / recording"],
    ["image", "Show image / GIF"],
    ["text", "Show text"],
    ["effect", "Overlay effect"],
    ["entitlement", "Unlock scrolling viewer message"],
  ])
    type.append(option(v, n));
  type.value = action.type;
  const fields = document.createElement("div");
  fields.className = "result-fields";
  row.append(type, fields);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.className = "quiet";
  remove.onclick = () => row.remove();
  row.append(remove);
  const draw = () => {
    fields.replaceChildren();
    const t = type.value;
    if (["video", "audio", "image"].includes(t)) {
      const s = document.createElement("select");
      s.className = "asset";
      s.setAttribute("aria-label", "Media asset");
      s.append(option("", "Choose media…"));
      for (const asset of state.config.assets.filter((a) => a.type === t))
        s.append(option(asset.id, asset.name));
      s.value = action.assetId || "";
      fields.append(s);
      const volume = document.createElement("input");
      volume.type = "range";
      volume.min = 0;
      volume.max = 1;
      volume.step = 0.05;
      volume.value = action.volume ?? 0.7;
      volume.className = "volume";
      volume.setAttribute("aria-label", "Volume");
      fields.append(volume);
    }
    if (t === "text") {
      const input = document.createElement("input");
      input.value = action.text || "{viewer}, thank you!";
      input.maxLength = 200;
      input.className = "result-text";
      input.setAttribute("aria-label", "Overlay text");
      fields.append(input);
    }
    if (t === "effect") {
      const select = document.createElement("select");
      select.className = "effect";
      select.setAttribute("aria-label", "Overlay effect");
      for (const v of ["confetti", "pulse", "stars", "hearts"])
        select.append(option(v, v));
      select.value = action.effect || "confetti";
      fields.append(select);
    }
    if (t === "entitlement") {
      for (const [cls, label, value, kind, min, max] of [
        [
          "redeem-command",
          "Redemption command",
          action.command || "!scroll",
          "text",
        ],
        ["uses", "Number of uses", action.uses || 1, "number", 1, 20],
        ["ttl", "Expires in seconds", action.ttl || 120, "number", 10, 3600],
      ]) {
        const l = document.createElement("label");
        l.textContent = label;
        const input = document.createElement("input");
        input.className = cls;
        input.type = kind;
        input.value = value;
        if (min) input.min = min;
        if (max) input.max = max;
        input.setAttribute("aria-label", label);
        l.append(input);
        fields.append(l);
      }
      const hint = document.createElement("p");
      hint.textContent =
        "Only the viewer who earned it can redeem. TTS is not enabled until voice playback is verified in OBS.";
      fields.append(hint);
    }
  };
  type.onchange = () => {
    action = { type: type.value };
    draw();
  };
  draw();
  $("#result-rows").append(row);
}
function readRule() {
  const actions = [...document.querySelectorAll(".result-row")].map((row) => {
    const type = row.querySelector("select").value;
    const get = (s) => row.querySelector(s)?.value;
    return ["video", "audio", "image"].includes(type)
      ? { type, assetId: get(".asset"), volume: Number(get(".volume")) }
      : type === "text"
        ? { type, text: get(".result-text") }
        : type === "effect"
          ? { type, effect: get(".effect") }
          : {
              type,
              command: get(".redeem-command").trim().toLowerCase(),
              result: "text",
              uses: Number(get(".uses")),
              ttl: Number(get(".ttl")),
            };
  });
  return {
    id: editingId,
    name: $("#rule-name").value,
    enabled: $("#rule-enabled").checked,
    trigger: {
      type: $("#trigger-type").value,
      command: $("#trigger-command").value,
      key: $("#trigger-key").value,
    },
    threshold:
      $("#trigger-type").value === "chat" ? Number($("#threshold").value) : 1,
    cooldown: Number($("#cooldown").value),
    duration: Number($("#duration").value),
    actions,
  };
}
function openEditor(r = null) {
  editingId = r?.id || null;
  $("#rule-name").value = r?.name || "My interaction";
  $("#rule-enabled").checked = r?.enabled !== false;
  $("#trigger-type").value = r?.trigger.type || "chat";
  $("#trigger-command").value = r?.trigger.command || "!wow";
  $("#trigger-key").value = r?.trigger.key || "F1";
  $("#threshold").value = r?.threshold || 1;
  $("#cooldown").value = r?.cooldown || 5;
  $("#duration").value = r?.duration || 6;
  $("#result-rows").replaceChildren();
  for (const a of r?.actions || [
    { type: "text", text: "{viewer}, thank you!" },
  ])
    resultRow(a);
  $("#editor-error").textContent = "";
  triggerVisibility();
  editor.showModal();
}
$("#trigger-type").onchange = triggerVisibility;
$("#add").textContent = "+ Add milestone / reward";
$("#add").onclick = () => openEditor();
$("#close-edit").onclick = () => editor.close();
$("#add-result").onclick = () => {
  if (document.querySelectorAll(".result-row").length >= 8) {
    notice("Up to 8 simultaneous results");
    return;
  }
  resultRow();
};
$("#preview-rule").onclick = guarded(() =>
  api("/api/preview", { rule: readRule() }),
);
$("#edit-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("/api/rules", readRule());
    editor.close();
    await refresh();
    notice("Interaction saved");
  } catch (e) {
    $("#editor-error").textContent = e.message;
  }
};
async function upload(blob, name) {
  if (document.querySelectorAll(".result-row").length >= 8)
    throw new Error("Remove a result before attaching more media");
  $("#upload-status").textContent = "Saving media…";
  const r = await fetch("/api/upload", {
    method: "POST",
    headers: { "X-File-Name": encodeURIComponent(name) },
    body: blob,
  });
  const asset = await r.json();
  if (!r.ok) throw new Error(asset.error);
  await refresh();
  resultRow({ type: asset.type, assetId: asset.id });
  $("#upload-status").textContent =
    `Saved ${asset.name}. Save the interaction to keep your rule.`;
  return asset;
}
$("#media-file").onchange = guarded(async () => {
  const f = $("#media-file").files[0];
  if (f) await upload(f, f.name);
  $("#media-file").value = "";
});
function finishRecording() {
  if (recorder?.state === "recording") recorder.stop();
  clearTimeout(recordTimeout);
  recordStream?.getTracks().forEach((t) => t.stop());
  $("#record").disabled = false;
  $("#finish-record").disabled = true;
}
$("#record").onclick = guarded(async () => {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "Microphone recording unavailable. Upload an audio file instead.",
    );
  recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  if (!editor.open) {
    recordStream.getTracks().forEach((t) => t.stop());
    return;
  }
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  recorder = new MediaRecorder(recordStream, { mimeType: mime });
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.onstop = async () => {
    try {
      await upload(
        new Blob(chunks, { type: mime }),
        `Microphone-${Date.now()}.weba`,
      );
      $("#record-status").textContent = "Recording saved locally";
    } catch (e) {
      notice(e.message);
    }
  };
  recorder.start();
  $("#record").disabled = true;
  $("#finish-record").disabled = false;
  $("#record-status").textContent = "Recording… auto stops at 30 seconds";
  recordTimeout = setTimeout(finishRecording, 30000);
});
$("#finish-record").onclick = finishRecording;
editor.addEventListener("close", () => {
  if (recorder?.state === "recording") finishRecording();
});
const controls = document.createElement("section");
controls.className = "setup board-controls";
controls.innerHTML =
  '<h2>Viewer Rewards Board</h2><label class="inline"><input id="board-visible" type="checkbox"> Show rewards in OBS</label><label class="inline"><input id="board-compact" type="checkbox"> Compact view</label><p>Only your enabled chat rules appear. Bits, subscriptions and Channel Points are not enabled.</p>';
$(".activity").before(controls);
for (const id of ["#board-visible", "#board-compact"])
  $(id).onchange = guarded(() =>
    api("/api/settings", {
      board: {
        visible: $("#board-visible").checked,
        compact: $("#board-compact").checked,
      },
    }),
  );
function addEditButtons() {
  for (const [i, card] of [...document.querySelectorAll(".card")].entries()) {
    if (card.dataset.editable) return;
    card.dataset.editable = "yes";
    const r = state.config.rules[i];
    const target = card.querySelector(".card-actions");
    for (const [label, fn] of [
      ["Edit", () => openEditor(r)],
      [
        "Duplicate",
        () =>
          openEditor({
            ...structuredClone(r),
            id: null,
            name: r.name + " copy",
          }),
      ],
      [
        r.enabled ? "● Enabled" : "○ Disabled",
        () => api("/api/rules", { ...r, enabled: !r.enabled }),
      ],
      [
        "Delete",
        async () => {
          if (confirm(`Delete “${r.name}”? A local backup is kept.`))
            await api("/api/delete", { id: r.id });
        },
      ],
    ]) {
      const b = document.createElement("button");
      b.className = "quiet";
      b.textContent = label;
      b.onclick = guarded(fn);
      target.append(b);
    }
  }
}
async function refresh() {
  try {
    render(await (await fetch("/api/state")).json());
    addEditButtons();
    $("#board-visible").checked = state.config.board.visible;
    $("#board-compact").checked = state.config.board.compact;
    $("#activity").textContent = state.engine.entitlements.length
      ? state.engine.entitlements
          .map(
            (g) =>
              `${g.viewer} · ${g.command} · ${g.uses} use(s) · ${g.source}`,
          )
          .join("\n")
      : "No outstanding viewer entitlements. Preview does not grant rewards.";
  } catch {
    $("#connection").textContent = "App offline — restart npm start";
  }
}
await refresh();
setInterval(refresh, 1200);
document.addEventListener("keydown", (e) => {
  if (editor.open || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  for (const r of state.config.rules)
    if (r.enabled && r.trigger.type === "hotkey" && r.trigger.key === e.key) {
      e.preventDefault();
      api("/api/fire", { id: r.id, source: "hotkey" }).catch((e) =>
        notice(e.message),
      );
    }
});
