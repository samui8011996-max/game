import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5";
const MOODS = ["neutral", "happy", "shy", "love", "sad"];
const MAX_VARIANTS = 5;          // 一次最多幾段，同時是濫用時的成本上限

/* 輸出被鎖死成這個形狀：就算有人拿到網址亂打，也擠不出通用的 LLM 回應 */
const convoSchema = {
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
const batchSchema = (n) => ({
  type: "object",
  properties: { items: { type: "array", minItems: n, maxItems: n, items: convoSchema } },
  required: ["items"],
  additionalProperties: false,
});

/* 委託：只要說辭，報酬與數量都由遊戲端決定，這裡拿不到也改不了 */
const questSchema = (n) => ({
  type: "object",
  properties: {
    items: {
      type: "array", minItems: n, maxItems: n,
      items: {
        type: "object",
        properties: { why: { type: "string" }, thanks: { type: "string" } },
        required: ["why", "thanks"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
});

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

function buildSystem(b, variants) {
  const aff = Math.max(0, Math.min(100, Number(b.aff) || 0));
  const stage = aff >= 60 ? "很親近" : aff >= 30 ? "熟識" : aff >= 10 ? "點頭之交" : "剛認識";
  const hint = str(b.hintItem, 20);

  const lines = [
    "你是一款繁體中文農場經營遊戲的對話生成器。玩家角色叫「亞瑟」。",
    `請為一位 NPC 生成 ${variants.length} 段彼此不重複的搭話，每段都附三個玩家可選的回應。`,
    "",
    `角色名字：${str(b.name, 40)}`,
    `角色人設：${str(b.seed, 200)}`,
    `對亞瑟的好感度：${aff}/100（${stage}）`,
    `時代背景：${Number(b.era) || 18} 世紀的英國`,
    "",
    "規則：",
    "1. 全部使用繁體中文，口吻符合人設與時代。",
    "2. q 是角色對亞瑟說的一句話，20～45 字。",
    "3. t 是亞瑟的回應（15～30 字）；r 是角色聽到後的反應（20～40 字）。",
    "4. 絕對不要提到數字、好感度、選項編號或任何遊戲系統詞彙。",
    "5. mood 要符合 r 的情緒。",
    `6. items 必須剛好 ${variants.length} 段，每段的三個選項依序對應下列態度，順序不可調換：`,
  ];
  variants.forEach((v, i) => {
    lines.push(`   第 ${i + 1} 段 → [1] ${str(v[0], 30)}　[2] ${str(v[1], 30)}　[3] ${str(v[2], 30)}`);
  });
  lines.push(
    hint
      ? `7. 其中一段請讓角色自然地把話題帶到「${hint}」，透露他很喜歡這個東西，但不可以直接開口討要。`
      : "7. 話題貼近日常：天氣、生意、農活、最近的見聞。每段主題要不同。"
  );
  return lines.join("\n");
}

function buildQuestSystem(b, asks) {
  const aff = Math.max(0, Math.min(100, Number(b.aff) || 0));
  const stage = aff >= 60 ? "很親近" : aff >= 30 ? "熟識" : "點頭之交";
  const lines = [
    "你是一款繁體中文農場經營遊戲的對話生成器。玩家角色叫「亞瑟」。",
    `這位 NPC 想拜託亞瑟幫忙蒐集東西。請為以下 ${asks.length} 筆請求各寫兩句話。`,
    "",
    `角色名字：${str(b.name, 40)}`,
    `角色人設：${str(b.seed, 200)}`,
    `對亞瑟的好感度：${aff}/100（${stage}）`,
    `時代背景：${Number(b.era) || 18} 世紀的英國`,
    "",
    "規則：",
    "1. 全部使用繁體中文，口吻符合人設與時代。",
    "2. why：開口拜託的話，要講出一個具體又符合人設的理由，30～60 字。",
    "3. thanks：收到東西時說的話，20～40 字。",
    "4. 絕對不要提到報酬金額、好感度或任何遊戲系統詞彙——報酬由遊戲決定，你不知道也不要猜。",
    "5. 每筆理由都要不同，不要套同一個模板。",
    "",
    "請求清單：",
  ];
  asks.forEach((a, i) => {
    lines.push(`   ${i + 1}. ${str(a.item, 20)} ${Math.max(1, Math.min(99, Number(a.qty) || 1))} 個`);
  });
  return lines.join("\n");
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

    let system, schema, n, ask;
    if (body.kind === "quest") {
      const asks = Array.isArray(body.asks) ? body.asks.slice(0, MAX_VARIANTS) : [];
      if (!asks.length || asks.some((a) => !a || typeof a.item !== "string"))
        return json({ error: "asks must be [{item, qty}]" }, 400, origin);
      n = asks.length;
      system = buildQuestSystem(body, asks);
      schema = questSchema(n);
      ask = "寫出這一批委託的說辭。";
    } else {
      const variants = Array.isArray(body.variants) ? body.variants.slice(0, MAX_VARIANTS) : [];
      if (!variants.length || variants.some((v) => !Array.isArray(v) || v.length !== 3))
        return json({ error: "variants must be arrays of 3 tones" }, 400, origin);
      n = variants.length;
      system = buildSystem(body, variants);
      schema = batchSchema(n);
      ask = "生成這一批對話。";
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: Math.min(8000, 1200 * n),
        system,
        messages: [{ role: "user", content: ask }],
        output_config: { format: { type: "json_schema", schema } },
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
