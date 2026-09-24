// DAWNWARD の決まりごと。画面（DOM）に触らない部分をここに集める。
// main.js（ブラウザ）、test.mjs と tools/balance.mjs（node）から読む。
//
// 盤の座標は左上 (0,0)、x が右、y が下。向きは 0 上・1 右・2 下・3 左（+1 で時計回り）。
// マスの鍵は y * 16 + x。値はすべて整数。盤の状態はそのまま JSON にして保存できる形にしておく。
// 状態を変える関数は、渡された状態を書き換えずに新しい状態を返す。

export const W = 6, H = 6;
export const DIRS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

export const UNIT_SPEC = {
  circle: { name: '鞠', move: 3, hp: 3 },
  square: { name: '楯', move: 2, hp: 4 },
  diamond: { name: '梶', move: 4, hp: 2 },
};
export const FOE_SPEC = {
  rammer: { name: '咬', move: 1, hp: 2, intent: 'strike' },
  piercer: { name: '裂', move: 1, hp: 2, intent: 'pierce' },
  burster: { name: '弾', move: 1, hp: 1, intent: 'burst' },
};

// 1 夜 = 三つの刻。灯を 1 つも消さずに守れた刻には星が付く。
export const STAGES = [
  { name: '宵', foes: 2, nodes: 2, turns: 4, spawns: 0, pool: ['rammer', 'burster'] },
  { name: '丑', foes: 3, nodes: 2, turns: 6, spawns: 1, pool: ['rammer', 'burster', 'piercer'] },
  { name: '暁', foes: 4, nodes: 3, turns: 7, spawns: 2, pool: ['rammer', 'burster', 'piercer'] },
];
// 刻の負け: この数の灯が消えたら（盤の灯より多ければ、全部消えたら）。99 = 全部。
// tools/balance.mjs で 1 / 2 / 全部 を測って決め、丑・暁の耐えるターンを 1 ずつ足した（README の「バランス」）。
export const LOSE_AT = 99;

// 強化。「灯の足し」（夜全体の体力の上限 +1）は町の灯を刻ごとの星にしたので外した。「反転」はあとに回す。
export const UPGRADES = [
  { id: 'circle-move', name: '鞠・伸び', desc: '鞠の移動 +1', max: 2 },
  { id: 'circle-hp', name: '鞠・堅め', desc: '鞠の体力 +1', max: 3 },
  { id: 'square-move', name: '楯・伸び', desc: '楯の移動 +1', max: 2 },
  { id: 'square-hp', name: '楯・堅め', desc: '楯の体力 +1', max: 3 },
  { id: 'diamond-move', name: '梶・伸び', desc: '梶の移動 +1', max: 2 },
  { id: 'diamond-hp', name: '梶・堅め', desc: '梶の体力 +1', max: 3 },
  { id: 'push-power', name: '衝撃', desc: '押してぶつけた傷 +1', max: 2 },
  { id: 'wall-hp', name: '厚壁', desc: '壁が 2 度の攻撃に耐える', max: 1 },
  { id: 'node-hp', name: '灯の芯', desc: '灯が一度の攻撃では消えない', max: 1 },
];

// ---------- 乱数と種 ----------

// xorshift32。状態は整数 1 つ。次の状態を返す。
export function xorshift(s) {
  s = s >>> 0 || 0x9e3779b9;
  s ^= s << 13; s >>>= 0;
  s ^= s >>> 17;
  s ^= s << 5;
  return s >>> 0;
}
// 0..n-1。剰余の偏りを捨てて取り直す。[値, 次の状態] を返す。
export function nextInt(s, n) {
  const limit = Math.floor(0x100000000 / n) * n;
  for (;;) {
    s = xorshift(s);
    if (s < limit) return [s % n, s];
  }
}
export function shuffle(arr, s) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    let j; [j, s] = nextInt(s, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return [a, s];
}

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h = (h ^ str.charCodeAt(i)) >>> 0; h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
// 端末の日付（その人の暦の今日）
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function prevDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}
export const dailySeed = (key) => fnv1a(`dawnward/daily/${key}`);

