/* =========================================================
   17_quest.js — 角色委託（收集任務）
   遊戲決定：要什麼、要幾個、給多少錢、加多少好感
   AI 決定：為什麼需要、拿到時說什麼

   報酬由物品價值推算，AI 完全碰不到數值，
   跟自訂食譜的售價、聊天的好感插槽是同一條原則。
   ========================================================= */

const QUEST_PAY_MUL   = 2.2;   // 報酬 = 物品價值 × 數量 × 這個（要比自己賣掉划算）
const QUEST_MIN_AFF   = 10;    // 好感低於此不會開口拜託
const QUEST_CHANCE    = 0.5;   // 符合條件時每天一次的觸發機率
const QUEST_CACHE     = { target:3, refillAt:1 };

/* 可指定的物品：角色喜歡的東西 + 當下種得出來的作物。
   要排掉 hidden（一般種子店沒賣，如鬱金香）與尚未解鎖的時代作物，
   否則會出現玩家根本湊不到的委託 */
function questPool(id){
  const p = CHAR_PREFS[id] || {};
  const liked = Object.keys(p.gift || {}).filter(k => p.gift[k] > 0);
  const crops = Object.keys(FARM_CROPS).filter(k => !FARM_CROPS[k].hidden && cropEra(k) <= S.era);
  return [...new Set([...liked, ...crops])];
}
function rollQuestSpec(id){
  const pool = questPool(id);
  if(!pool.length) return null;
  const item = pool[Math.floor(Math.random() * pool.length)];
  return { item, qty: 2 + Math.floor(Math.random() * 4) };     // 2～5 個
}
function questPay(spec){ return Math.max(20, Math.round(ingValue(spec.item) * spec.qty * QUEST_PAY_MUL)); }
function questAff(spec){ return Math.max(2, Math.min(5, 2 + Math.floor(spec.qty / 2))); }

/* ---------------- 委託說辭（AI 或靜態） ---------------- */
const QUEST_WHY_FALLBACK = [
  '我這陣子缺{item}缺得厲害，你要是有多的，能不能勻我一些？',
  '有個老主顧指名要{item}，我一時湊不齊，想拜託你幫個忙。',
  '說來不好意思，我需要一批{item}。你手上要是有，我不會虧待你。',
];
const QUEST_THANKS_FALLBACK = [
  '（接過來仔細看了看）漂亮。這下我可欠你一個人情了。',
  '就知道找你準沒錯。錢收好，別跟我客氣。',
  '（笑）有你這句話我就放心了。以後有需要再找你。',
];
const pickOne = a => a[Math.floor(Math.random() * a.length)];

async function questFlavorBatch(id, specs){
  if(AI_CHAT.mock){
    await new Promise(r => setTimeout(r, 500));
    return specs.map(s => ({ ...s, mock:true,
      why:    `（測試）我最近特別需要${ingNm(s.item)}，能幫我湊${s.qty}個嗎？`,
      thanks: `（測試）${ingNm(s.item)}收到了，謝啦，錢拿去。` }));
  }
  if(!AI_CHAT.enabled || !AI_CHAT.endpoint) return [];

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), AI_CHAT.timeoutMs);
  try{
    const pref = CHAR_PREFS[id] || {};
    const res = await fetch(AI_CHAT.endpoint, {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-game-token':AI_CHAT.token },
      signal: ctl.signal,
      body: JSON.stringify({
        kind:'quest',
        name: charName(id),
        seed: pref.seed || '',
        aff: (S.port.relations[id]||{}).aff || 0,
        era: S.era,
        asks: specs.map(s => ({ item: ingNm(s.item), qty: s.qty })),
      }),
    });
    if(!res.ok) return [];
    const items = (await res.json()).items;
    if(!Array.isArray(items)) return [];
    return items.map((f, i) => specs[i] && typeof f.why === 'string' && typeof f.thanks === 'string'
      ? { ...specs[i], why: f.why, thanks: f.thanks } : null).filter(Boolean);
  }catch{
    return [];
  }finally{
    clearTimeout(timer);
  }
}

/* ---------------- 存貨（比照聊天的預生成） ---------------- */
const _qRefilling = {};
function qCacheFor(id){
  if(!S.questCache) S.questCache = {};
  if(!S.questCache[id]) S.questCache[id] = [];
  return S.questCache[id];
}
function qCachePurgeMock(id){
  const q = qCacheFor(id);
  if(AI_CHAT.mock) return q;
  const kept = q.filter(x => !x.mock);
  if(kept.length !== q.length){ S.questCache[id] = kept; save(); }
  return S.questCache[id];
}
function qCacheRefill(id){
  if(!AI_CHAT.enabled || _qRefilling[id]) return;
  const q = qCachePurgeMock(id);
  if(q.length > QUEST_CACHE.refillAt) return;
  const specs = [];
  for(let i = q.length; i < QUEST_CACHE.target; i++){
    const s = rollQuestSpec(id);
    if(s) specs.push(s);
  }
  if(!specs.length) return;
  _qRefilling[id] = true;
  questFlavorBatch(id, specs)
    .then(list => { if(list.length){ qCacheFor(id).push(...list); save(); } })
    .catch(() => {})
    .finally(() => { _qRefilling[id] = false; });
}

