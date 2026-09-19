/* =========================================================
   18_dutch_shop.js — 霍蘭德的外地方子
   自己研發的食譜自己免費用；別人研發的要來他這裡花錢學。

   學費由材料成本推算，投稿者決定不了——同自訂食譜售價、
   聊天好感插槽、委託報酬的原則：創意歸玩家，數值歸遊戲。

   目前資料來源是 mock，之後接 D1 只要改 fetchShared()。
   ========================================================= */

const LEARN_MUL = 2.8;      // 學費 = 材料成本 × 這個
const LEARN_MIN = 40;

const SHARED = {
  mock: true,               // true = 用內建範例，完全不連網
  endpoint: '',             // 之後填 D1 的 Worker 端點
  timeoutMs: 8000,
};

const KEEPER_RECIPE_LINES = [
  '「外地傳來的方子。人家想破頭寫出來的，你出點錢就學得走。」',
  '「紙上幾行字，抵得過你在廚房瞎摸三個月。要不要，隨你。」',
  '「我只管收錢。做出來難吃，別回來找我。」',
];

function learnCost(ings){
  let c = 0;
  for(const k in ings) c += ingValue(k) * ings[k];
  return Math.max(LEARN_MIN, Math.round(c * LEARN_MUL));
}

/* ---------------- 共享食譜來源 ---------------- */
function mockIcon(colors){
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const c = cv.getContext('2d');
  c.fillStyle = colors[0]; c.fillRect(8, 14, 16, 10);
  c.fillStyle = colors[1]; c.fillRect(10, 9, 12, 7);
  c.fillStyle = colors[2]; c.fillRect(13, 6, 6, 4);
  return cv.toDataURL('image/png');
}
const MOCK_SHARED = () => ([
  { id:'sh_gouda',    nm:'高達乳酪烤餅', author:'Anneke',
    ingredients:{ cheese:2, flour:1, butter:1 }, knead:3, bakeMs:9000,
    img: mockIcon(['#d9a441','#f2d94e','#c8874a']) },
  { id:'sh_herring',  nm:'醃鯡魚佐洋蔥', author:'Joris',
    ingredients:{ herring:3, onion:1 }, knead:0, bakeMs:5000,
    img: mockIcon(['#6fa8bd','#b6d07a','#f3e4c0']) },
  { id:'sh_stamppot', nm:'荷式馬鈴薯泥', author:'Mieke',
    ingredients:{ potato:3, milk:1, butter:1 }, knead:2, bakeMs:13000,
    img: mockIcon(['#f3e4c0','#7fa650','#e8c48a']) },
]);

async function fetchShared(){
  if(SHARED.mock) return MOCK_SHARED();
  if(!SHARED.endpoint) return [];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SHARED.timeoutMs);
  try{
    const res = await fetch(SHARED.endpoint, { signal: ctl.signal });
    if(!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body.recipes) ? body.recipes : [];
  }catch{
    return [];
  }finally{
    clearTimeout(timer);
  }
}

function sharedValid(r){
  return r && typeof r.id === 'string' && typeof r.nm === 'string' && r.nm.trim()
    && r.ingredients && Object.keys(r.ingredients).length
    && typeof r.knead === 'number' && typeof r.bakeMs === 'number';
}

let _sharedBusy = false;
/* 存進 S，離線也看得到店，不必每次開店重抓 */
function refreshShared(){
  if(_sharedBusy) return;
  _sharedBusy = true;
  fetchShared()
    .then(list => {
      const ok = list.filter(sharedValid);
      if(ok.length){ S.sharedRecipes = ok; registerShared(); save(); }
    })
    .catch(() => {})
    .finally(() => { _sharedBusy = false; });
}