// ---------- 盤 ----------

export const key = (v) => v.y * 16 + v.x;
export const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const add = (a, d) => ({ x: a.x + d.x, y: a.y + d.y });
export const eq = (a, b) => a.x === b.x && a.y === b.y;
export const inside = (s, v) => v.x >= 0 && v.y >= 0 && v.x < s.w && v.y < s.h;
const clone = (s) => JSON.parse(JSON.stringify(s));

// 潜っている敵は盤の上に無いものとして扱う
export const pieceAt = (s, v) => s.pieces.find((p) => !p.submerged && eq(p.at, v)) || null;
export const byId = (s, id) => s.pieces.find((p) => p.id === id) || null;
export const nodesOf = (s) => s.pieces.filter((p) => p.kind === 'node');
export const unitsOf = (s) => s.pieces.filter((p) => p.kind === 'unit');
export const foesOf = (s) => s.pieces.filter((p) => p.kind === 'foe');

export function loadoutOf(taken = []) {
  const n = (id) => taken.filter((t) => t === id).length;
  return {
    move: { circle: n('circle-move'), square: n('square-move'), diamond: n('diamond-move') },
    hp: { circle: n('circle-hp'), square: n('square-hp'), diamond: n('diamond-hp') },
    push: n('push-power'), wall: n('wall-hp'), node: n('node-hp'),
  };
}
const unitMove = (s, u) => UNIT_SPEC[u.type].move + (s.loadout.move[u.type] || 0);

function makeFoe(id, type, at) {
  const hp = FOE_SPEC[type].hp;
  return { id, kind: 'foe', type, at, hp, maxHp: hp, power: 1, intent: { kind: 'idle' }, submerged: false };
}

// ---------- 攻撃されるマス ----------

export function threatCells(s, foe) {
  const it = foe.intent;
  if (it.kind === 'surface') return [it.at];
  if (foe.submerged) return [];
  if (it.kind === 'strike') {
    const v = add(foe.at, DIRS[it.dir]);
    return inside(s, v) ? [v] : [];
  }
  if (it.kind === 'pierce') {
    const out = [];
    for (let v = add(foe.at, DIRS[it.dir]); inside(s, v); v = add(v, DIRS[it.dir])) {
      out.push(v);
      const p = pieceAt(s, v);
      if (p && p.kind === 'wall') break;   // 壁で止まる（壁にも当たる）
    }
    return out;
  }
  if (it.kind === 'burst') return DIRS.map((d) => add(foe.at, d)).filter((v) => inside(s, v));
  return [];
}

// ---------- 傷 ----------

// s を書き換える（内部用）。取り除いたら出来事を積む。
function hurt(s, id, amount) {
  const p = byId(s, id);
  if (!p || amount <= 0) return;
  p.hp -= amount;
  s.events.push({ kind: 'hit', id, type: p.type, pk: p.kind, at: p.at, amount });
  if (p.hp > 0) return;
  s.pieces = s.pieces.filter((q) => q.id !== id);
  s.events.push({ kind: 'down', id, type: p.type, pk: p.kind, at: p.at });
  if (p.kind === 'node') s.nodesLost++;
  if (p.kind === 'foe') s.foesDropped++;
}

// ---------- こちらの手 ----------

// 動ける先（空きマス）。何かのあるマスは通れない。梶だけは駒の上を通り抜けられる（止まれない）。
export function reachable(s, u) {
  const range = unitMove(s, u);
  const seen = new Set([key(u.at)]);
  let frontier = [u.at];
  const out = [];
  for (let step = 0; step < range; step++) {
    const next = [];
    for (const cur of frontier) {
      for (const d of DIRS) {
        const v = add(cur, d);
        if (!inside(s, v) || seen.has(key(v))) continue;
        const p = pieceAt(s, v);
        if (p && !(u.type === 'diamond' && p.kind === 'unit')) continue;
        seen.add(key(v));
        next.push(v);
        if (!p) out.push(v);
      }
    }
    frontier = next;
  }
  return out;
}

