// node test.mjs — 決まりの自己チェック（押す・落ちる・ぶつかる・壁・回す・浮上・敵の番の順番・勝ち負け・種・保存・手引き）
import assert from 'node:assert/strict';
import * as L from './logic.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };

// 小さな盤を作る。敵の予告は setupBattle が狙いから決めるので、決めたいときは intent で上書きする。
function board({ nodes = [], units = [], foes = [], spawns = [], turns = 4, loseAt, taken } = {}) {
  const s = L.setupBattle({ turns, nodes, units, foes: foes.map(({ type, at }) => ({ type, at })), spawns, loseAt }, taken);
  L.foesOf(s).forEach((f, i) => { if (foes[i] && foes[i].intent) f.intent = foes[i].intent; });
  return s;
}
const at = (x, y) => ({ x, y });
const unit = (s, type) => L.unitsOf(s).find((u) => u.type === type);
const does = (s, a) => { const t = L.apply(s, a); assert.ok(t, `できない手: ${JSON.stringify(a)}`); return t; };

test('押す: 空きマスへ動く。予告の向きも一緒に動く', () => {
  const s = board({ units: [{ type: 'circle', at: at(2, 3) }], foes: [{ type: 'rammer', at: at(2, 2), intent: { kind: 'strike', dir: 3 } }], nodes: [at(0, 0)] });
  const t = does(s, { kind: 'push', id: unit(s, 'circle').id, dir: 0 });
  const f = L.foesOf(t)[0];
  assert.deepEqual(f.at, at(2, 1));
  assert.deepEqual(f.intent, { kind: 'strike', dir: 3 });
  assert.equal(f.hp, 2);
});

test('落ちる: 盤の外へ押し出した敵は消え、数に入る', () => {
  const s = board({ units: [{ type: 'circle', at: at(4, 2) }], foes: [{ type: 'rammer', at: at(5, 2) }], nodes: [at(1, 2)] });
  const t = does(s, { kind: 'push', id: unit(s, 'circle').id, dir: 1 });
  assert.equal(L.foesOf(t).length, 0);
  assert.equal(t.foesDropped, 1);
});

test('ぶつかる: 押した先が塞がっていれば両方に傷。駒・壁は縁で傷', () => {
  const s = board({ units: [{ type: 'circle', at: at(1, 2) }, { type: 'square', at: at(3, 2) }], foes: [{ type: 'rammer', at: at(2, 2) }], nodes: [at(0, 5)] });
  const t = does(s, { kind: 'push', id: unit(s, 'circle').id, dir: 1 });
  assert.equal(L.foesOf(t)[0].hp, 1);
  assert.equal(unit(t, 'square').hp, 3);
  assert.deepEqual(L.foesOf(t)[0].at, at(2, 2));
  // 駒を縁の外へ押すと落ちずに傷
  const e = board({ units: [{ type: 'circle', at: at(4, 0) }, { type: 'square', at: at(5, 0) }], nodes: [at(0, 5)], foes: [{ type: 'rammer', at: at(0, 3) }] });
  const f = does(e, { kind: 'push', id: unit(e, 'circle').id, dir: 1 });
  assert.equal(unit(f, 'square').hp, 3);
  assert.deepEqual(unit(f, 'square').at, at(5, 0));
  // 衝撃の強化で傷 +1、押して灯にぶつけると灯も消える
  const g = board({ units: [{ type: 'circle', at: at(1, 2) }], foes: [{ type: 'rammer', at: at(2, 2) }], nodes: [at(3, 2), at(0, 5)], taken: ['push-power'] });
  const h = does(g, { kind: 'push', id: unit(g, 'circle').id, dir: 1 });
  assert.equal(L.foesOf(h).length, 0);
  assert.equal(h.nodesLost, 1);
});

test('灯は押せない', () => {
  const s = board({ units: [{ type: 'circle', at: at(1, 2) }], nodes: [at(2, 2)], foes: [{ type: 'rammer', at: at(5, 5) }] });
  assert.equal(L.apply(s, { kind: 'push', id: unit(s, 'circle').id, dir: 1 }), null);
});

test('壁で裂が止まる（壁も当たる）。壁は敵の番の終わりに崩れる', () => {
  const s = board({ units: [{ type: 'square', at: at(3, 2) }], foes: [{ type: 'piercer', at: at(5, 2) }], nodes: [at(1, 2)] });
  assert.deepEqual(L.threatCells(s, L.foesOf(s)[0]).map(L.key), [at(4, 2), at(3, 2), at(2, 2), at(1, 2), at(0, 2)].map(L.key));
  const t = does(s, { kind: 'wall', id: unit(s, 'square').id, dir: 1 });
  assert.deepEqual(L.threatCells(t, L.foesOf(t)[0]).map(L.key), [L.key(at(4, 2))]);
  const e = L.endTurn(t);
  assert.equal(L.nodesOf(e).length, 1);
  assert.equal(unit(e, 'square').hp, 4);
  assert.equal(e.pieces.filter((p) => p.kind === 'wall').length, 0);
  // 壁が無ければ、駒を素通りして灯まで裂く
  const f = L.endTurn(s);
  assert.equal(f.nodesLost, 1);
  assert.equal(unit(f, 'square').hp, 3);
});

