const text = (text) => ({ type: "text", text });
const effect = (effect) => ({ type: "effect", effect });
const audio = (assetId) => ({ type: "audio", assetId, volume: 0.7 });
const video = (assetId) => ({ type: "video", assetId, volume: 0.7 });
const base = (id, name, category, actions, extra = {}) => ({
  id,
  name,
  category,
  enabled: true,
  trigger: { type: "button" },
  threshold: 1,
  cooldown: 5,
  duration: 6,
  actions,
  ...extra,
});
export const templates = [
  base("cosmic", "Cosmic thank you", "Thank you", [
    video("cosmic-clip"),
    text("{viewer}, you made the stream shine!"),
  ]),
  base("victory", "Victory dance", "Reaction videos", [
    video("victory-clip"),
    text("A victory dance for {viewer}!"),
  ]),
  base("applause", "A little applause", "Celebrations", [
    audio("chime"),
    effect("confetti"),
    text("Give it up for {viewer}!"),
  ]),
  base("boing", "Comic relief", "Humor", [
    audio("boing"),
    effect("pulse"),
    text("{viewer} just changed the mood."),
  ]),
  base("levelup", "Level unlocked", "Celebrations", [
    audio("levelup"),
    effect("stars"),
    text("{viewer} unlocked a new level!"),
  ]),
  base("heartwave", "Heart wave", "Community", [
    audio("pop"),
    effect("hearts"),
    text("Sending some love to {viewer}."),
  ]),
  base("confetti", "Chat confetti", "Chat effects", [
    effect("confetti"),
    text("Chat, this one is yours!"),
  ]),
  base("stars", "Star shower", "Chat effects", [
    effect("stars"),
    text("{viewer} is the star tonight."),
  ]),
  base("pulse", "Hype pulse", "Chat effects", [
    effect("pulse"),
    audio("levelup"),
    text("The room is getting louder!"),
  ]),
  base(
    "spotlight",
    "Earn your spotlight",
    "Viewer rewards",
    [
      {
        type: "entitlement",
        command: "!scroll",
        result: "text",
        uses: 1,
        ttl: 120,
      },
    ],
    { trigger: { type: "chat", command: "!heart" }, threshold: 3, duration: 9 },
  ),
  base(
    "voice",
    "Your voice in the show",
    "Viewer rewards",
    [
      {
        type: "entitlement",
        command: "!speak",
        result: "tts",
        uses: 1,
        ttl: 120,
      },
    ],
    {
      trigger: { type: "chat", command: "!cheer" },
      threshold: 5,
      duration: 15,
    },
  ),
  base("welcome", "Community welcome", "Thank you", [
    { type: "image", assetId: "community-card" },
    audio("chime"),
    text("Welcome to the community, {viewer}!"),
  ]),
];
export const recipes = templates.flatMap((t, i) => [
  {
    ...structuredClone(t),
    id: t.id + "-quick",
    name: t.name + " · chat cue",
    trigger: { type: "chat", command: "!cue" + (i + 1) },
    threshold: 1,
    cooldown: 10,
    recipeOf: t.id,
  },
  {
    ...structuredClone(t),
    id: t.id + "-goal",
    name: t.name + " · community milestone",
    trigger: { type: "chat", command: "!goal" + (i + 1) },
    threshold: 5,
    cooldown: 3,
    duration: Math.min(30, t.duration + 2),
    recipeOf: t.id,
  },
]);