// 押せる向き（鞠）: 隣の敵・駒・壁。灯は押せない。
export const pushDirs = (s, u) => [0, 1, 2, 3].filter((d) => {
  const p = pieceAt(s, add(u.at, DIRS[d]));
  return p && p.kind !== 'node';
});
// 壁を建てられる向き（楯）: 隣の盤の中の空きマス
export const wallDirs = (s, u) => [0, 1, 2, 3].filter((d) => {
  const v = add(u.at, DIRS[d]);
  return inside(s, v) && !pieceAt(s, v);
});
// 回せる向き（梶）: 隣の敵で、向きのある予告のもの
export const twistDirs = (s, u) => [0, 1, 2, 3].filter((d) => {
  const p = pieceAt(s, add(u.at, DIRS[d]));
  return p && p.kind === 'foe' && (p.intent.kind === 'strike' || p.intent.kind === 'pierce');
});

// その駒が今できる手を全部並べる。{ kind: 'move', id, to } / { kind: 'push'|'wall', id, dir } / { kind: 'twist', id, dir, turn: 1|-1 }
export function legalActions(s, u) {
  const out = [];
  if (!u.moved) for (const to of reachable(s, u)) out.push({ kind: 'move', id: u.id, to });
  if (!u.acted) {
    if (u.type === 'circle') for (const dir of pushDirs(s, u)) out.push({ kind: 'push', id: u.id, dir });
    if (u.type === 'square') for (const dir of wallDirs(s, u)) out.push({ kind: 'wall', id: u.id, dir });
    if (u.type === 'diamond') for (const dir of twistDirs(s, u)) { out.push({ kind: 'twist', id: u.id, dir, turn: 1 }); out.push({ kind: 'twist', id: u.id, dir, turn: -1 }); }
  }
  return out;
}

// 手を 1 つ行う。できない手なら null。
export function apply(state, a) {
  const s = clone(state);
  s.events = [];
  const u = byId(s, a.id);
  if (!u || u.kind !== 'unit' || s.outcome !== 'none') return null;
  if (a.kind === 'move') {
    if (u.moved || !reachable(s, u).some((v) => eq(v, a.to))) return null;
    s.events.push({ kind: 'move', id: u.id, from: u.at, to: a.to });
    u.at = { ...a.to };
    u.moved = true;
    return s;
  }
  if (u.acted) return null;
  const at = add(u.at, DIRS[a.dir]);
  if (a.kind === 'push' && u.type === 'circle' && pushDirs(s, u).includes(a.dir)) {
    const t = pieceAt(s, at);
    const to = add(at, DIRS[a.dir]);
    const power = 1 + s.loadout.push;
    if (!inside(s, to)) {
      if (t.kind === 'foe') {
        s.pieces = s.pieces.filter((q) => q.id !== t.id);
        s.foesDropped++;
        s.events.push({ kind: 'fall', id: t.id, type: t.type, at: t.at });
      } else {
        s.events.push({ kind: 'bump', id: t.id, at: t.at });
        hurt(s, t.id, power);
      }
    } else {
      const o = pieceAt(s, to);
      if (o) {
        s.events.push({ kind: 'bump', id: t.id, at: t.at, other: o.id });
        hurt(s, t.id, power);
        hurt(s, o.id, power);
      } else {
        s.events.push({ kind: 'shove', id: t.id, from: t.at, to });
        t.at = to;   // 敵の予告は向きごと一緒に動く
      }
    }
  } else if (a.kind === 'wall' && u.type === 'square' && wallDirs(s, u).includes(a.dir)) {
    const hp = 1 + s.loadout.wall;
    s.pieces.push({ id: s.nextId++, kind: 'wall', type: 'wall', at, hp, maxHp: hp, power: 0 });
    s.events.push({ kind: 'wall', at });
  } else if (a.kind === 'twist' && u.type === 'diamond' && twistDirs(s, u).includes(a.dir) && (a.turn === 1 || a.turn === -1)) {
    const f = pieceAt(s, at);
    f.intent = { ...f.intent, dir: (f.intent.dir + a.turn + 4) % 4 };
    s.events.push({ kind: 'twist', id: f.id, turn: a.turn });
  } else return null;
  u.acted = true;
  return s;
}

