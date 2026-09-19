/* =========================================================
   15_ai_chat.js — AI 生成聊天
   AI 只負責寫字，好感度數值一律由下面的插槽決定，永遠不經過 AI。
   任何失敗（沒設定／逾時／格式不對）都靜靜退回 09 的靜態對話。
   ========================================================= */

const AI_CHAT = {
  enabled: false,   // Worker 部署好、填完 endpoint 後改成 true
  endpoint: '',     // 例：https://farmgame-ai.你的帳號.workers.dev
  token: '',        // 對應 Worker 的 GAME_TOKEN（前端藏不住，只擋隨機掃描）
  timeoutMs: 9000,
  mock: false,      // true = 完全不連網，用假資料測流程與等待手感
};

const AI_MOODS = ['neutral','happy','shy','love','sad'];

/* 好感度插槽：三個態度配三個固定分數。AI 只看得到 tone，看不到 aff。 */
const CHAT_SLOTS = {
  standard: [
    { tone:'冷淡、不想接話',       aff:-2 },
    { tone:'普通地附和',           aff: 1 },
    { tone:'主動關心對方',         aff: 2 } ],
  risky: [
    { tone:'嘲諷，故意刺對方一下', aff:-3 },
    { tone:'敷衍帶過',             aff: 0 },
    { tone:'認真而直接地回應',     aff: 3 } ],
  safe: [
    { tone:'簡短但不失禮',         aff: 0 },
    { tone:'順著話題聊下去',       aff: 1 },
    { tone:'反問一句他的事',       aff: 2 } ],
  /* 內向的人：太熱情反而讓他招架不住 */
  gentle: [
    { tone:'冷淡、不想接話',           aff:-2 },
    { tone:'熱情誇張地大聲回應',       aff:-1 },
    { tone:'放輕聲音，等他把話說完',   aff: 3 } ],
  /* 愛被誇的人：直球讚美最有效，潑冷水最傷 */
  praise: [
    { tone:'潑冷水，說他很浮誇',   aff:-3 },
    { tone:'敷衍地點頭',           aff: 0 },
    { tone:'直接了當地誇獎他',     aff: 3 } ],
};

const CHAR_SLOT_POOL = {
  Francis: ['standard','risky','safe'],
  Pedro:   ['standard','safe','risky'],
  Antonio: ['standard','safe','praise'],
  Alfred:  ['standard','praise','risky'],
  Matthew: ['standard','gentle','safe'],
  _default:['standard','safe'],
};

const pick = a => a[Math.floor(Math.random()*a.length)];

function pickSlots(id){
  const pool = CHAR_SLOT_POOL[id] || CHAR_SLOT_POOL._default;
  return CHAT_SLOTS[pick(pool)] || CHAT_SLOTS.standard;
}

