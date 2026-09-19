import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5";
const MOODS = ["neutral", "happy", "shy", "love", "sad"];

/* 輸出被鎖死成這個形狀：就算有人拿到網址亂打，也擠不出通用的 LLM 回應 */
const DIALOGUE_SCHEMA = {
  type: "object",
  properties: {
    q: { type: "string" },
    opts: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          t: { type: "string" },
          r: { type: "string" },
          mood: { type: "string", enum: MOODS },
        },
        required: ["t", "r", "mood"],
        additionalProperties: false,
      },
    },
  },
  required: ["q", "opts"],
  additionalProperties: false,
};

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "content-type,x-game-token",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
});

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors(origin) },
  });

/* 客戶端傳來的都是不可信字串，一律截斷後才進 prompt */
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

function buildSystem(b) {
  const aff = Math.max(0, Math.min(100, Number(b.aff) || 0));
  const stage = aff >= 60 ? "很親近" : aff >= 30 ? "熟識" : aff >= 10 ? "點頭之交" : "剛認識";
  const hint = str(b.hintItem, 20);

  return [
    "你是一款繁體中文農場經營遊戲的對話生成器。玩家角色叫「亞瑟」。",
    "請為一位 NPC 生成一句主動搭話，以及三個玩家可選的回應。",
    "",
    `角色名字：${str(b.name, 40)}`,
    `角色人設：${str(b.seed, 200)}`,
    `對亞瑟的好感度：${aff}/100（${stage}）`,
    `時代背景：${Number(b.era) || 18} 世紀的英國`,
    "",
    "規則：",
    "1. 全部使用繁體中文，口吻符合人設與時代。",
    "2. q 是角色對亞瑟說的一句話，20～45 字。",
    "3. opts 必須剛好三個，依序對應以下三種態度，順序不可調換：",
    `   [1] ${str(b.tones?.[0], 30)}`,
    `   [2] ${str(b.tones?.[1], 30)}`,
    `   [3] ${str(b.tones?.[2], 30)}`,
    "4. t 是亞瑟的回應（15～30 字）；r 是角色聽到後的反應（20～40 字）。",
    "5. 絕對不要提到數字、好感度、選項編號或任何遊戲系統詞彙。",
    "6. mood 要符合 r 的情緒。",
    hint
      ? `7. 請讓角色自然地把話題帶到「${hint}」，透露他很喜歡這個東西，但不可以直接開口討要。`
      : "7. 話題貼近日常：天氣、生意、農活、最近的見聞。",
  ].join("\n");
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, origin);
    if (env.GAME_TOKEN && request.headers.get("x-game-token") !== env.GAME_TOKEN)
      return json({ error: "bad token" }, 403, origin);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad json" }, 400, origin);
    }
    if (!Array.isArray(body.tones) || body.tones.length !== 3)
      return json({ error: "tones must be 3" }, 400, origin);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: buildSystem(body),
        messages: [{ role: "user", content: "生成這一輪對話。" }],
        output_config: { format: { type: "json_schema", schema: DIALOGUE_SCHEMA } },
      });

      if (res.stop_reason === "refusal") return json({ error: "refused" }, 422, origin);

      const text = res.content.find((b) => b.type === "text")?.text;
      if (!text) return json({ error: "empty" }, 502, origin);
      return json(JSON.parse(text), 200, origin);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) return json({ error: "auth" }, 500, origin);
      if (err instanceof Anthropic.RateLimitError) return json({ error: "rate limit" }, 429, origin);
      if (err instanceof Anthropic.APIError) return json({ error: "upstream", status: err.status }, 502, origin);
      return json({ error: "unknown" }, 500, origin);
    }
  },
};