// ---------- 敵 ----------

// 一番近い灯（同じなら鍵が小さい方）。灯が無ければ一番近い駒。
function preyOf(s, from) {
  const nodes = nodesOf(s);
  const pool = nodes.length ? nodes : unitsOf(s);
  let best = null, bestScore = Infinity;
  for (const p of pool) {
    const sc = dist(from, p.at) * 1024 + key(p.at);
    if (sc < bestScore) { bestScore = sc; best = p; }
  }
  return best;
}

function moveFoe(s, foe) {
  const prey = preyOf(s, foe.at);
  if (!prey) return;
  const goals = [];
  if (foe.type === 'piercer') {
    for (let x = 0; x < s.w; x++) goals.push({ x, y: prey.at.y });
    for (let y = 0; y < s.h; y++) goals.push({ x: prey.at.x, y });
  } else {
    for (const d of DIRS) { const v = add(prey.at, d); if (inside(s, v)) goals.push(v); }
  }
  if (!goals.length) return;
  const score = (v) => Math.min(...goals.map((g) => dist(v, g))) * 1024 + key(v);
  // 動ける範囲（何かのあるマスは通れない）
  const seen = new Set([key(foe.at)]);
  let frontier = [foe.at];
  let best = foe.at, bestScore = score(foe.at);
  for (let step = 0; step < FOE_SPEC[foe.type].move; step++) {
    const next = [];
    for (const cur of frontier) {
      for (const d of DIRS) {
        const v = add(cur, d);
        if (!inside(s, v) || seen.has(key(v)) || pieceAt(s, v)) continue;
        seen.add(key(v));
        next.push(v);
        const sc = score(v);
        if (sc < bestScore) { bestScore = sc; best = v; }
      }
    }
    frontier = next;
  }
  if (eq(best, foe.at)) return;
  s.events.push({ kind: 'move', id: foe.id, from: foe.at, to: best });
  foe.at = best;
}

function telegraph(s, foe) {
  const kind = FOE_SPEC[foe.type].intent;
  if (kind === 'burst') { foe.intent = { kind }; return; }
  const prey = preyOf(s, foe.at);
  if (!prey) { foe.intent = { kind: 'idle' }; return; }
  const dx = prey.at.x - foe.at.x, dy = prey.at.y - foe.at.y;
  const dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 1 : 3) : (dy >= 0 ? 2 : 0);
  foe.intent = { kind, dir };
}

// 次のターンに現れる敵を、潜った状態で置く（印）
function placeSpawns(s, turn) {
  for (const sp of s.spawns.filter((x) => x.turn === turn)) {
    const f = makeFoe(s.nextId++, sp.type, { ...sp.at });
    f.submerged = true;
    f.intent = { kind: 'surface', at: { ...sp.at } };
    s.pieces.push(f);
    s.events.push({ kind: 'mark', id: f.id, type: f.type, at: f.at });
  }
  s.spawns = s.spawns.filter((x) => x.turn !== turn);
}

// 勝ち負け。負けを先に見る（同じ段で両方そろったら負け）。
export function evaluate(s) {
  if (s.outcome !== 'none') return;
  if (s.nodesLost >= Math.min(s.loseAt, s.nodesStart) || unitsOf(s).length === 0) s.outcome = 'lost';
  else if ((foesOf(s).length === 0 && s.spawns.length === 0) || s.turn > s.turnsToSurvive) s.outcome = 'won';
}

