/* =========================================================
   16_custom_recipe.js — 自訂食譜（純本地，不連網）
   玩家決定：材料、揉製、烘烤、名稱、圖示
   遊戲決定：售價（由材料成本算出，玩家改不了）

   自訂食譜會在開檔時併進 RECIPES，所以 matchRecipe／食譜本／
   出爐／販售全部自動支援，不需要動 01-15 任何一行。
   ========================================================= */

const CUSTOM_PRICE_MUL = 1.4;    // 售價 = 材料成本 × 這個倍率
const CUSTOM_BATCH     = 30;     // 與既有食譜一致
const PAINT_GRID       = 32;     // 對齊既有的 food_*.png，它們全是 32×32
const PAINT_CELL       = 10;     // 編輯時每格畫多大（32×10 = 320px 畫布）
/* 烤秒數固定三檔，彼此相距 4 秒：matchRecipe 容許 ±1.5 秒，
   間隔小於 3 秒的兩道同材料食譜會互相蓋掉，所以不能讓玩家自由填 */
const BAKE_CHOICES = [
  { ms: 5000,  nm: '5 分鐘（快炒）' },
  { ms: 9000,  nm: '9 分鐘（中火）' },
  { ms: 13000, nm: '13 分鐘（慢燉）' },
];
/* 預設色盤。px 陣列存的是實際色碼字串（或 0 = 空白），不是索引，
   這樣色環選的任意顏色才放得進去 */
const PAINT_COLORS = [
  '#3b2a1a', '#8b5a2b', '#c8874a', '#e8c48a', '#f3e4c0',
  '#7a2d2d', '#c0392b', '#e8734a', '#d9a441', '#f2d94e',
  '#4a6b2a', '#7fa650', '#b6d07a', '#2e5f6b', '#6fa8bd',
];

