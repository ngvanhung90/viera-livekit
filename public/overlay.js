const stage = document.querySelector("#stage"),
  board = document.querySelector("#board"),
  status = document.querySelector("#status");
let socket, timer, current, config;
const isOBS = !!window.obsstudio,
  client = isOBS ? "obs-browser" : "browser-preview";
function send(data) {
  if (socket?.readyState === 1) socket.send(JSON.stringify(data));
}
function receipt(event, details = "") {
  if (current)
    send({ type: "receipt", event, jobId: current.id, client, details });
}
function stop() {
  clearTimeout(timer);
  for (const m of stage.querySelectorAll("video,audio")) {
    m.pause();
    m.removeAttribute("src");
    m.load();
  }
  window.speechSynthesis?.cancel();
  stage.replaceChildren();
  current = null;
}
function renderBoard() {
  board.replaceChildren();
  if (!config?.board.visible) return;
  const rules = config.rules.filter(
    (r) => r.enabled && r.trigger.type === "chat",
  );
  if (!rules.length) return;
  const h = document.createElement("h2");
  h.textContent = "✦ VIEWER REWARDS";
  board.append(h);
  for (const r of rules) {
    const p = document.createElement("p");
    const grants = r.actions.filter((a) => a.type === "entitlement");
    p.textContent = config.board.compact
      ? `${r.trigger.command} × ${r.threshold} → ${r.name}`
      : `${r.trigger.command} × ${r.threshold} valid messages → ${r.name}. ${grants.map((a) => `${a.command} your message · ${a.uses} use(s), ${a.ttl}s to redeem`).join(" ")} Cooldown ${r.cooldown}s.`;
    board.append(p);
  }
}
function play(job) {
  stop();
  current = job;
  status.textContent =
    job.source === "preview" ? "PREVIEW · no Twitch event" : "";
  for (const a of job.actions) {
    if (["video", "audio", "image"].includes(a.type)) {
      const el = document.createElement(a.type === "image" ? "img" : a.type);
      el.src = "/media/" + a.assetId;
      if (a.type !== "image") {
        el.volume = a.volume ?? 0.7;
        el.playsInline = true;
        el.addEventListener("playing", () =>
          receipt(
            "playing",
            `${a.systemVoice ? "system-tts" : a.type}; time=${el.currentTime}; ready=${el.readyState}`,
          ),
        );
        el.addEventListener("ended", () => receipt("ended", a.type));
        el.addEventListener("error", () =>
          receipt("error", `${a.type}; code=${el.error?.code}`),
        );
        el.play().catch((e) => {
          status.textContent =
            "Playback blocked — enable audio autoplay in OBS";
          receipt("error", e.name);
        });
      }
      stage.append(el);
    }
    if (a.type === "text") {
      const el = document.createElement("div");
      el.className = "message" + (job.actions.length === 1 ? " scroll" : "");
      if (job.actions.length === 1)
        el.style.animationDuration = job.duration + "s";
      el.textContent = a.text;
      stage.append(el);
    }
    if (a.type === "tts") {
      const utterance = new SpeechSynthesisUtterance(a.text);
      utterance.volume = a.volume ?? 0.7;
      utterance.onend = () => receipt("tts_ended");
      utterance.onerror = (e) => receipt("error", "TTS " + e.error);
      speechSynthesis.speak(utterance);
    }
    if (a.type === "effect") {
      if (a.effect === "pulse") {
        const p = document.createElement("div");
        p.className = "pulse";
        stage.append(p);
      } else
        for (let i = 0; i < 45; i++) {
          const p = document.createElement("div");
          p.className = "particle";
          p.textContent =
            { confetti: "▪", stars: "✦", hearts: "♥" }[a.effect] || "✦";
          p.style.left = Math.random() * 100 + "%";
          p.style.color = ["#c6f176", "#ad94ff", "#ff91b9", "#fff"][i % 4];
          p.style.animationDelay = Math.random() + "s";
          stage.append(p);
        }
    }
  }
  const id = job.id;
  timer = setTimeout(() => {
    receipt("duration_complete");
    stop();
    status.textContent = "";
    send({ type: "done", jobId: id });
  }, job.duration * 1000);
}
function connect() {
  const key = new URLSearchParams(location.search).get("key");
  if (!key) {
    status.textContent = "Copy the current OBS URL from the LiveKit dashboard";
    return;
  }
  socket = new WebSocket(
    `ws://${location.host}/events?key=${encodeURIComponent(key)}`,
  );
  socket.onopen = () => {
    status.textContent = "";
    send({ type: "hello", client });
  };
  socket.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "play") play(m.data);
    if (m.type === "stop") {
      stop();
      status.textContent = "";
    }
    if (m.type === "state" && m.data.config) {
      config = m.data.config;
      renderBoard();
    }
  };
  socket.onclose = () => {
    stop();
    status.textContent = "LiveKit disconnected · reconnecting";
    setTimeout(connect, 1500);
  };
}
connect();