// 確定したあとの敵の番を段ごとに解決する。[{ state, events, phase, actor }] の最後が結果。
// phase: 'attack'（1 体ずつ）/ 'move'（まとめて）/ 'mark'（まとめて）/ 'end'
export function endTurnTrace(state) {
  const s = clone(state);
  s.events = [];
  const steps = [];
  const push = (phase, actor = null) => {
    if (s.events.length || phase === 'end') steps.push({ state: clone(s), events: s.events, phase, actor });
    s.events = [];
  };
  const finish = () => {
    s.turn++;
    for (const p of s.pieces) if (p.kind === 'unit') { p.moved = false; p.acted = false; }
    evaluate(s);
    push('end');
    return steps;
  };
  evaluate(s);   // こちらの番で決着が付いていることもある（最後の敵を落とした、など）
  if (s.outcome !== 'none') { push('end'); return steps; }

  // 1. 予告された攻撃を、敵の番号の順に（先に倒れた敵は撃たない）
  const surfaced = new Set();
  for (const id of foesOf(s).map((f) => f.id).sort((a, b) => a - b)) {
    const foe = byId(s, id);
    if (!foe) continue;
    const it = foe.intent;
    if (it.kind === 'surface') {
      const occ = pieceAt(s, it.at);
      if (occ) {
        s.events.push({ kind: 'blocked', id, type: foe.type, at: it.at });
        hurt(s, occ.id, foe.power);   // 潜ったまま、次の番にまた同じマスを狙う
      } else {
        foe.submerged = false;
        foe.at = { ...it.at };
        foe.intent = { kind: 'idle' };
        surfaced.add(id);
        s.events.push({ kind: 'surface', id, type: foe.type, at: foe.at });
      }
    } else if (it.kind !== 'idle') {
      const cells = threatCells(s, foe);
      s.events.push({ kind: 'attack', id, type: foe.type, at: foe.at, cells });
      for (const v of cells) { const t = pieceAt(s, v); if (t) hurt(s, t.id, foe.power); }
    }
    push('attack', id);
    evaluate(s);
    if (s.outcome !== 'none') return finish();
  }
  // 2. 生き残った敵が動く（浮上したばかりの敵は動かない）
  for (const f of foesOf(s).filter((f) => !f.submerged && !surfaced.has(f.id)).sort((a, b) => a.id - b.id)) moveFoe(s, f);
  push('move');
  // 3. 新しい予告
  for (const f of foesOf(s).filter((f) => !f.submerged)) telegraph(s, f);
  // 4. 次のターンの印
  placeSpawns(s, s.turn + 1);
  push('mark');
  // 5. 壁が崩れる
  s.pieces = s.pieces.filter((p) => p.kind !== 'wall');
  // 6. ターンを進め、勝ち負けを見る
  return finish();
}
export const endTurn = (s) => endTurnTrace(s).at(-1).state;

// ---------- 盤の用意 ----------

// plan: { turns, nodes: [v], units: [{ type, at }], foes: [{ type, at }], spawns: [{ turn, type, at }], loseAt }
export function setupBattle(plan, taken = []) {
  const loadout = loadoutOf(taken);
  const s = {
    w: W, h: H, turn: 1, turnsToSurvive: plan.turns, nextId: 1, loadout,
    nodesStart: plan.nodes.length, nodesLost: 0, loseAt: plan.loseAt ?? LOSE_AT, foesDropped: 0,
    outcome: 'none', quality: plan.quality || 'ok',
    spawns: plan.spawns.map((x) => ({ turn: x.turn, type: x.type, at: { ...x.at } })),
    pieces: [], events: [],
  };
  const nodeHp = 1 + loadout.node;
  for (const at of plan.nodes) s.pieces.push({ id: s.nextId++, kind: 'node', type: 'node', at: { ...at }, hp: nodeHp, maxHp: nodeHp, power: 0 });
  for (const u of plan.units) {
    const hp = UNIT_SPEC[u.type].hp + loadout.hp[u.type];
    s.pieces.push({ id: s.nextId++, kind: 'unit', type: u.type, at: { ...u.at }, hp, maxHp: hp, power: u.type === 'circle' ? 1 : 0, moved: false, acted: false });
  }
  for (const f of plan.foes) s.pieces.push(makeFoe(s.nextId++, f.type, { ...f.at }));
  for (const f of foesOf(s)) telegraph(s, f);
  placeSpawns(s, 1);
  s.events = [];
  return s;
}