/* 洗牌：最高分不能固定在最後一個，否則玩家不用讀就知道選哪個 */
function shuffled(n){
  const a = Array.from({length:n}, (_,i)=>i);
  for(let i=a.length-1; i>0; i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

/* 偶爾讓角色把話題帶到「玩家還沒發現」的愛物，接上 14 的送禮偏好 */
function pickHint(id){
  const p = CHAR_PREFS[id];
  if(!p || (S.port.relations[id]||{}).aff < 15) return null;
  if(Math.random() > 0.35) return null;
  const found = giftFound(id);
  const loves = Object.keys(p.gift).filter(k => p.gift[k] >= GIFT_LOVE && !found[k]);
  if(!loves.length) return null;
  const k = pick(loves);
  return ((PRODUCTS[k]||EXTRAS[k]||FARM_CROPS[k]||{}).nm) || null;
}

function aiValidate(d){
  if(!d || typeof d.q !== 'string' || !d.q.trim()) return null;
  if(!Array.isArray(d.opts) || d.opts.length !== 3) return null;
  for(const o of d.opts){
    if(!o || typeof o.t !== 'string' || !o.t.trim()) return null;
    if(typeof o.r !== 'string' || !o.r.trim()) return null;
    if(!AI_MOODS.includes(o.mood)) o.mood = 'neutral';
  }
  return d;
}

const MOCK_TOPICS = [
  '今天海風有點大，你那邊的田還撐得住嗎？',
  '昨天有人拿一袋爛貨想騙我，被我當場退回去了。',
  '你上次說要來看我新進的那批貨，還算不算數？',
  '欸，你最近氣色不錯。是農閒了還是遇到什麼好事？',
  '這條街的租金又漲了，我在想要不要換個攤位。',
];
let _mockSeq = 0;
function mockConvo(){
  const q = MOCK_TOPICS[_mockSeq++ % MOCK_TOPICS.length];
  return { q:`（測試${_mockSeq}）${q}`, opts:[
    { t:'（測試）不關你的事。',       r:'……這樣啊，是我多問了。',               mood:'sad' },
    { t:'（測試）還行吧。',           r:'嗯，那就好。',                         mood:'neutral' },
    { t:'（測試）要不要我幫忙？',     r:'（笑）等我收了攤就去找你，別反悔。',   mood:'happy' } ] };
}

/* 一次要 n 段。每段各自抽插槽，語氣不同，回來要跟插槽配對。 */
async function aiGenerateBatch(id, n){
  const slotsList = [];
  for(let i = 0; i < n; i++) slotsList.push(pickSlots(id));

  if(AI_CHAT.mock){
    await new Promise(r => setTimeout(r, 600));
    return slotsList.map(s => ({ slots:s, data:aiValidate(mockConvo()), mock:true }))
                    .filter(x => x.data);
  }
  if(!AI_CHAT.endpoint) return [];

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), AI_CHAT.timeoutMs);
  try{
    const pref = CHAR_PREFS[id] || {};
    const res = await fetch(AI_CHAT.endpoint, {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-game-token':AI_CHAT.token },
      signal: ctl.signal,
      body: JSON.stringify({
        name: charName(id),
        seed: pref.seed || '',
        aff: (S.port.relations[id]||{}).aff || 0,
        era: S.era,
        variants: slotsList.map(s => s.map(x => x.tone)),   // 一次要 n 組語氣
        hintItem: pickHint(id),
      }),
    });
    if(!res.ok) return [];
    const body = await res.json();
    const items = Array.isArray(body.items) ? body.items : [];
    return items.map((d, i) => ({ slots:slotsList[i], data:aiValidate(d) }))
                .filter(x => x.data && x.slots);
  }catch{
    return [];
  }finally{
    clearTimeout(timer);
  }
}

/* ---------------- 存貨 ---------------- */
const AI_CACHE = { target:5, refillAt:2 };
const _refilling = {};

function cacheFor(id){
  if(!S.aiCache) S.aiCache = {};                 // 舊存檔相容
  if(!S.aiCache[id]) S.aiCache[id] = [];
  return S.aiCache[id];
}
/* mock 產生的存貨不能留到正式模式用，否則玩家會看到「（測試3）」 */
function cachePurgeMock(id){
  const q = cacheFor(id);
  if(AI_CHAT.mock) return q;
  const kept = q.filter(x => !x.mock);
  if(kept.length !== q.length){ S.aiCache[id] = kept; save(); }
  return S.aiCache[id];
}
function cacheTake(id){
  const q = cachePurgeMock(id);
  if(!q.length) return null;
  const item = q.shift();
  save();
  return item;
}
function cacheRefill(id){
  if(!AI_CHAT.enabled || _refilling[id]) return;
  const q = cachePurgeMock(id);
  if(q.length > AI_CACHE.refillAt) return;
  _refilling[id] = true;
  aiGenerateBatch(id, AI_CACHE.target - q.length)
    .then(list => { if(list.length){ cacheFor(id).push(...list); save(); } })
    .catch(() => {})
    .finally(() => { _refilling[id] = false; });
}

function renderAiChat(id, data, slots){
  const rel = S.port.relations[id];
  const choices = shuffled(3).map(i => ({
    t: data.opts[i].t,
    run: ()=>{
      rel.lastChat = Date.now();
      rel.aff += slots[i].aff;
      save();
      const o = data.opts[i], d = slots[i].aff;
      showDialogue(id, o.mood, `${o.r}（好感 ${d>=0?'+':''}${d}）`, [
        { t:'結束對話', cls:'green', run:()=>openMerchant(id) } ]);
    },
  }));
  showDialogue(id, 'neutral', data.q, choices);
}

const _chatMerchantStatic = chatMerchant;
chatMerchant = function(id){
  const rel = S.port.relations[id];
  if(Date.now() - (rel.lastChat||0) < 8000){ toast('剛聊過了，等一下'); return; }
  if(!AI_CHAT.enabled){ _chatMerchantStatic(id); return; }

  const hit = cacheTake(id);
  cacheRefill(id);                                 // 背景補貨，不等它
  if(!hit){ _chatMerchantStatic(id); return; }     // 沒存貨就走靜態，玩家永遠不用等
  renderAiChat(id, hit.data, hit.slots);
};

/* 進商店就先備貨，等玩家想聊天時通常已經有存貨了 */
const _openMerchantWarm = openMerchant;
openMerchant = function(id){
  cacheRefill(id);
  return _openMerchantWarm(id);
};