/* ---------------- 產生／完成 ---------------- */
function maybeOfferQuest(id){
  if(!S.quests) S.quests = {};
  if(!S.questRoll) S.questRoll = {};
  if(S.quests[id]) return;                                   // 一次只給一個
  const rel = S.port.relations[id];
  if(!rel || (rel.aff || 0) < QUEST_MIN_AFF) return;          // 不熟不會開口
  if(S.questRoll[id] === S.day) return;                       // 每天最多問一次
  S.questRoll[id] = S.day;
  if(Math.random() > QUEST_CHANCE) return;

  const hit = qCachePurgeMock(id).shift();
  const spec = hit || rollQuestSpec(id);
  if(!spec) return;

  S.quests[id] = {
    item: spec.item, qty: spec.qty,
    money: questPay(spec), aff: questAff(spec),
    why:    hit ? hit.why    : pickOne(QUEST_WHY_FALLBACK).replace('{item}', ingNm(spec.item)),
    thanks: hit ? hit.thanks : pickOne(QUEST_THANKS_FALLBACK),
    day: S.day,
  };
  save();
}

function questHave(k){ return (S.store[k] || 0) + (S.extras[k] || 0); }

function deliverQuest(id){
  const q = S.quests && S.quests[id];
  if(!q) return;
  if(questHave(q.item) < q.qty){ toast('數量還不夠'); return; }

  let left = q.qty;                                           // store 優先，不足再扣 extras
  const fromStore = Math.min(left, S.store[q.item] || 0);
  if(fromStore){ S.store[q.item] -= fromStore; left -= fromStore; }
  if(left) S.extras[q.item] = (S.extras[q.item] || 0) - left;

  earn(q.money, `${charName(id)}的委託：${ingNm(q.item)}×${q.qty}`);
  S.port.relations[id].aff += q.aff;
  const thanks = q.thanks;
  delete S.quests[id];
  save();

  showDialogue(id, 'happy', `${thanks}（好感 +${q.aff}・$${fmt(q.money)}）`, [
    { t:'不客氣', cls:'green', run:()=>openMerchant(id) } ]);
}

function abandonQuest(id){
  if(!S.quests || !S.quests[id]) return;
  delete S.quests[id];
  save();
  toast('婉拒了這個請求');
  openMerchant(id);
}

/* ---------------- 接進商人選單 ---------------- */
function questBlock(id){
  const q = S.quests && S.quests[id];
  if(!q) return '';
  const have = questHave(q.item), ok = have >= q.qty;
  return `<div style="background:var(--card);border:2px solid var(--gold);border-radius:12px;padding:10px;margin-bottom:10px">
    <div style="font-weight:700;font-size:13px;margin-bottom:4px">📋 他想拜託你</div>
    <div style="font-size:14px;line-height:1.5;margin-bottom:8px">${q.why}</div>
    <div class="row" style="padding:4px 0"><div class="e">${prodIcon(q.item,24)}</div>
      <div class="info"><div class="n">${ingNm(q.item)} ${have}/${q.qty}</div>
      <div class="small">報酬 $${fmt(q.money)}・好感 +${q.aff}</div></div></div>
    <div style="display:flex;gap:6px;margin-top:6px">
      <button class="btn sm ${ok?'green':'dis'}" style="flex:2"
        ${ok?`onclick="deliverQuest('${id}')"`:''}>${ok?'交給他':'還沒湊齊'}</button>
      <button class="btn sm ghost" style="flex:1" onclick="abandonQuest('${id}')">婉拒</button>
    </div></div>`;
}

const _openMerchantQuest = openMerchant;
openMerchant = function(id){
  maybeOfferQuest(id);
  qCacheRefill(id);
  _openMerchantQuest(id);
  const head = document.querySelector('#sheet .sheethead');
  const block = questBlock(id);
  if(head && block) head.insertAdjacentHTML('afterend', block);
};

const _startGameQuest = startGame;
startGame = function(n){
  _startGameQuest(n);
  if(!S.quests)     S.quests = {};                            // 舊存檔相容
  if(!S.questRoll)  S.questRoll = {};
  if(!S.questCache) S.questCache = {};
  save();
};