// 刻 stage（0 始まり）の盤を乱数から作る。[plan, 次の乱数の状態] を返す。同じ種なら同じ盤。
export function generatePlan(stage, rng) {
  const cfg = STAGES[stage];
  let quality = 'ok';
  const all = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) all.push({ x, y });
  const used = new Set();
  const free = (v) => !used.has(key(v));
  const take = (v) => { used.add(key(v)); return v; };
  const pick = (cands, n, ok, relaxed) => {
    let list; [list, rng] = shuffle(cands, rng);
    const out = [];
    for (const v of list) if (out.length < n && free(v) && ok(v, out)) out.push(take(v));
    if (out.length < n && relaxed) {
      quality = 'relaxed';
      for (const v of list) if (out.length < n && free(v) && relaxed(v, out)) out.push(take(v));
    }
    return out;
  };
  const edge = (v) => v.x === 0 || v.y === 0 || v.x === W - 1 || v.y === H - 1;

  const nodes = pick(all.filter((v) => !edge(v)), cfg.nodes, (v, out) => out.every((o) => dist(o, v) >= 2), () => true);
  const nearNode = (d) => (v) => nodes.some((n) => dist(n, v) <= d);
  const farFromNodes = (d) => (v) => nodes.every((n) => dist(n, v) >= d);
  const unitCells = pick(all, 3, nearNode(2), () => true);
  const foeCells = pick(all.filter(edge), cfg.foes, farFromNodes(3), farFromNodes(2));
  if (foeCells.length < cfg.foes) foeCells.push(...pick(all, cfg.foes - foeCells.length, () => true));
  const spawnCells = pick(all, cfg.spawns, farFromNodes(2), () => true);

  const typeOf = () => { let i; [i, rng] = nextInt(rng, cfg.pool.length); return cfg.pool[i]; };
  const plan = {
    turns: cfg.turns, quality, nodes,
    units: ['circle', 'square', 'diamond'].map((type, i) => ({ type, at: unitCells[i] })),
    foes: foeCells.map((at) => ({ type: typeOf(), at })),
    spawns: spawnCells.map((at, i) => ({ turn: 2 + i, type: typeOf(), at })),
  };
  return [plan, rng];
}

// ---------- 1 夜 ----------

export function newRun(seed, dailyKey = null) {
  const run = { v: 1, seed: seed >>> 0, dailyKey, stage: 1, stars: [], taken: [], status: 'battle', offer: null,
    rng: seed >>> 0 || 0x9e3779b9, stats: { turns: 0, foesDropped: 0, nodesLost: 0 }, battle: null };
  return startStage(run);
}
function startStage(run) {
  const [plan, rng] = generatePlan(run.stage - 1, run.rng);
  return { ...run, rng, status: 'battle', offer: null, battle: setupBattle(plan, run.taken) };
}

// 確定したターンの結果を夜に反映する。刻に勝てば強化の 3 択へ（暁なら夜明け）、負ければ夜の終わり。
export function afterTurn(run, battle) {
  const r = clone(run);
  const prev = run.battle;
  r.battle = battle;
  r.stats.turns++;
  r.stats.foesDropped += battle.foesDropped - prev.foesDropped;
  r.stats.nodesLost += battle.nodesLost - prev.nodesLost;
  if (battle.outcome === 'lost') { r.status = 'done'; r.won = false; return r; }
  if (battle.outcome !== 'won') return r;
  r.stars.push(battle.nodesLost === 0);
  if (r.stage === STAGES.length) { r.status = 'done'; r.won = true; return r; }
  const avail = UPGRADES.filter((u) => r.taken.filter((t) => t === u.id).length < u.max).map((u) => u.id);
  let list; [list, r.rng] = shuffle(avail, r.rng);
  r.offer = list.slice(0, 3);
  r.status = 'choosing';
  if (!r.offer.length) return startStage({ ...r, stage: r.stage + 1 });   // 3 択を作れなければそのまま次へ
  return r;
}

