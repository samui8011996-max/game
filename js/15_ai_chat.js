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

const AI_MOCK = {
  q:'（測試用）今天海風有點大，你那邊的田還撐得住嗎？',
  opts:[
    { t:'（測試）不關你的事。',       r:'……這樣啊，是我多問了。', mood:'sad' },
    { t:'（測試）還行，塌了兩壟。',   r:'兩壟而已？那算你走運了。', mood:'neutral' },
    { t:'（測試）你要不要來幫我看看？', r:'（笑）等我收了攤就過去，你可別反悔。', mood:'happy' } ],
};

async function aiGenerate(id, slots){
  if(AI_CHAT.mock){
    await new Promise(r => setTimeout(r, 900));
    return aiValidate(JSON.parse(JSON.stringify(AI_MOCK)));
  }
  if(!AI_CHAT.endpoint) return null;

  const ctl = new AbortController();
  const timer = setTimeout(()=>ctl.abort(), AI_CHAT.timeoutMs);
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
        tones: slots.map(s=>s.tone),
        hintItem: pickHint(id),
      }),
    });
    if(!res.ok) return null;
    return aiValidate(await res.json());
  }catch{
    return null;
  }finally{
    clearTimeout(timer);
  }
}

const sheetOpen = () => document.getElementById('mask').classList.contains('show');

let _aiSeq = 0;
const _chatMerchantStatic = chatMerchant;

chatMerchant = function(id){
  const rel = S.port.relations[id];
  if(Date.now() - (rel.lastChat||0) < 8000){ toast('剛聊過了，等一下'); return; }
  if(!AI_CHAT.enabled){ _chatMerchantStatic(id); return; }

  const slots = pickSlots(id), seq = ++_aiSeq;
  showDialogue(id, 'neutral', '（……）', [
    { t:'算了', cls:'ghost', run:()=>{ _aiSeq++; openMerchant(id); } } ]);

  aiGenerate(id, slots).then(data => {
    if(seq !== _aiSeq || !sheetOpen()) return;   // 玩家按了算了、又點一次、或跑掉了
    if(!data){ _chatMerchantStatic(id); return; }

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
  });
};