/* 註冊進 RECIPES 才做得出來；學不學得會另外由 S.recipesCooked 控制 */
function registerShared(){
  for(const r of (S.sharedRecipes || [])){
    if(RECIPES[r.id]) continue;
    if(S.customRecipes && S.customRecipes[r.id]) continue;        // 自己做的不重複收
    if(recipeClash(r.ingredients, r.bakeMs, r.id)) continue;      // 會遮蔽既有食譜就不收
    RECIPES[r.id] = {
      nm: esc(r.nm).slice(0, 16), e:'🍲',
      price: customPrice(r.ingredients), batch: CUSTOM_BATCH,
      knead: r.knead, bakeMs: r.bakeMs, ingredients: r.ingredients,
      custom: true, shared: true, author: esc(r.author || '').slice(0, 16),
    };
    if(r.img && /^data:image\/png;base64,/.test(r.img)) FOOD_IMG_SRC[r.id] = r.img;
  }
}

function sharedOnSale(){
  return (S.sharedRecipes || [])
    .filter(r => RECIPES[r.id] && RECIPES[r.id].shared)
    .filter(r => !(S.customRecipes && S.customRecipes[r.id]));    // 自己研發的不用跟他買
}

/* ---------------- 子商店 ---------------- */
function openSharedRecipes(){
  registerShared();
  refreshShared();                                                 // 背景更新，不擋畫面

  const list = sharedOnSale();
  const body = list.length ? list.map(r => {
    const rec = RECIPES[r.id], got = S.recipesCooked && S.recipesCooked[r.id];
    const cost = learnCost(rec.ingredients);
    const ing = Object.keys(rec.ingredients).map(k => `${ingNm(k)}${rec.ingredients[k]}`).join('・');
    return `<div class="row"><div class="e">${dishIcon(r.id)}</div>
      <div class="info"><div class="n">${rec.nm}</div>
        <div class="small">${rec.author ? rec.author + ' 研發' : '無名氏'}・售價 $${rec.price}</div>
        <div class="small" style="color:var(--ink2)">${ing}・揉${rec.knead}次・烤${fmtBakeMin(rec.bakeMs)}</div></div>
      ${got ? '<div class="price">已學會</div>'
            : `<div class="price">$${cost}</div><button class="btn sm gold" onclick="buySharedRecipe('${r.id}')">學</button>`}
      </div>`;
  }).join('') : '<div class="empty-note">最近沒有新方子進來。</div>';

  const line = KEEPER_RECIPE_LINES[(Math.random() * KEEPER_RECIPE_LINES.length) | 0];
  openSheet(`<div class="sheethead"><h3>📜 外地方子</h3><button class="close" onclick="openKeeper()">✕</button></div>
    <div style="background:var(--card);border:2px solid var(--line2);border-radius:12px;padding:10px;margin-bottom:10px;font-size:14px;line-height:1.6">${line}</div>
    <div class="small" style="margin-bottom:8px">💰 現金 $${fmt(S.cash)}・學會之後就會出現在你的食譜本裡</div>
    ${body}`);
}

function buySharedRecipe(id){
  const rec = RECIPES[id];
  if(!rec || !rec.shared) return;
  if(S.recipesCooked && S.recipesCooked[id]){ toast('食譜本已經有這道了'); return; }
  const cost = learnCost(rec.ingredients);
  if(S.cash < cost){ toast('現金不足'); return; }
  spend(cost, `向霍蘭德學${rec.nm}的做法`);
  if(!S.recipesCooked) S.recipesCooked = {};
  S.recipesCooked[id] = true;
  save();
  toast(`📖 學會了 ${rec.nm}！`);
  openSharedRecipes();
}

/* ---------------- 掛進霍蘭德的選單 ---------------- */
const _openKeeperShared = openKeeper;
openKeeper = function(){
  _openKeeperShared();
  const tulipBtn = document.querySelector('#sheet button[onclick="openTulip()"]');
  if(tulipBtn) tulipBtn.insertAdjacentHTML('afterend',
    `<button class="btn gold" style="width:100%;margin-bottom:6px" onclick="openSharedRecipes()">📜 外地方子</button>`);
};

const _startGameShared = startGame;
startGame = function(n){
  _startGameShared(n);
  if(!S.sharedRecipes) S.sharedRecipes = [];                       // 舊存檔相容
  registerShared();
  save();
};