const esc = s => String(s).replace(/[<>&"']/g, '');

function ingValue(k){
  if(PRODUCTS[k]) return PRODUCTS[k].base;
  if(EXTRAS[k])   return EXTRAS[k].price;
  return 5;
}
function customPrice(ings){
  let c = 0;
  for(const k in ings) c += ingValue(k) * ings[k];
  return Math.max(5, Math.round(c * CUSTOM_PRICE_MUL));
}

/* matchRecipe 回傳第一個命中的食譜，所以「同材料且烤秒數太近」的兩道會互相遮蔽。
   建立前先擋下來，否則玩家會做出一道永遠煮不出來的菜。 */
function recipeClash(ings, bakeMs, skipId){
  const keys = Object.keys(ings);
  for(const k in RECIPES){
    if(k === skipId) continue;
    const need = RECIPES[k].ingredients || {};
    if(Object.keys(need).length !== keys.length) continue;
    if(keys.some(i => need[i] !== ings[i])) continue;
    if(Math.abs((RECIPES[k].bakeMs || BAKE_MS) - bakeMs) < 3000) return k;
  }
  return null;
}

function registerCustomRecipe(id, r){
  RECIPES[id] = {
    nm: r.nm, e: '🍲', price: r.price, batch: CUSTOM_BATCH,
    knead: r.knead, bakeMs: r.bakeMs, ingredients: r.ingredients, custom: true,
  };
  if(r.img){
    FOOD_IMG_SRC[id] = r.img;                       // 食譜本／餐廳選單的圖示
    const im = new Image(); im.src = r.img;
    NPC_IMG['food_' + id + '.png'] = im;            // 廚房桌上那張圖，預先塞進快取
  }
  if(!S.recipesCooked) S.recipesCooked = {};
  S.recipesCooked[id] = true;
}

/* ---------------- 設計中的草稿 ---------------- */
let rDraft = null;
function newDraft(){
  return { ings:{}, knead:3, bake:9000, nm:'', px:new Array(PAINT_GRID*PAINT_GRID).fill(0) };
}

function openCustomRecipe(){
  if(!rDraft) rDraft = newDraft();
  const d = rDraft;

  const chosen = Object.keys(d.ings).filter(k => d.ings[k] > 0);
  const price  = chosen.length ? customPrice(d.ings) : 0;

  const chosenHtml = chosen.length ? chosen.map(k =>
    `<div class="row"><div class="e">${prodIcon(k,24)}</div>
     <div class="info"><div class="n">${ingNm(k)} <span class="small">×${d.ings[k]}</span></div></div>
     <button class="btn sm ghost" onclick="draftIng('${k}',-1)">−</button>
     <button class="btn sm" onclick="draftIng('${k}',1)">＋</button></div>`).join('')
    : '<div class="empty-note">還沒選材料。</div>';

  const bag = [];
  const seen = {};
  for(const k in S.store)  if(S.store[k]  > 0){ seen[k]=true; bag.push(k); }
  for(const k in S.extras) if(S.extras[k] > 0 && !seen[k]) bag.push(k);
  const bagHtml = bag.length ? bag.filter(k => !d.ings[k]).map(k =>
    `<div class="row"><div class="e">${prodIcon(k,24)}</div>
     <div class="info"><div class="n">${ingNm(k)} <span class="small">庫存 ${(S.store[k]||0)+(S.extras[k]||0)}</span></div></div>
     <button class="btn sm gold" onclick="draftIng('${k}',1)">選用</button></div>`).join('')
    : '<div class="empty-note">背包沒有材料，先去農田收成或買東西。</div>';

  const kneadBtns = [0,1,2,3,4,5,6].map(n =>
    `<button class="btn sm ${d.knead===n?'green':'ghost'}" onclick="draftKnead(${n})">${n}</button>`).join('');
  const bakeBtns = BAKE_CHOICES.map(b =>
    `<button class="btn sm ${d.bake===b.ms?'green':'ghost'}" style="width:100%;margin-bottom:4px"
      onclick="draftBake(${b.ms})">${b.nm}</button>`).join('');

  const painted = d.px.some(v => v);

  openSheet(`<div class="sheethead"><h3>🧪 研發新料理</h3><button class="close" onclick="closeSheet()">✕</button></div>
    <div class="small" style="margin-bottom:8px">選材料、決定做法、取名字、畫張圖。售價由材料成本自動算出。</div>

    <b class="small">已選材料</b>${chosenHtml}
    <div class="hr"></div><b class="small">從背包加入</b>${bagHtml}

    <div class="hr"></div><b class="small">揉製次數</b>
    <div style="display:flex;gap:4px;margin:6px 0">${kneadBtns}</div>

    <b class="small">烘烤時間</b>
    <div style="margin:6px 0">${bakeBtns}</div>

    <div class="hr"></div><b class="small">料理名稱</b>
    <input id="rcName" maxlength="12" value="${esc(d.nm)}" oninput="rDraft.nm=this.value"
      placeholder="例：葡式鱈魚湯" style="width:100%;padding:8px;margin:6px 0;font-family:inherit;
      font-size:14px;border:2px solid var(--line2);border-radius:8px;background:var(--card);color:var(--ink)">

    <button class="btn ghost" style="width:100%;margin:6px 0" onclick="openRecipePaint()">
      🎨 ${painted ? '修改圖示' : '畫一張圖示'}</button>

    <div class="hr"></div>
    <div class="row"><div class="info"><div class="n">預估售價</div>
      <div class="small">材料成本 × ${CUSTOM_PRICE_MUL}，不能自訂</div></div>
      <div class="price">$${price}</div></div>

    <button class="btn gold" style="width:100%;margin-top:10px" onclick="createCustomRecipe()">建立食譜</button>`);
}

function draftIng(k, delta){
  const d = rDraft;
  const cur = d.ings[k] || 0;
  if(delta > 0 && cur === 0 && Object.keys(d.ings).filter(x=>d.ings[x]>0).length >= 5){
    toast('一道菜最多 5 種材料'); return;
  }
  const next = Math.max(0, Math.min(5, cur + delta));
  if(next === 0) delete d.ings[k]; else d.ings[k] = next;
  openCustomRecipe();
}
function draftKnead(n){ rDraft.knead = n; openCustomRecipe(); }
function draftBake(ms){ rDraft.bake = ms; openCustomRecipe(); }

/* ---------------- 圖示編輯器 ---------------- */
let paintColor = '#3b2a1a';
let paintTool  = 'pen';          // pen | line | pick
const TOOL_HINT = {
  pen:  '按住拖曳可以連續畫。',
  line: '從起點按住拖到終點放開，會畫出直線。',
  pick: '點畫布上任何一格，就會取用那格的顏色。',
};

function openRecipePaint(){
  const sw = PAINT_COLORS.map(c =>
    `<button onclick="paintPick('${c}')" style="width:26px;height:26px;border-radius:6px;
      border:${paintColor===c?'3px solid var(--accent)':'2px solid var(--line2)'};
      background:${c}"></button>`).join('');

  const tool = (id, label) =>
    `<button class="btn sm ${paintTool===id?'green':'ghost'}" style="flex:1" onclick="paintSetTool('${id}')">${label}</button>`;

  openSheet(`<div class="sheethead"><h3>🎨 畫圖示</h3><button class="close" onclick="openCustomRecipe()">✕</button></div>
    <div class="small" style="margin-bottom:8px">${TOOL_HINT[paintTool]}</div>
    <div style="display:flex;gap:5px;margin-bottom:8px">
      ${tool('pen','✏️ 筆刷')}${tool('line','📏 直線')}${tool('pick','💧 選色')}
      <button class="btn sm ${paintColor===null?'green':'ghost'}" style="flex:1" onclick="paintPick(null)">🧽 橡皮擦</button>
    </div>
    <div style="text-align:center;margin-bottom:10px">
      <canvas id="rcPaint" width="${PAINT_GRID*PAINT_CELL}" height="${PAINT_GRID*PAINT_CELL}"
        style="width:100%;max-width:${PAINT_GRID*PAINT_CELL}px;aspect-ratio:1;border:2px solid var(--line2);
        border-radius:8px;background:var(--card);touch-action:none;cursor:crosshair"></canvas>
    </div>
    <div style="display:flex;align-items:flex-end;justify-content:center;gap:18px;margin-bottom:10px">
      <div style="text-align:center">
        <canvas id="rcPrevTable" width="${PAINT_GRID}" height="${PAINT_GRID}"
          style="width:62px;height:62px;image-rendering:pixelated"></canvas>
        <div class="small">廚房桌上</div>
      </div>
      <div style="text-align:center">
        <canvas id="rcPrevList" width="${PAINT_GRID}" height="${PAINT_GRID}"
          style="width:32px;height:32px;image-rendering:pixelated"></canvas>
        <div class="small">清單圖示</div>
      </div>
    </div>
    <div style="display:flex;gap:12px;align-items:flex-start;justify-content:center;margin-bottom:10px">
      <canvas id="rcWheel" width="${WHEEL_W}" height="${WHEEL_W}"
        style="flex:none;touch-action:none;cursor:crosshair"></canvas>
      <div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;max-width:160px">${sw}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:10px">
          <span id="rcCur" style="width:30px;height:30px;border-radius:6px;border:2px solid var(--ink2);
            background:${paintColor || 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50%/8px 8px'}"></span>
          <span class="small" id="rcHex">${paintColor || '橡皮擦'}</span>
        </div>
      </div>
    </div>
    <button class="btn ghost sm" style="width:100%;margin-bottom:6px" onclick="paintClear()">🗑️ 全部清掉</button>
    <button class="btn green" style="width:100%" onclick="openCustomRecipe()">完成</button>`);

  bindPaint();
  bindWheel();
}
function paintPick(c){ paintColor = c; if(c) hsv = hex2hsv(c); openRecipePaint(); }
function paintSetTool(t){ paintTool = t; openRecipePaint(); }

/* ---------------- 內嵌色環（外圈色相 + 內部飽和度／明度） ---------------- */
const WHEEL_W = 132, W_OUT = 64, W_IN = 50;
const W_SQ = Math.floor(W_IN * Math.SQRT1_2 * 2) - 2;   // 內接正方形
let hsv = { h: 25, s: 0.72, v: 0.23 };                  // 對應預設的 #3b2a1a

function hsv2hex(h, s, v){
  const f = n => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return '#' + [f(5), f(3), f(1)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function hex2hsv(hex){
  const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx - mn;
  let h = 0;
  if(d){
    if(mx === r) h = ((g - b) / d) % 6;
    else if(mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}

function drawWheel(){
  const cv = document.getElementById('rcWheel'); if(!cv) return;
  const c = cv.getContext('2d'), m = WHEEL_W / 2;
  c.clearRect(0,0,WHEEL_W,WHEEL_W);

  for(let a = 0; a < 360; a++){                      // 色相環：一度一片扇形
    const r0 = (a - 0.7) * Math.PI/180, r1 = (a + 0.7) * Math.PI/180;
    c.beginPath();
    c.arc(m, m, W_OUT, r0, r1);
    c.arc(m, m, W_IN,  r1, r0, true);
    c.closePath();
    c.fillStyle = `hsl(${a},100%,50%)`;
    c.fill();
  }

  const sx = m - W_SQ/2, sy = m - W_SQ/2;
  c.fillStyle = hsv2hex(hsv.h, 1, 1);
  c.fillRect(sx, sy, W_SQ, W_SQ);
  let g = c.createLinearGradient(sx, 0, sx + W_SQ, 0);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(sx, sy, W_SQ, W_SQ);
  g = c.createLinearGradient(0, sy, 0, sy + W_SQ);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  c.fillStyle = g; c.fillRect(sx, sy, W_SQ, W_SQ);

  const ring = (x, y, r) => {                        // 兩層描邊，深淺底色上都看得見
    c.beginPath(); c.arc(x, y, r, 0, 7);
    c.strokeStyle = '#000'; c.lineWidth = 3; c.stroke();
    c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke();
  };
  const ha = hsv.h * Math.PI/180, hr = (W_OUT + W_IN)/2;
  ring(m + Math.cos(ha)*hr, m + Math.sin(ha)*hr, 5);
  ring(sx + hsv.s * W_SQ, sy + (1 - hsv.v) * W_SQ, 5);
}

function applyColor(hex){
  paintColor = hex;
  const cur = document.getElementById('rcCur'), hx = document.getElementById('rcHex');
  if(cur) cur.style.background = hex;
  if(hx)  hx.textContent = hex;
  drawWheel();
}

function bindWheel(){
  const cv = document.getElementById('rcWheel'); if(!cv) return;
  const m = WHEEL_W / 2, sx = m - W_SQ/2, sy = m - W_SQ/2;
  let mode = null;

  const at = ev => {
    const r = cv.getBoundingClientRect();
    return [ (ev.clientX - r.left) / r.width * WHEEL_W, (ev.clientY - r.top) / r.height * WHEEL_W ];
  };
  const upd = (x, y) => {
    if(mode === 'hue'){
      hsv.h = (Math.atan2(y - m, x - m) * 180/Math.PI + 360) % 360;
    }else{
      hsv.s = Math.max(0, Math.min(1, (x - sx) / W_SQ));
      hsv.v = Math.max(0, Math.min(1, 1 - (y - sy) / W_SQ));
    }
    applyColor(hsv2hex(hsv.h, hsv.s, hsv.v));
  };

  cv.addEventListener('pointerdown', e => {
    const [x, y] = at(e), d = Math.hypot(x - m, y - m);
    if(d <= W_OUT && d >= W_IN) mode = 'hue';
    else if(x >= sx && x <= sx + W_SQ && y >= sy && y <= sy + W_SQ) mode = 'sv';
    else return;
    cv.setPointerCapture(e.pointerId);
    upd(x, y);
  });
  cv.addEventListener('pointermove', e => { if(mode){ const [x,y] = at(e); upd(x,y); } });
  cv.addEventListener('pointerup',   () => { mode = null; });

  drawWheel();
}
function paintClear(){ rDraft.px.fill(0); drawPaint(); }

/* Bresenham：直線工具要走過的格子 */
function linePixels(x0,y0,x1,y1){
  const out = [], dx = Math.abs(x1-x0), dy = -Math.abs(y1-y0);
  const sx = x0<x1 ? 1 : -1, sy = y0<y1 ? 1 : -1;
  let err = dx + dy;
  for(;;){
    out.push([x0,y0]);
    if(x0===x1 && y0===y1) break;
    const e2 = 2*err;
    if(e2 >= dy){ err += dy; x0 += sx; }
    if(e2 <= dx){ err += dx; y0 += sy; }
  }
  return out;
}

function drawPaint(ghost){
  const cv = document.getElementById('rcPaint'); if(!cv) return;
  const c = cv.getContext('2d');
  c.clearRect(0,0,cv.width,cv.height);
  for(let y=0; y<PAINT_GRID; y++) for(let x=0; x<PAINT_GRID; x++){
    const v = rDraft.px[y*PAINT_GRID+x];
    if(v){ c.fillStyle = v; c.fillRect(x*PAINT_CELL, y*PAINT_CELL, PAINT_CELL, PAINT_CELL); }
  }
  if(ghost){                                    // 直線工具拖曳中的預覽
    c.globalAlpha = 0.55;
    c.fillStyle = paintColor || '#ffffff';
    for(const [x,y] of ghost) c.fillRect(x*PAINT_CELL, y*PAINT_CELL, PAINT_CELL, PAINT_CELL);
    c.globalAlpha = 1;
  }
  c.lineWidth = 1;
  for(let i=1; i<PAINT_GRID; i++){
    c.strokeStyle = i % 8 ? 'rgba(0,0,0,.07)' : 'rgba(0,0,0,.22)';   // 每 8 格一條深線好定位
    c.beginPath(); c.moveTo(i*PAINT_CELL,0); c.lineTo(i*PAINT_CELL,cv.height); c.stroke();
    c.beginPath(); c.moveTo(0,i*PAINT_CELL); c.lineTo(cv.width,i*PAINT_CELL); c.stroke();
  }
  drawPreviews();
}
/* 放大畫跟實際大小差很多，所以同步顯示遊戲內的真實尺寸 */
function drawPreviews(){
  for(const id of ['rcPrevTable','rcPrevList']){
    const pv = document.getElementById(id); if(!pv) continue;
    const p = pv.getContext('2d');
    p.clearRect(0,0,PAINT_GRID,PAINT_GRID);
    for(let y=0; y<PAINT_GRID; y++) for(let x=0; x<PAINT_GRID; x++){
      const v = rDraft.px[y*PAINT_GRID+x];
      if(v){ p.fillStyle = v; p.fillRect(x,y,1,1); }
    }
  }
}
function bindPaint(){
  const cv = document.getElementById('rcPaint'); if(!cv) return;
  let down = false, start = null;

  const cell = ev => {
    const r = cv.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) / r.width  * PAINT_GRID);
    const y = Math.floor((ev.clientY - r.top)  / r.height * PAINT_GRID);
    return (x<0||y<0||x>=PAINT_GRID||y>=PAINT_GRID) ? null : [x,y];
  };
  const paint = (x,y) => { rDraft.px[y*PAINT_GRID+x] = paintColor || 0; };

  cv.addEventListener('pointerdown', e => {
    const p = cell(e); if(!p) return;
    cv.setPointerCapture(e.pointerId);
    if(paintTool === 'pick'){
      paintTool = 'pen';                      // 取完色直接回到筆刷，少按一次
      paintPick(rDraft.px[p[1]*PAINT_GRID+p[0]] || null);
      return;
    }
    down = true; start = p;
    if(paintTool === 'pen'){ paint(p[0],p[1]); drawPaint(); }
    else drawPaint(linePixels(p[0],p[1],p[0],p[1]));
  });

  cv.addEventListener('pointermove', e => {
    if(!down) return;
    const p = cell(e); if(!p) return;
    if(paintTool === 'pen'){ paint(p[0],p[1]); drawPaint(); }
    else drawPaint(linePixels(start[0],start[1],p[0],p[1]));
  });

  cv.addEventListener('pointerup', e => {
    if(down && paintTool === 'line'){
      const p = cell(e) || start;
      for(const [x,y] of linePixels(start[0],start[1],p[0],p[1])) paint(x,y);
    }
    down = false; start = null; drawPaint();
  });

  drawPaint();
}
/* 匯出成 16×16 的 PNG dataURL，約 1KB，塞得進 localStorage */
function paintToDataURL(){
  const cv = document.createElement('canvas');
  cv.width = PAINT_GRID; cv.height = PAINT_GRID;
  const c = cv.getContext('2d');
  for(let y=0; y<PAINT_GRID; y++) for(let x=0; x<PAINT_GRID; x++){
    const v = rDraft.px[y*PAINT_GRID+x];
    if(v){ c.fillStyle = v; c.fillRect(x,y,1,1); }
  }
  return cv.toDataURL('image/png');
}

/* ---------------- 建立 ---------------- */
function createCustomRecipe(){
  const d = rDraft;
  const nm = esc((d.nm || '').trim()).slice(0, 12);
  const ings = {};
  for(const k in d.ings) if(d.ings[k] > 0) ings[k] = d.ings[k];

  if(!nm){ toast('先取個名字'); return; }
  if(!Object.keys(ings).length){ toast('至少要選一種材料'); return; }
  if(!d.px.some(v => v)){ toast('先畫一張圖示'); return; }

  const clash = recipeClash(ings, d.bake, null);
  if(clash){
    toast(`跟「${RECIPES[clash].nm}」的材料和烤法太像，換個材料或烤法`);
    return;
  }

  const id = 'cx_' + Date.now().toString(36);
  const rec = { nm, ings: undefined, ingredients: ings, knead: d.knead,
                bakeMs: d.bake, price: customPrice(ings), img: paintToDataURL() };
  delete rec.ings;

  if(!S.customRecipes) S.customRecipes = {};
  S.customRecipes[id] = rec;
  registerCustomRecipe(id, rec);
  save();

  rDraft = null;
  toast(`📔 新食譜「${nm}」完成了！售價 $${rec.price}`);
  openPickRecipe();
}

function deleteCustomRecipe(id){
  if(!S.customRecipes || !S.customRecipes[id]) return;
  const nm = S.customRecipes[id].nm;
  delete S.customRecipes[id];
  delete RECIPES[id];
  delete FOOD_IMG_SRC[id];
  if(S.recipesCooked) delete S.recipesCooked[id];
  save();
  toast(`刪掉了「${nm}」`);
  openPickRecipe();
}

/* ---------------- 接上既有流程 ---------------- */
const _startGameCustom = startGame;
startGame = function(n){
  _startGameCustom(n);
  if(!S.customRecipes) S.customRecipes = {};          // 舊存檔相容
  for(const id in S.customRecipes) registerCustomRecipe(id, S.customRecipes[id]);
  save();
};

const _openPickRecipeBase = openPickRecipe;
openPickRecipe = function(){
  _openPickRecipeBase();
  const head = document.querySelector('#sheet .sheethead');
  if(!head) return;
  let extra = `<button class="btn gold" style="width:100%;margin:8px 0" onclick="openCustomRecipe()">🧪 研發新料理</button>`;
  const mine = Object.keys(S.customRecipes || {});
  if(mine.length){
    extra += `<div class="small" style="margin-bottom:4px">我設計的料理</div>` + mine.map(id =>
      `<div class="row"><div class="e">${dishIcon(id)}</div>
       <div class="info"><div class="n">${S.customRecipes[id].nm}</div>
       <div class="small">$${S.customRecipes[id].price}</div></div>
       <button class="btn sm ghost" style="color:var(--danger)" onclick="deleteCustomRecipe('${id}')">刪除</button></div>`).join('')
      + `<div class="hr"></div>`;
  }
  head.insertAdjacentHTML('afterend', extra);
};
