/* =========================================================
   18_dutch_shop.js — 別人研發的食譜
   自己研發的自己免費用；別人研發的要在霍蘭德的商店花錢買。

   共享食譜註冊時帶上 shop:true 與 learnCost，就直接進了商店
   既有的「📖 配方」區，沿用 openShopBuy 與 buyRecipe，
   不另開選單、不另寫購買流程。

   學費由材料成本推算，投稿者決定不了——同自訂食譜售價、
   聊天好感插槽、委託報酬的原則：創意歸玩家，數值歸遊戲。

   目前資料來源是 mock，之後接 D1 只要改 fetchShared()。
   ========================================================= */

const LEARN_MUL = 2.8;      // 學費 = 材料成本 × 這個
const LEARN_MIN = 40;

const SHARED = {
  mock: true,               // true = 用內建範例，完全不連網
  endpoint: '',             // 部署後填：https://farmgame-ai.你的帳號.workers.dev/recipes
  token: '',                // 對應 Worker 的 GAME_TOKEN
  timeoutMs: 8000,
};

/* 匿名身分：投稿次數限制要靠它，不做帳號系統 */
function playerId(){
  if(!S.playerId){
    S.playerId = 'p' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    save();
  }
  return S.playerId;
}

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

/* shop:true + learnCost 就會自動出現在商店的「📖 配方」區 */
function registerShared(){
  for(const r of (S.sharedRecipes || [])){
    if(RECIPES[r.id]) continue;
    if(S.customRecipes && S.customRecipes[r.id]) continue;        // 自己研發的不用跟人買
    if(recipeClash(r.ingredients, r.bakeMs, r.id)) continue;      // 會遮蔽既有食譜就不收
    RECIPES[r.id] = {
      nm: esc(r.nm).slice(0, 16), e:'🍲',
      price: customPrice(r.ingredients), batch: CUSTOM_BATCH,
      knead: r.knead, bakeMs: r.bakeMs, ingredients: r.ingredients,
      custom: true, shared: true, author: esc(r.author || '').slice(0, 16),
      shop: true, learnCost: learnCost(r.ingredients),
    };
    if(r.img && /^data:image\/png;base64,/.test(r.img)) FOOD_IMG_SRC[r.id] = r.img;
  }
}

/* ---------------- 投稿 ---------------- */
async function shareRecipe(id){
  const r = S.customRecipes && S.customRecipes[id];
  if(!r) return;
  if(r.submitted){ toast('這道已經投稿過了'); return; }
  if(!SHARED.endpoint){ toast('還沒設定投稿位址'); return; }

  toast('投稿中…');
  try{
    const res = await fetch(SHARED.endpoint, {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-game-token':SHARED.token },
      body: JSON.stringify({
        nm:r.nm, ingredients:r.ingredients, knead:r.knead, bakeMs:r.bakeMs,
        img:r.img, author:user || '', authorId:playerId(),
      }),
    });
    const b = await res.json().catch(() => ({}));
    if(!res.ok){
      toast(b.error === 'daily limit reached' ? '今天投稿次數已用完' : `投稿失敗：${b.error || res.status}`);
      return;
    }
    r.submitted = true; save();
    toast('📮 投稿完成，審核通過後就會出現在商店');
    openPickRecipe();
  }catch{
    toast('連不上，晚點再試');
  }
}

const _openShopBuyShared = openShopBuy;
openShopBuy = function(){
  registerShared();
  refreshShared();                                                // 背景更新，不擋畫面
  _openShopBuyShared();
};

const _startGameShared = startGame;
startGame = function(n){
  _startGameShared(n);
  if(!S.sharedRecipes) S.sharedRecipes = [];                      // 舊存檔相容
  registerShared();
  save();
};