export function choose(run, id) {
  if (run.status !== 'choosing' || !run.offer.includes(id)) return run;
  return startStage({ ...clone(run), taken: [...run.taken, id], stage: run.stage + 1 });
}

// 点数: 夜明け 10000 + 勝った刻 × 500 + 星 × 300 + 落とした敵 × 25 − 消えた灯 × 50
export function scoreOf(run) {
  const won = run.stars.length;
  const stars = run.stars.filter(Boolean).length;
  return Math.max(0, (run.won ? 10000 : 0) + won * 500 + stars * 300 + run.stats.foesDropped * 25 - run.stats.nodesLost * 50);
}

// ---------- 保存 ----------

const isInt = (n) => Number.isInteger(n);
const isVec = (v) => v && isInt(v.x) && isInt(v.y) && v.x >= 0 && v.y >= 0 && v.x < W && v.y < H;
function validBattle(b, status) {
  if (!b || b.w !== W || b.h !== H || !isInt(b.turn) || !isInt(b.turnsToSurvive) || !isInt(b.nextId)) return false;
  if (!isInt(b.nodesStart) || !isInt(b.nodesLost) || !isInt(b.loseAt) || !isInt(b.foesDropped) || b.outcome !== (status === 'choosing' ? 'won' : 'none')) return false;
  if (!b.loadout || !b.loadout.move || !b.loadout.hp || !Array.isArray(b.spawns) || !Array.isArray(b.pieces)) return false;
  if (!b.spawns.every((x) => isInt(x.turn) && FOE_SPEC[x.type] && isVec(x.at))) return false;
  return b.pieces.every((p) => p && isInt(p.id) && isVec(p.at) && isInt(p.hp) && p.hp > 0 && (
    (p.kind === 'node') || (p.kind === 'wall') ||
    (p.kind === 'unit' && UNIT_SPEC[p.type]) ||
    (p.kind === 'foe' && FOE_SPEC[p.type] && p.intent && typeof p.intent.kind === 'string')));
}
// 途中の夜として読めるか。読めなければ null。
export function readRun(raw) {
  try {
    const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!r || r.v !== 1 || !isInt(r.seed) || !isInt(r.rng) || !isInt(r.stage) || r.stage < 1 || r.stage > STAGES.length) return null;
    if (!Array.isArray(r.stars) || !Array.isArray(r.taken) || !r.taken.every((t) => UPGRADES.some((u) => u.id === t))) return null;
    if (!r.stats || !isInt(r.stats.turns) || !isInt(r.stats.foesDropped) || !isInt(r.stats.nodesLost)) return null;
    if (r.status === 'choosing' && !(Array.isArray(r.offer) && r.offer.length && r.offer.every((t) => UPGRADES.some((u) => u.id === t)))) return null;
    if (r.status !== 'battle' && r.status !== 'choosing') return null;
    if (!validBattle(r.battle, r.status)) return null;
    return r;
  } catch { return null; }
}