test('回す: 向きのある予告だけ ±90 度。弾は回せない', () => {
  const s = board({ units: [{ type: 'diamond', at: at(2, 3) }], foes: [{ type: 'rammer', at: at(2, 2) }, { type: 'burster', at: at(3, 3) }], nodes: [at(1, 2)] });
  const d = unit(s, 'diamond');
  assert.deepEqual(L.twistDirs(s, d), [0]);
  assert.equal(L.foesOf(s)[0].intent.dir, 3);
  const t = does(s, { kind: 'twist', id: d.id, dir: 0, turn: 1 });
  assert.equal(L.foesOf(t)[0].intent.dir, 0);
  assert.equal(L.apply(s, { kind: 'twist', id: d.id, dir: 1, turn: 1 }), null);
});

test('移動: 範囲まで。駒は通れない、梶だけ駒の上を通り抜ける（止まれない）', () => {
  const s = board({ units: [{ type: 'square', at: at(0, 0) }, { type: 'circle', at: at(1, 0) }, { type: 'diamond', at: at(0, 1) }], nodes: [at(5, 5)], foes: [{ type: 'rammer', at: at(3, 5) }] });
  const keys = (u) => L.reachable(s, u).map(L.key).sort((a, b) => a - b);
  assert.deepEqual(keys(unit(s, 'square')), []);
  assert.ok(keys(unit(s, 'diamond')).includes(L.key(at(2, 0))));   // (0,0)(1,0) を通り抜ける
  assert.ok(!keys(unit(s, 'diamond')).includes(L.key(at(1, 0))));
  const u = unit(s, 'circle');
  const t = does(s, { kind: 'move', id: u.id, to: at(4, 0) });
  assert.equal(L.apply(t, { kind: 'move', id: u.id, to: at(5, 0) }), null);   // 移動は 1 回
});

test('浮上: 印を塞ぐと乗ったものが傷を受け、敵は潜ったまま同じマスを狙う', () => {
  const s = board({ units: [{ type: 'square', at: at(3, 3) }], nodes: [at(1, 3)], spawns: [{ turn: 1, type: 'rammer', at: at(3, 2) }] });
  assert.ok(L.foesOf(s)[0].submerged);
  const t = L.endTurn(does(s, { kind: 'move', id: unit(s, 'square').id, to: at(3, 2) }));
  assert.equal(unit(t, 'square').hp, 3);
  assert.ok(L.foesOf(t)[0].submerged);
  assert.deepEqual(L.foesOf(t)[0].intent, { kind: 'surface', at: at(3, 2) });
  // 塞がなければ現れ、その番には動かず、新しい予告を出す
  const e = L.endTurn(s);
  const f = L.foesOf(e)[0];
  assert.ok(!f.submerged);
  assert.deepEqual(f.at, at(3, 2));
  assert.equal(f.intent.kind, 'strike');
});

test('敵の番の順番: 番号の順に撃ち、先に倒れた敵は撃たない。攻撃は敵にも当たる', () => {
  // 弾(1) が隣の咬(2) を倒すので、咬の灯への攻撃は起きない
  const s = board({ nodes: [at(1, 2), at(5, 5)], units: [{ type: 'circle', at: at(5, 0) }],
    foes: [{ type: 'burster', at: at(3, 2) }, { type: 'rammer', at: at(2, 2), intent: { kind: 'strike', dir: 3 } }] });
  L.foesOf(s)[1].hp = 1;
  const steps = L.endTurnTrace(s);
  const e = steps.at(-1).state;
  assert.equal(L.nodesOf(e).length, 2);
  assert.equal(L.foesOf(e).length, 1);
  assert.equal(steps[0].phase, 'attack');
  assert.equal(steps.at(-1).phase, 'end');
  assert.equal(e.turn, 2);
  // 順番を入れ替える（咬が先）と灯が消える
  const t = board({ nodes: [at(1, 2), at(5, 5)], units: [{ type: 'circle', at: at(5, 0) }],
    foes: [{ type: 'rammer', at: at(2, 2), intent: { kind: 'strike', dir: 3 } }, { type: 'burster', at: at(3, 2) }] });
  assert.equal(L.endTurn(t).nodesLost, 1);
});

