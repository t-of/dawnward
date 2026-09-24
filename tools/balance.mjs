// 開発用: 自動の打ち手で夜を何度も回して、夜明け率と星の取れ方を測る。ページからは読まない。
//
//   node tools/balance.mjs            刻の負けを 灯 1 / 2 / 全部 で各 200 夜
//   node tools/balance.mjs 50         各 50 夜
//
// 打ち手は 1 ターン先しか読まない（敵の番を実際に回した後の盤の良さで選ぶ）。人にとっての難しさは測っていない。
import * as L from '../logic.js';

const nights = Number(process.argv[2]) || 200;

// 盤の良さ。勝った盤でも灯の数を足す（星を取りに行くように）
function value(s) {
  if (s.outcome === 'lost') return -1e6;
  let v = (s.outcome === 'won' ? 1e6 : 0) + L.nodesOf(s).length * 4800 + s.turn * 40;
  for (const u of L.unitsOf(s)) v += 300 + u.hp * 120;
  for (const f of L.foesOf(s)) v -= 200 + f.hp * 60;
  return v;
}

// 1 つの駒の手の組: 「移動しない / 動ける先全部」×「行動しない / できる行動全部」
function combos(s, id) {
  const out = [[]];
  const u = L.byId(s, id);
  if (!u) return out;
  const moves = [null, ...L.reachable(s, u).map((to) => ({ kind: 'move', id, to }))];
  for (const m of moves) {
    const t = m ? L.apply(s, m) : s;
    const acts = L.legalActions(t, L.byId(t, id)).filter((a) => a.kind !== 'move');
    for (const a of [null, ...acts]) { const c = [m, a].filter(Boolean); if (c.length) out.push(c); }
  }
  return out;
}
const run = (s, list) => { for (const a of list) s = L.apply(s, a) || s; return s; };

function chooseTurn(s) {
  const ids = L.unitsOf(s).map((u) => u.id);
  const plan = Object.fromEntries(ids.map((id) => [id, []]));
  let chosen = s;
  for (let pass = 0; pass < 2; pass++) {
    for (const id of ids) {
      // ほかの駒の手を決めた前提で、この駒の手を選び直す（この駒は最後に動かす）
      const base = run(s, ids.filter((o) => o !== id).flatMap((o) => plan[o]));
      let best = [], bestV = -Infinity;
      for (const c of combos(base, id)) {
        const t = run(base, c);
        const v = value(L.endTurn(t));
        if (v > bestV) { bestV = v; best = c; chosen = t; }
      }
      plan[id] = best;
    }
  }
  return chosen;   // 最後に選び直したときに実際に測った盤
}

const PREF = ['node-hp', 'wall-hp', 'circle-hp', 'square-hp', 'diamond-hp'];
function playNight(seed, loseAt) {
  let r = L.newRun(seed);
  r.battle.loseAt = loseAt;
  let turns = 0;
  while (r.status !== 'done') {
    if (turns++ > 400) return null;   // 打ち切り
    if (r.status === 'choosing') {
      r = L.choose(r, PREF.find((p) => r.offer.includes(p)) || r.offer[0]);
      r.battle.loseAt = loseAt;
      continue;
    }
    r = L.afterTurn(r, L.endTurn(chooseTurn(r.battle)));
  }
  return r;
}

for (const [label, loseAt] of [['灯 1 つで負け', 1], ['灯 2 つで負け', 2], ['全部で負け', 99]]) {
  let dawn = 0, stars = 0, three = 0, stuck = 0, relaxed = 0;
  const starBy = [0, 0, 0], played = [0, 0, 0], lostAt = [0, 0, 0];
  const t0 = Date.now();
  for (let i = 1; i <= nights; i++) {
    const r = playNight(L.fnv1a(`balance/${i}`), loseAt);
    if (!r) { stuck++; continue; }
    if (r.won) dawn++;
    const n = r.stars.filter(Boolean).length;
    stars += n;
    if (r.won && n === 3) three++;
    r.stars.forEach((st, k) => { if (st) starBy[k]++; });
    for (let k = 0; k < r.stage; k++) played[k]++;
    if (!r.won) lostAt[r.stage - 1]++;
    if (r.battle.quality === 'relaxed') relaxed++;
  }
  const pct = (a, b = nights) => `${Math.round((a / b) * 100)}%`;
  console.log(`${label}: 夜明け ${pct(dawn)} / 星 平均 ${(stars / nights).toFixed(2)} / 星 3 つの夜明け ${pct(three)}` +
    ` / 刻ごとの星 宵 ${pct(starBy[0], played[0])} 丑 ${pct(starBy[1], played[1] || 1)} 暁 ${pct(starBy[2], played[2] || 1)}` +
    ` / 途絶えた刻 宵 ${lostAt[0]} 丑 ${lostAt[1]} 暁 ${lostAt[2]} / 打ち切り ${stuck} / ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
}
