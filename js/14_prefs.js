/* =========================================================
   14_prefs.js — 角色送禮偏好
   1) CHAR_PREFS：每個角色喜歡／討厭什麼，好感度加權
   2) giveGift：改成查表給分（查不到維持原本 +3，舊角色不受影響）
   3) openGift：送過的偏好會標記出來，愛物排到最前面

   這張表之後也會餵給 AI 當「硬約束」：AI 只能暗示這裡有的東西，
   不准自己發明喜好，否則玩家送了會發現對不上。
   ========================================================= */

/* 分數門檻：>=LOVE 最愛、>=LIKE 喜歡、<0 討厭、其餘普通 */
const GIFT_LOVE = 8, GIFT_LIKE = 4, GIFT_BASE = 3;

const CHAR_PREFS = {
  Francis: {
    seed: '酒商，法國人，講話浪漫愛調情。懂吃懂喝，對搭配很講究。',
    gift: { cheese:10, strawberry:6, butter:5, lemon:4, olive_oil:4, wine:-2 },
    react: {
      cheese:'（眼睛一亮）乳酪？你知道這配我櫃上那支紅酒有多完美嗎……今晚別走了，陪我開一支。',
      wine:'（挑眉）……這支，是我上禮拜賣給你的吧？親愛的，下次讓我驚喜一點嘛。'
    }
  },
  Pedro: {
    seed: '香料商，伊比利半島出身，嗓門大、話多、講到吃的就停不下來。',
    gift: { cod:10, mutton:6, saffron:5, olive_oil:4, tomato:4, cinnamon:-2 },
    react: {
      cod:'（整個人跳起來）鱈魚——！你怎麼知道的啦！這個用奶油跟馬鈴薯下去燉，我阿嬤的做法，改天煮給你吃！說定了喔！',
      cinnamon:'（看看肉桂，看看自己的攤子）……亞瑟，這個我攤上一大罐欸。'
    }
  },
  Antonio: {
    seed: '進口水果行，熱情直率，講話跳來跳去，很愛推薦東西給人。',
    gift: { strawberry:10, lemon:6, tomato:5, carrot:4, coconut:-2 },
    react: {
      strawberry:'（捧在手上轉了一圈）這是你自己種的對吧？我進口再多水果，都比不上這顆。……我要留著慢慢吃。',
      coconut:'（默默指向自己的攤子）那邊一整籃都是椰子。'
    }
  },
  Alfred: {
    seed: '19世紀的暴發戶，自信誇張，愛被誇獎，講話像在演英雄劇。',
    gift: { beef:10, turkey_meat:6, cheese:5, potato:4, sugar:-2 },
    react: {
      beef:'牛肉！這才叫招待英雄的規格嘛！（拍胸）放心，我會吃得乾乾淨淨，一塊都不剩！',
      sugar:'欸……糖？我攤子上那袋三十磅的，就是糖。'
    }
  },
  Matthew: {
    seed: '阿爾弗雷德的雙胞胎弟弟，安靜細心，說話輕、容易被忽略。',
    gift: { milk:10, egg:6, butter:5, herring:4, maple_syrup:-2 },
    react: {
      milk:'（小聲）牛奶……謝謝你。我熱一杯，加一點楓糖，就很好喝了。……要不要留下來一起喝？',
      maple_syrup:'（很小聲）那個……楓糖漿是我賣的。不過你記得我做這個，我還是很高興。'
    }
  },
};

/* 種子不算真心意，一律基準分（也避免草莓種子被當成草莓算） */
function giftScore(id, kind, k){
  if(kind === 'seed') return GIFT_BASE;
  const p = CHAR_PREFS[id];
  if(!p || !(k in p.gift)) return GIFT_BASE;
  return p.gift[k];
}
function giftTier(sc){
  return sc >= GIFT_LOVE ? 'love' : sc >= GIFT_LIKE ? 'like' : sc < 0 ? 'hate' : 'ok';
}
/* 玩家已經試出來的偏好：S.giftFound[角色id][物品k]=true */
function giftFound(id){
  if(!S.giftFound) S.giftFound = {};
  if(!S.giftFound[id]) S.giftFound[id] = {};
  return S.giftFound[id];
}