test('勝ち負け: 耐えれば勝ち、敵がいなくなれば勝ち、灯が全部か駒が全部消えたら負け。両方なら負け', () => {
  const s = board({ nodes: [at(0, 0), at(5, 5)], units: [{ type: 'circle', at: at(3, 3) }], foes: [{ type: 'rammer', at: at(0, 5) }], turns: 1 });
  assert.equal(L.endTurn(s).outcome, 'won');
  const noFoe = board({ nodes: [at(0, 0)], units: [{ type: 'circle', at: at(4, 2) }], foes: [{ type: 'rammer', at: at(5, 2) }] });
  assert.equal(L.endTurn(does(noFoe, { kind: 'push', id: unit(noFoe, 'circle').id, dir: 1 })).outcome, 'won');
  // 最後のターンに最後の灯が消えたら負け
  const both = board({ nodes: [at(1, 2)], units: [{ type: 'circle', at: at(5, 5) }], foes: [{ type: 'rammer', at: at(2, 2) }], turns: 1 });
  assert.equal(L.endTurn(both).outcome, 'lost');
  // 灯が 1 つ残れば続く（星は無くなる）
  const one = board({ nodes: [at(1, 2), at(5, 0)], units: [{ type: 'circle', at: at(5, 5) }], foes: [{ type: 'rammer', at: at(2, 2) }], turns: 1 });
  const o = L.endTurn(one);
  assert.equal(o.outcome, 'won');
  assert.equal(o.nodesLost, 1);
  // 駒が全部消えたら負け
  const lone = board({ nodes: [at(0, 0)], units: [{ type: 'diamond', at: at(2, 3) }], foes: [{ type: 'burster', at: at(2, 2) }] });
  unit(lone, 'diamond').hp = 1;
  assert.equal(L.endTurn(lone).outcome, 'lost');
});

test('同じ種から同じ盤。盤は条件を満たす', () => {
  for (let seed = 1; seed <= 300; seed++) {
    for (let st = 0; st < 3; st++) {
      const [a] = L.generatePlan(st, seed);
      const [b] = L.generatePlan(st, seed);
      assert.deepEqual(a, b);
      const cfg = L.STAGES[st];
      assert.equal(a.nodes.length, cfg.nodes);
      assert.equal(a.foes.length, cfg.foes);
      assert.equal(a.spawns.length, cfg.spawns);
      const cells = [...a.nodes, ...a.units.map((u) => u.at), ...a.foes.map((f) => f.at), ...a.spawns.map((x) => x.at)].map(L.key);
      assert.equal(new Set(cells).size, cells.length);
      assert.ok(a.foes.every((f) => cfg.pool.includes(f.type)));
    }
  }
  const r1 = L.newRun(L.dailySeed('2026-09-25'), '2026-09-25');
  const r2 = L.newRun(L.dailySeed('2026-09-25'), '2026-09-25');
  assert.deepEqual(r1, r2);
  assert.notDeepEqual(r1.battle.pieces, L.newRun(L.dailySeed('2026-09-26')).battle.pieces);
});

test('乱数: nextInt は範囲内、xorshift は 0 に落ちない', () => {
  let s = 0;
  for (let i = 0; i < 2000; i++) { let v; [v, s] = L.nextInt(s, 7); assert.ok(v >= 0 && v < 7); assert.ok(s !== 0); }
});

test('1 夜: 勝つと強化の 3 択、選ぶと次の刻、暁に勝てば夜明け。星は灯を消さなかった刻だけ', () => {
  let r = L.newRun(123);
  const win = (r, lost = 0) => L.afterTurn(r, { ...r.battle, outcome: 'won', nodesLost: lost });
  r = win(r);
  assert.equal(r.status, 'choosing');
  assert.equal(r.offer.length, 3);
  assert.equal(new Set(r.offer).size, 3);
  r = L.choose(r, r.offer[0]);
  assert.equal(r.stage, 2);
  assert.equal(r.taken.length, 1);
  r = win(r, 1);
  r = L.choose(r, r.offer[1]);
  r = win(r);
  assert.equal(r.status, 'done');
  assert.equal(r.won, true);
  assert.deepEqual(r.stars, [true, false, true]);
  assert.equal(r.stats.nodesLost, 1);
  assert.equal(L.scoreOf(r), 10000 + 3 * 500 + 2 * 300 - 50);
  // 負けた夜は夜明けより必ず下
  const lost = L.afterTurn(L.newRun(5), { ...L.newRun(5).battle, outcome: 'lost' });
  assert.equal(lost.status, 'done');
  assert.equal(lost.won, false);
  assert.ok(L.scoreOf(lost) < 10000);
  // 取り切った強化は出ない
  const full = { ...L.newRun(9), taken: ['wall-hp', 'node-hp'] };
  for (let i = 0; i < 30; i++) {
    const t = win({ ...full, rng: i + 1 });
    assert.ok(!t.offer.includes('wall-hp') && !t.offer.includes('node-hp'));
  }
});