export function emptyRecords() { return { v: 1, daily: {}, best: 0, streak: { last: null, count: 0, best: 0 } }; }
export function readRecords(raw) {
  try {
    const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!r || r.v !== 1 || typeof r.daily !== 'object' || !r.streak) return emptyRecords();
    return { v: 1, daily: r.daily || {}, best: isInt(r.best) ? r.best : 0,
      streak: { last: r.streak.last || null, count: r.streak.count | 0, best: r.streak.best | 0 } };
  } catch { return emptyRecords(); }
}
// 終えた夜を記録に入れる。今夜の記録はその日に最初に終えた 1 回だけ。
export function recordRun(records, run) {
  const r = clone(records);
  const score = scoreOf(run);
  r.best = Math.max(r.best, score);
  const k = run.dailyKey;
  if (k && !r.daily[k]) {
    r.daily[k] = { won: !!run.won, stage: run.stage, stars: run.stars.filter(Boolean).length, score };
    const st = r.streak;
    if (st.last !== k) {
      st.count = st.last === prevDay(k) ? st.count + 1 : 1;
      st.last = k;
      st.best = Math.max(st.best, st.count);
    }
    const keys = Object.keys(r.daily).sort().reverse();
    for (const old of keys.slice(400)) delete r.daily[old];
  }
  return r;
}
// 今日から見た連続日数（昨日か今日まで続いていれば）
export function streakNow(records, today) {
  const st = records.streak;
  return st.last === today || st.last === prevDay(today) ? st.count : 0;
}

// ---------- 手引き ----------

const lesson = (id, title, teach, goal, hint, plan, success) =>
  ({ id, title, teach, goal, hint, plan: { turns: 4, spawns: [], foes: [], loseAt: 1, ...plan }, success });
const nodeAlive = (s) => nodesOf(s).length > 0;
export const LESSONS = [
  lesson('push', '押してどける', '赤い破線のマスは、このターンの終わりに必ず攻撃されます。灯がそこにあると消えます。',
    '鞠で咬を押して、灯を守る', '鞠を選び、咬の上に出る矢印を押すと 1 マス押せます。',
    { nodes: [{ x: 1, y: 2 }], units: [{ type: 'circle', at: { x: 2, y: 3 } }], foes: [{ type: 'rammer', at: { x: 2, y: 2 } }] }, nodeAlive),
  lesson('fall', '盤の外へ落とす', '盤の外へ押し出された敵は、落ちて消えます。敵を減らすいちばん確かな手です。',
    '咬を盤の外へ押し出す', '鞠を咬の内側に置いたまま、外へ向かって押します。',
    { nodes: [{ x: 1, y: 2 }], units: [{ type: 'circle', at: { x: 4, y: 2 } }], foes: [{ type: 'rammer', at: { x: 5, y: 2 } }] }, (s) => foesOf(s).length === 0),
  lesson('wall', '壁で遮る', '裂は向いた方向を盤の端まで裂きます。駒は素通りしますが、壁で止まります。',
    '楯で壁を建てて、灯を守る', '楯を選び、「壁」に切り替えてから、裂かれる線の上の隣のマスを押します。',
    { nodes: [{ x: 1, y: 2 }], units: [{ type: 'square', at: { x: 3, y: 2 } }], foes: [{ type: 'piercer', at: { x: 5, y: 2 } }] }, nodeAlive),
  lesson('twist', '向きを回す', '梶は、隣の敵の向きを 90 度回せます。どけられなくても、狙いをそらせます。',
    '梶で咬の向きを回して、灯を守る', '梶を選び、咬を押すと「右へ回す」「左へ回す」が出ます。',
    { nodes: [{ x: 1, y: 2 }], units: [{ type: 'diamond', at: { x: 2, y: 3 } }], foes: [{ type: 'rammer', at: { x: 2, y: 2 } }] }, nodeAlive),
  lesson('surface', '浮上を潰す', '破線の丸は、次の敵の番に敵が下から現れる印です。駒か壁で塞げば出てこられません。',
    '印のマスを塞いで、敵を出させない', '楯を印のマスへ動かすか、印のマスに壁を建てます。',
    { nodes: [{ x: 1, y: 3 }], units: [{ type: 'square', at: { x: 3, y: 3 } }], spawns: [{ turn: 1, type: 'rammer', at: { x: 3, y: 2 } }], loseAt: 1 },
    (s) => foesOf(s).length > 0 && foesOf(s).every((f) => f.submerged)),
];