giveGift = function(id, kind, k){
  const bag = kind==='seed' ? S.seeds : (kind==='store' ? S.store : S.extras);
  if(!bag[k] || bag[k] <= 0){ toast('沒有這個東西'); return; }

  const sc = giftScore(id, kind, k), tier = giftTier(sc);
  bag[k]--;
  if(!S.port.relations[id]) S.port.relations[id] = { aff:0, met:true, lastChat:0 };
  S.port.relations[id].aff += sc;
  if(tier !== 'ok') giftFound(id)[k] = true;
  save();

  const pref = CHAR_PREFS[id] || {};
  const custom = pref.react && pref.react[k];
  const delta = `（好感 ${sc>=0?'+':''}${sc}）`;

  /* 最愛跟討厭是值得記住的時刻，給完整對話框；其餘維持原本的 toast 節奏 */
  if(tier === 'love' || tier === 'hate'){
    const fallback = tier === 'love'
      ? '（整個人亮了起來）這個……你怎麼知道我喜歡？我會好好收著的。'
      : '（表情微妙）……謝、謝謝你的心意。';
    showDialogue(id, tier==='love' ? 'love' : 'sad', (custom || fallback) + delta,
      [{ t:'結束', cls:'green', run:()=>openMerchant(id) }]);
    return;
  }
  const nm = (MERCHANTS[id]||{}).nm || id;
  toast(tier==='like' ? `🎁 ${nm} 很喜歡！${delta}` : `🎁 ${nm} 收下了 ${delta}`);
  openMerchant(id);
};

openGift = function(id){
  const found = giftFound(id);
  const items = [];
  for(const k in S.seeds)  if(S.seeds[k]  > 0) items.push({kind:'seed',  k, n:S.seeds[k]});
  for(const k in S.store)  if(S.store[k]  > 0) items.push({kind:'store', k, n:S.store[k]});
  for(const k in S.extras) if(S.extras[k] > 0) items.push({kind:'extra', k, n:S.extras[k]});

  items.forEach(it => { it.sc = giftScore(id, it.kind, it.k); it.known = !!found[it.k]; });
  /* 已知的愛物浮到最前面，其餘維持原順序 */
  items.sort((a,b) => (b.known ? b.sc : 0) - (a.known ? a.sc : 0));

  const body = items.length ? items.map(it => {
    const nm = it.kind==='seed'  ? ((FARM_CROPS[it.k] ? FARM_CROPS[it.k].nm : it.k) + '種子')
             : it.kind==='extra' ? (EXTRAS[it.k] ? EXTRAS[it.k].nm : it.k)
             : (PRODUCTS[it.k] ? PRODUCTS[it.k].nm : (FARM_CROPS[it.k] ? FARM_CROPS[it.k].nm : it.k));
    const tier = giftTier(it.sc);
    const mark = !it.known ? '' : tier==='love' ? ' ❤️' : tier==='like' ? ' 👍' : tier==='hate' ? ' 🚫' : '';
    return `<div class="row"><div class="e">${prodIcon(it.k, 24)}</div>
      <div class="info"><div class="n">${nm}${mark} <span class="small">×${it.n}</span></div></div>
      <button class="btn sm gold" onclick="giveGift('${id}','${it.kind}','${it.k}')">送</button></div>`;
  }).join('') : '<div class="empty-note">背包沒有可送的東西。</div>';

  openSheet(`<div class="sheethead"><h3>🎁 送禮給 ${MERCHANTS[id].nm}</h3><button class="close" onclick="openMerchant('${id}')">✕</button></div>
    <div class="small" style="margin-bottom:8px">送他喜歡的東西，他會特別開心。</div>${body}`);
};

/* 偏好 key 分散在 01/07/08/11 幾個檔案，打錯字不會報錯只會默默失效，開發時先擋一下 */
(function(){
  const bad = [];
  for(const id in CHAR_PREFS)
    for(const k in CHAR_PREFS[id].gift)
      if(!PRODUCTS[k] && !EXTRAS[k] && !FARM_CROPS[k]) bad.push(`${id}.${k}`);
  if(bad.length) console.warn('[14_prefs] 找不到的物品 key：', bad.join(', '));
})();