test('強化が盤に効く', () => {
  const s = L.setupBattle({ turns: 4, nodes: [at(1, 1)], units: [{ type: 'circle', at: at(3, 3) }, { type: 'square', at: at(4, 4) }, { type: 'diamond', at: at(2, 4) }], foes: [], spawns: [] },
    ['circle-hp', 'circle-move', 'node-hp', 'wall-hp']);
  assert.equal(unit(s, 'circle').hp, 4);
  assert.equal(L.nodesOf(s)[0].hp, 2);
  assert.ok(L.reachable(s, unit(s, 'circle')).some((v) => L.dist(v, at(3, 3)) === 4));
  const w = does(s, { kind: 'wall', id: unit(s, 'square').id, dir: 0 });
  assert.equal(w.pieces.find((p) => p.kind === 'wall').hp, 2);
});

test('保存: 途中の夜はそのまま読み戻せる。壊れたものは null で落ちない', () => {
  const r = L.newRun(42, '2026-09-25');
  assert.deepEqual(L.readRun(JSON.stringify(r)), r);
  const c = L.afterTurn(r, { ...r.battle, outcome: 'won' });   // 3 択の途中（盤は勝ったまま）
  assert.deepEqual(L.readRun(JSON.stringify(c)), c);
  const bad = ['', '{', 'null', '[]', '{"v":2}', JSON.stringify({ ...r, battle: null }), JSON.stringify({ ...r, stage: 9 }),
    JSON.stringify({ ...r, taken: ['nope'] }), JSON.stringify({ ...r, battle: { ...r.battle, pieces: [{ id: 1 }] } }),
    JSON.stringify({ ...r, status: 'choosing', offer: null })];
  for (const b of bad) assert.equal(L.readRun(b), null, b);
  // 記録は壊れていても空で始める
  assert.deepEqual(L.readRecords('{'), L.emptyRecords());
  assert.deepEqual(L.readRecords(null), L.emptyRecords());
});

test('記録: 今夜の記録は最初の 1 回だけ。連続日数は前日から続けば +1', () => {
  const done = (key, won) => ({ ...L.newRun(1, key), status: 'done', won, stars: won ? [true, true, false] : [true], stage: won ? 3 : 2 });
  let rec = L.emptyRecords();
  rec = L.recordRun(rec, done('2026-09-24', false));
  rec = L.recordRun(rec, done('2026-09-25', true));
  rec = L.recordRun(rec, done('2026-09-25', false));
  assert.equal(rec.daily['2026-09-25'].won, true);
  assert.equal(rec.daily['2026-09-25'].stars, 2);
  assert.equal(rec.streak.count, 2);
  assert.equal(L.streakNow(rec, '2026-09-26'), 2);
  assert.equal(L.streakNow(rec, '2026-09-28'), 0);
  rec = L.recordRun(rec, done('2026-09-28', true));
  assert.equal(rec.streak.count, 1);
  assert.equal(rec.streak.best, 2);
  assert.equal(L.prevDay('2026-03-01'), '2026-02-28');
  // 好きな夜は今夜の記録に入らない
  const free = L.recordRun(rec, { ...done(null, true) });
  assert.deepEqual(free.daily, rec.daily);
  // 400 日だけ残す
  let many = L.emptyRecords();
  for (let i = 0; i < 410; i++) many = L.recordRun(many, done(L.dayKey(new Date(2025, 0, 1 + i)), true));
  assert.equal(Object.keys(many.daily).length, 400);
  assert.ok(!many.daily['2025-01-01']);
});

// 手引き: 1 つの駒の「移動しない / 動く」×「行動しない / する」を、移動が先・行動が先の両方で総当たりする
function allTurns(s) {
  const u = L.unitsOf(s)[0];
  const out = [s];
  const acts = (t) => L.legalActions(t, L.byId(t, u.id));
  for (const a of acts(s)) {
    const t = L.apply(s, a);
    out.push(t);
    for (const b of acts(t).filter((b) => b.kind !== a.kind && (a.kind === 'move') !== (b.kind === 'move'))) out.push(L.apply(t, b));
  }
  return out;
}
test('手引き: 各講に成功する手があり、何もせず確定すると失敗する', () => {
  assert.equal(L.LESSONS.length, 5);
  for (const les of L.LESSONS) {
    const s = L.setupBattle(les.plan);
    assert.ok(allTurns(s).some((t) => les.success(L.endTurn(t))), `${les.title}: 成功する手がない`);
    assert.ok(!les.success(L.endTurn(s)), `${les.title}: 何もしなくても成功する`);
  }
});

console.log(`\n${n} 件すべて通った`);
