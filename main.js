// DAWNWARD の画面。決まりは logic.js にあり、ここは描く・触る・鳴らす・保存するだけ。
import * as L from './logic.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。キーは必ず 'dawnward.' で始める。
const STORE = 'dawnward.';
function loadRaw(key) {
  try { return localStorage.getItem(STORE + key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}
function drop(key) {
  try { localStorage.removeItem(STORE + key); } catch { /* 同上 */ }
}

WebAppKit.init({ title: 'DAWNWARD', text: '攻撃をそらして灯を守る、盤の上の戦術ゲーム。' });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

const $ = (id) => document.getElementById(id);
const settings = (() => {
  try { const s = JSON.parse(loadRaw('settings')); if (s && s.v === 1) return { v: 1, sound: s.sound !== false, tutorialDone: !!s.tutorialDone }; } catch { /* 下の既定値 */ }
  return { v: 1, sound: true, tutorialDone: false };
})();
let records = L.readRecords(loadRaw('records'));
let run = null;
{
  const raw = loadRaw('run');
  if (raw != null) {
    run = L.readRun(raw);
    if (!run) { drop('run'); $('notice').textContent = '途中の夜は戻せなかった。'; $('notice').hidden = false; }
  }
}
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 音 ----------

// iPhone のマナーモードでも鳴らす（Safari 16.4 以降）。'playback' は音がオンのときだけ。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}
let ac = null;
function audio() {
  if (!settings.sound) return null;
  if (!ac) {
    setAudioSession(true);
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
document.addEventListener('pointerdown', () => audio(), { once: true });
function tone(freq, dur, { type = 'sine', vol = 0.08, to = null, delay = 0 } = {}) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.05) {
  const c = audio();
  if (!c) return;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource(), g = c.createGain();
  src.buffer = buf;
  g.gain.value = vol;
  src.connect(g).connect(c.destination);
  src.start();
}
const sfx = {
  select: () => tone(900, 0.04, { type: 'square', vol: 0.025 }),
  move: () => tone(420, 0.12, { to: 640, vol: 0.06 }),
  shove: () => tone(170, 0.1, { type: 'triangle', vol: 0.12 }),
  bump: () => { tone(95, 0.16, { type: 'triangle', vol: 0.14 }); noise(0.08); },
  fall: () => tone(520, 0.28, { to: 110, type: 'triangle', vol: 0.08 }),
  wall: () => { tone(1250, 0.04, { type: 'square', vol: 0.03 }); tone(720, 0.09, { type: 'triangle', vol: 0.08 }); },
  twist: () => { tone(620, 0.06, { vol: 0.06 }); tone(830, 0.07, { vol: 0.06, delay: 0.07 }); },
  undo: () => tone(520, 0.1, { to: 380, vol: 0.05 }),
  confirm: () => tone(1320, 0.28, { vol: 0.05 }),
  miss: () => tone(320, 0.05, { vol: 0.025 }),
  hit: () => tone(115, 0.15, { type: 'triangle', vol: 0.12 }),
  lampOut: () => { tone(660, 0.18, { to: 440, vol: 0.08 }); tone(440, 0.2, { to: 250, vol: 0.08, delay: 0.19 }); },
  stage: () => [523, 659, 784].forEach((f, i) => tone(f, 0.14, { vol: 0.07, delay: i * 0.09 })),
  dawn: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { vol: 0.07, delay: i * 0.1 })),
  lose: () => tone(110, 0.6, { vol: 0.1 }),
};
function showSound() {
  $('sound').textContent = settings.sound ? '音 オン' : '音 オフ';
  $('sound').setAttribute('aria-pressed', String(settings.sound));
}
$('sound').addEventListener('click', () => {
  settings.sound = !settings.sound;
  setAudioSession(settings.sound);
  save('settings', settings);
  showSound();
  sfx.select();
});

// ---------- 言葉 ----------

const NAME = { node: '灯', wall: '壁', circle: '鞠', square: '楯', diamond: '梶', rammer: '咬', piercer: '裂', burster: '弾' };
const VERB = { rammer: '噛んだ', piercer: '裂いた', burster: '弾いた' };
const FOE_DESC = { rammer: '向いた隣の 1 マスを噛む', piercer: '向いた方向を盤の端まで裂く。駒は素通りし、壁で止まる', burster: '四方の隣 4 マスを弾く。向きが無いので回せない' };
const UNIT_DESC = { circle: '動いて、隣のものを 1 マス押す', square: '動いて、隣の空きマスに壁を建てる', diamond: '駒の上を通り抜けて動き、隣の敵の向きを回す' };
const stageName = (i) => L.STAGES[i - 1].name;
const starsText = (stars) => L.STAGES.map((st, i) => `${st.name} ${i < stars.length ? (stars[i] ? '★' : '☆') : '・'}`).join('  ');
const fmtDay = (k) => { const [, m, d] = k.split('-').map(Number); return `${m}月${d}日`; };

// ---------- 画面の切り替え ----------

function show(id) {
  for (const s of ['title', 'play', 'result']) $(s).hidden = s !== id;
  scrollTo(0, 0);
}

function showTitle() {
  stopReplay();
  const today = L.dayKey();
  const rec = records.daily[today];
  const todayRun = run && run.dailyKey === today;
  let state = 'まだ';
  if (todayRun) state = `途中（${stageName(run.stage)}）`;
  else if (rec) state = rec.won ? `守り抜いた・星 ${rec.stars}` : `${stageName(rec.stage)}で途絶えた`;
  $('tonightDay').textContent = `今夜 ${fmtDay(today)} ・ ${state}`;
  $('daily').textContent = todayRun ? '続きから' : rec ? 'もう一度守る' : '今夜を守る';
  const n = L.streakNow(records, today);
  $('streak').hidden = n < 2;
  $('streak').textContent = `${n} 夜つづけて`;
  $('resume').hidden = !run || todayRun;
  if (run && !todayRun) $('resume').textContent = run.dailyKey ? `続きから（${fmtDay(run.dailyKey)}の夜）` : `続きから（好きな夜・${stageName(run.stage)}）`;
  $('menu').classList.toggle('first', !settings.tutorialDone);
  showSound();
  show('title');
}

// 途中の夜は 1 つだけ。別の夜を始めるときは確かめる。
function begin(seed, dailyKey) {
  if (run && !confirm(run.dailyKey ? `${fmtDay(run.dailyKey)}の途中の夜を捨てますか` : '好きな夜の途中を捨てますか')) return;
  run = L.newRun(seed, dailyKey);
  save('run', run);
  sfx.confirm();
  startBattle();
}
$('daily').addEventListener('click', () => {
  const today = L.dayKey();
  if (run && run.dailyKey === today) { startBattle(); return; }
  begin(L.dailySeed(today), today);
});
$('free').addEventListener('click', () => begin((Date.now() ^ (Math.random() * 0x100000000)) >>> 0, null));
$('resume').addEventListener('click', () => startBattle());
$('back').addEventListener('click', () => { sfx.undo(); showTitle(); });

// ---------- 刻の画面 ----------

// ui.base = そのターンのはじめ、ui.view = 今の盤、ui.history = 一手戻す用
let ui = null;
let lessonIndex = 0;

function startBattle() {
  $('notice').hidden = true;
  if (run.status === 'choosing') { enterBattle(run.battle, 'run'); openChoose(); return; }
  enterBattle(run.battle, 'run');
}
function enterBattle(battle, mode) {
  ui = { mode, base: battle, view: battle, history: [], sel: null, sqMode: 'move', twist: null, replay: null, doomed: new Set(), lastInfo: null };
  $('choose').hidden = true;
  $('lessonEnd').hidden = true;
  const lesson = mode === 'lesson' ? L.LESSONS[lessonIndex] : null;
  $('lesson').hidden = !lesson;
  if (lesson) {
    $('lessonTeach').textContent = lesson.teach;
    $('lessonGoal').textContent = lesson.goal;
  }
  show('play');
  refresh();
}

function refresh() {
  const s = ui.view;
  const lesson = ui.mode === 'lesson' ? L.LESSONS[lessonIndex] : null;
  $('stageName').textContent = lesson ? `手引き ${lessonIndex + 1}/${L.LESSONS.length} ${lesson.title}` : `${stageName(run.stage)} ${run.stage}/${L.STAGES.length}`;
  $('turn').textContent = lesson ? '' : `ターン ${Math.min(s.turn, s.turnsToSurvive)}/${s.turnsToSurvive}`;
  $('stars').textContent = lesson ? '' : run.stars.map((x) => (x ? '★' : '☆')).join('');
  $('lamps').innerHTML = Array.from({ length: s.nodesStart }, (_, i) => `<i class="lamp-icon${i < s.nodesStart - s.nodesLost ? '' : ' out'}"></i>`).join('');
  // このターンで壊れる灯と倒れる駒（敵の攻撃の段で消えるもの）
  if (!ui.replay) {
    ui.doomed = new Set();
    for (const st of L.endTurnTrace(s)) if (st.phase === 'attack') for (const e of st.events) if (e.kind === 'down' && (e.pk === 'node' || e.pk === 'unit')) ui.doomed.add(e.id);
  }
  draw();
  controls();
  info();
}

function selected() { return ui.sel != null ? L.byId(ui.view, ui.sel) : null; }

function controls() {
  const busy = !!ui.replay || ui.view.outcome !== 'none';
  $('undo').disabled = busy || ui.history.length === 0;
  $('confirm').disabled = busy;
  const u = selected();
  const ex = $('extra');
  ex.innerHTML = '';
  if (busy) return;
  const btn = (label, fn, pressed) => {
    const b = document.createElement('button');
    b.className = 'pill';
    b.textContent = label;
    if (pressed != null) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', fn);
    ex.append(b);
  };
  if (ui.twist) {
    btn('右へ回す ↻', () => act({ kind: 'twist', id: u.id, dir: ui.twist.dir, turn: 1 }));
    btn('左へ回す ↺', () => act({ kind: 'twist', id: u.id, dir: ui.twist.dir, turn: -1 }));
    btn('やめる', () => { ui.twist = null; refresh(); });
  } else if (u && u.type === 'square') {
    btn('移動', () => { ui.sqMode = 'move'; sfx.select(); refresh(); }, ui.sqMode === 'move');
    btn('壁', () => { ui.sqMode = 'wall'; sfx.select(); refresh(); }, ui.sqMode === 'wall');
  }
}

function setInfo(text, warn = false) {
  $('info').textContent = text;
  $('info').classList.toggle('warn', warn);
}
function info() {
  if (ui.replay) return;
  if (ui.lastInfo) { setInfo(ui.lastInfo); ui.lastInfo = null; return; }
  const u = selected();
  if (ui.twist) return setInfo('回す向きを選ぶ。細い線が回したあとの攻撃。');
  if (u) {
    const left = [!u.moved && '移動', !u.acted && '手'].filter(Boolean).join('・');
    return setInfo(`${NAME[u.type]}（体力 ${u.hp}/${u.maxHp}）${UNIT_DESC[u.type]}。${left ? `残り: ${left}` : 'この駒は済んだ'}`);
  }
  const doomedNodes = [...ui.doomed].filter((id) => L.byId(ui.view, id)?.kind === 'node').length;
  if (doomedNodes) return setInfo('灯が消されます。押してどける・遮る・盾になる', true);
  if (ui.doomed.size) return setInfo('二重丸の駒が倒れます', true);
  setInfo('駒を選んで動かす。済んだら確定');
}

// ---------- 盤を描く ----------

const C = 100;
const cx = (v) => v.x * C + C / 2, cy = (v) => v.y * C + C / 2;
const arrowPts = (v, dir, r1 = 44, r2 = 30, w = 12) => {
  const d = L.DIRS[dir], px = -d.y, py = d.x;
  const tip = [cx(v) + d.x * r1, cy(v) + d.y * r1];
  const b = [cx(v) + d.x * r2, cy(v) + d.y * r2];
  return `${tip[0]},${tip[1]} ${b[0] + px * w},${b[1] + py * w} ${b[0] - px * w},${b[1] - py * w}`;
};
const pips = (p, y) => {
  let out = '';
  const w = 12, gap = 4, x0 = cx(p.at) - ((w + gap) * p.maxHp - gap) / 2;
  for (let i = 0; i < p.maxHp; i++) out += `<rect x="${x0 + i * (w + gap)}" y="${y}" width="${w}" height="6" rx="2" fill="${i < p.hp ? '#ffe7c2' : '#3a3150'}"/>`;
  return out;
};

function draw() {
  const s = ui.view;
  const u = ui.replay ? null : selected();
  let g = `<defs><radialGradient id="lg"><stop offset="0" stop-color="#ffb554" stop-opacity=".5"/><stop offset="1" stop-color="#ffb554" stop-opacity="0"/></radialGradient></defs>`;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) g += `<rect x="${x * C + 3}" y="${y * C + 3}" width="${C - 6}" height="${C - 6}" rx="10" fill="${(x + y) % 2 ? '#15112a' : '#181430'}"/>`;
  // 動ける先・手を出せる相手
  if (u && !ui.twist) {
    if (!u.moved && (u.type !== 'square' || ui.sqMode === 'move')) for (const v of L.reachable(s, u)) g += `<rect x="${v.x * C + 8}" y="${v.y * C + 8}" width="${C - 16}" height="${C - 16}" rx="8" fill="rgba(222,210,184,.16)"/>`;
    if (!u.acted && u.type === 'square' && ui.sqMode === 'wall') for (const d of L.wallDirs(s, u)) { const v = L.add(u.at, L.DIRS[d]); g += `<rect x="${v.x * C + 18}" y="${v.y * C + 18}" width="${C - 36}" height="${C - 36}" rx="6" fill="rgba(222,210,184,.12)" stroke="#ded2b8" stroke-width="3" stroke-dasharray="8 6"/><text x="${cx(v)}" y="${cy(v) + 12}" text-anchor="middle" font-size="34" fill="#ded2b8">壁</text>`; }
  }
  // 攻撃されるマス（赤の破線）
  for (const f of L.foesOf(s)) {
    if (f.submerged) continue;
    for (const v of L.threatCells(s, f)) g += `<rect x="${v.x * C + 7}" y="${v.y * C + 7}" width="${C - 14}" height="${C - 14}" rx="8" fill="rgba(224,90,125,.16)" stroke="#e05a7d" stroke-width="4" stroke-dasharray="10 7"/>`;
  }
  // 浮上の印（破線の丸）
  for (const f of L.foesOf(s)) if (f.submerged) {
    const v = f.intent.at;
    g += `<circle cx="${cx(v)}" cy="${cy(v)}" r="34" fill="rgba(224,90,125,.08)" stroke="#e59ab0" stroke-width="4" stroke-dasharray="9 7"/><text x="${cx(v)}" y="${cy(v) + 11}" text-anchor="middle" font-size="30" fill="#e59ab0" opacity=".7">${NAME[f.type]}</text>`;
  }
  // もの
  for (const p of s.pieces) {
    if (p.submerged) continue;
    const x = cx(p.at), y = cy(p.at);
    if (p.kind === 'node') {
      g += `<circle cx="${x}" cy="${y}" r="48" fill="url(#lg)"/><rect x="${x - 10}" y="${y - 34}" width="20" height="7" rx="2" fill="#7a4a1a"/><rect x="${x - 17}" y="${y - 27}" width="34" height="46" rx="9" fill="#ffb554"/><rect x="${x - 9}" y="${y - 19}" width="18" height="30" rx="4" fill="#fff1c9"/><rect x="${x - 11}" y="${y + 19}" width="22" height="7" rx="2" fill="#7a4a1a"/>`;
      if (p.maxHp > 1) g += pips(p, y + 32);
    } else if (p.kind === 'wall') {
      g += `<rect x="${x - 36}" y="${y - 32}" width="72" height="68" rx="6" fill="#00000055"/><rect x="${x - 38}" y="${y - 38}" width="76" height="70" rx="6" fill="#6b5a48" stroke="#ded2b8" stroke-width="3"/><path d="M${x - 38} ${y - 3}h76M${x} ${y - 38}v35M${x - 19} ${y - 3}v35M${x + 19} ${y - 3}v35" stroke="#ded2b8" stroke-width="2" opacity=".5"/>`;
      if (p.maxHp > 1) g += pips(p, y + 36);
    } else if (p.kind === 'unit') {
      const done = p.moved && p.acted;
      const shape = (dx, dy, fill, stroke) => p.type === 'circle' ? `<circle cx="${x + dx}" cy="${y - 6 + dy}" r="30" fill="${fill}" ${stroke}/>`
        : p.type === 'square' ? `<rect x="${x - 28 + dx}" y="${y - 34 + dy}" width="56" height="56" rx="6" fill="${fill}" ${stroke}/>`
          : `<path d="M${x + dx} ${y - 40 + dy}L${x + 34 + dx} ${y - 6 + dy}L${x + dx} ${y + 28 + dy}L${x - 34 + dx} ${y - 6 + dy}Z" fill="${fill}" ${stroke}/>`;
      g += `<g opacity="${done ? 0.55 : 1}">${shape(3, 5, '#00000066', '')}${shape(0, 0, '#ded2b8', 'stroke="#2a2238" stroke-width="4"')}<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="26" font-weight="700" fill="#2a2238">${NAME[p.type]}</text>${pips(p, y + 32)}</g>`;
      if (ui.sel === p.id && !ui.replay) g += `<rect x="${p.at.x * C + 4}" y="${p.at.y * C + 4}" width="${C - 8}" height="${C - 8}" rx="10" fill="none" stroke="#ffe9b0" stroke-width="5"/>`;
    } else {
      g += `<rect x="${x - 30}" y="${y - 30}" width="64" height="64" rx="12" fill="#00000077"/><rect x="${x - 32}" y="${y - 34}" width="64" height="64" rx="12" fill="#1d1530" stroke="#e05a7d" stroke-width="3"/><text x="${x}" y="${y + 9}" text-anchor="middle" font-size="36" fill="#f3c6d3">${NAME[p.type]}</text>`;
      if (p.intent.dir != null) g += `<polygon points="${arrowPts(p.at, p.intent.dir, 48, 36, 10)}" fill="#e05a7d"/>`;
      g += pips(p, y + 36);
    }
    // このターンで壊れる・倒れるものに二重丸
    if (ui.doomed.has(p.id)) g += `<circle cx="${x}" cy="${y}" r="45" fill="none" stroke="#ff6f91" stroke-width="3"/><circle cx="${x}" cy="${y}" r="38" fill="none" stroke="#ff6f91" stroke-width="3"/>`;
  }
  // 回したあとの攻撃（細い線）
  if (ui.twist) {
    const f = L.pieceAt(s, L.add(u.at, L.DIRS[ui.twist.dir]));
    for (const [turn, label] of [[1, '右'], [-1, '左']]) {
      const t = { ...f, intent: { ...f.intent, dir: (f.intent.dir + turn + 4) % 4 } };
      for (const v of L.threatCells(s, t)) g += `<rect x="${v.x * C + 14}" y="${v.y * C + 14}" width="${C - 28}" height="${C - 28}" rx="6" fill="none" stroke="#ffd0dc" stroke-width="2"/><text x="${v.x * C + 22}" y="${v.y * C + 38}" font-size="22" font-weight="700" fill="#ffd0dc" stroke="#0a0817" stroke-width="6" paint-order="stroke">${label}</text>`;
    }
  }
  // 押せる向き（鞠）・回せる敵（梶）
  if (u && !ui.twist && !u.acted) {
    if (u.type === 'circle') for (const d of L.pushDirs(s, u)) g += `<polygon points="${arrowPts(L.add(u.at, L.DIRS[d]), d, 46, 26, 16)}" fill="#ded2b8" stroke="#2a2238" stroke-width="3"/>`;
    if (u.type === 'diamond') for (const d of L.twistDirs(s, u)) { const v = L.add(u.at, L.DIRS[d]); g += `<circle cx="${v.x * C + 80}" cy="${v.y * C + 20}" r="17" fill="#ded2b8" stroke="#2a2238" stroke-width="3"/><text x="${v.x * C + 80}" y="${v.y * C + 28}" text-anchor="middle" font-size="22" font-weight="700" fill="#2a2238">↻</text>`; }
  }
  $('board').innerHTML = g;
}

// ---------- 触る ----------

$('board').addEventListener('click', (e) => {
  if (ui.replay) { finishReplay(); return; }
  if (ui.view.outcome !== 'none') return;   // 決着した盤（結果・3 択の前）は触れない
  const r = $('board').getBoundingClientRect();
  const v = { x: Math.floor(((e.clientX - r.left) / r.width) * 6), y: Math.floor(((e.clientY - r.top) / r.height) * 6) };
  if (!L.inside(ui.view, v)) return;
  tap(v);
});

function tap(v) {
  const s = ui.view;
  const u = selected();
  const p = L.pieceAt(s, v);
  if (ui.twist) { ui.twist = null; }
  if (u) {
    const d = L.DIRS.findIndex((dd) => L.eq(L.add(u.at, dd), v));
    if (!u.acted && d >= 0) {
      if (u.type === 'circle' && L.pushDirs(s, u).includes(d)) return act({ kind: 'push', id: u.id, dir: d });
      if (u.type === 'square' && ui.sqMode === 'wall' && L.wallDirs(s, u).includes(d)) return act({ kind: 'wall', id: u.id, dir: d });
      if (u.type === 'diamond' && L.twistDirs(s, u).includes(d)) { ui.twist = { dir: d }; sfx.select(); return refresh(); }
    }
    if (!u.moved && !p && (u.type !== 'square' || ui.sqMode === 'move') && L.reachable(s, u).some((w) => L.eq(w, v))) return act({ kind: 'move', id: u.id, to: v });
  }
  if (p && p.kind === 'unit') {
    ui.sel = ui.sel === p.id ? null : p.id;
    ui.sqMode = 'move';
    sfx.select();
    return refresh();
  }
  ui.sel = null;
  const mark = L.foesOf(s).find((f) => f.submerged && L.eq(f.intent.at, v));
  if (p && p.kind === 'foe') ui.lastInfo = `${NAME[p.type]}（体力 ${p.hp}/${p.maxHp}）${FOE_DESC[p.type]}`;
  else if (p && p.kind === 'node') ui.lastInfo = `灯: 攻撃を受けると消える。この刻で 1 つも消さなければ星。${p.maxHp > 1 ? '灯の芯で 1 度は耐える。' : ''}`;
  else if (p && p.kind === 'wall') ui.lastInfo = '壁: 攻撃を受け止め、裂の線を止める。敵の番の終わりに崩れる';
  else if (mark) ui.lastInfo = `印: 次の敵の番に${NAME[mark.type]}が下から現れる。駒か壁で塞げば出てこない`;
  refresh();
}

function act(a) {
  const next = L.apply(ui.view, a);
  if (!next) return;
  ui.history.push(ui.view);
  ui.view = next;
  ui.twist = null;
  const ev = next.events;
  if (ev.some((e) => e.kind === 'fall')) sfx.fall();
  else if (ev.some((e) => e.kind === 'bump')) sfx.bump();
  else if (ev.some((e) => e.kind === 'shove')) sfx.shove();
  else if (a.kind === 'wall') sfx.wall();
  else if (a.kind === 'twist') sfx.twist();
  else sfx.move();
  if (ev.some((e) => e.kind === 'down' && e.pk === 'node')) sfx.lampOut();
  // 動いたあとも手が残っていれば選んだまま
  const u = L.byId(next, a.id);
  if (!u || (u.moved && u.acted)) ui.sel = null;
  else if (u.type === 'square' && a.kind === 'move') ui.sqMode = 'wall';
  refresh();
}

$('undo').addEventListener('click', () => {
  if (!ui.history.length || ui.replay) return;
  ui.view = ui.history.pop();
  ui.twist = null;
  sfx.undo();
  refresh();
});

// ---------- 敵の番 ----------

function stepText(st) {
  const out = [];
  for (const e of st.events) {
    if (e.kind === 'attack') {
      const hits = st.events.filter((h) => h.kind === 'hit').map((h) => NAME[h.type]);
      out.push(hits.length ? `${NAME[e.type]}が${[...new Set(hits)].join('と')}を${VERB[e.type]}` : `${NAME[e.type]}の攻撃は空を切った`);
    } else if (e.kind === 'surface') out.push(`${NAME[e.type]}が現れた`);
    else if (e.kind === 'blocked') out.push(`印を塞いだ。${NAME[e.type]}は潜ったまま`);
    else if (e.kind === 'down' && e.pk === 'node') out.push('灯が消えた');
    else if (e.kind === 'down' && e.pk === 'unit') out.push(`${NAME[e.type]}が倒れた`);
    else if (e.kind === 'down' && e.pk === 'foe') out.push(`${NAME[e.type]}が倒れた`);
  }
  if (st.phase === 'move') return '夜のかたちが動いた';
  if (st.phase === 'mark') return '新しい印が出た';
  return [...new Set(out)].join('。');
}
function stepSound(st) {
  const ev = st.events;
  if (ev.some((e) => e.kind === 'down' && e.pk === 'node')) sfx.lampOut();
  else if (ev.some((e) => e.kind === 'hit')) sfx.hit();
  else if (st.phase === 'attack') sfx.miss();
}

$('confirm').addEventListener('click', () => {
  if (ui.replay || ui.view.outcome !== 'none') return;
  sfx.confirm();
  ui.sel = null;
  ui.twist = null;
  const steps = L.endTurnTrace(ui.view);
  ui.replay = { steps, i: 0, timer: null };
  ui.doomed = new Set();
  controls();
  playStep();
});
function playStep() {
  const r = ui.replay;
  const st = r.steps[r.i];
  ui.view = st.state;
  draw();
  refreshHud();
  const text = stepText(st);
  if (text) setInfo(text, st.events.some((e) => e.kind === 'down' && e.pk !== 'foe'));
  stepSound(st);
  r.i++;
  if (r.i >= r.steps.length) { r.timer = setTimeout(endReplay, reduced ? 200 : 500); return; }
  r.timer = setTimeout(playStep, reduced ? 250 : 500);
}
function refreshHud() {
  const s = ui.view;
  $('lamps').innerHTML = Array.from({ length: s.nodesStart }, (_, i) => `<i class="lamp-icon${i < s.nodesStart - s.nodesLost ? '' : ' out'}"></i>`).join('');
}
function finishReplay() {
  const r = ui.replay;
  clearTimeout(r.timer);
  ui.view = r.steps.at(-1).state;
  endReplay();
}
function stopReplay() {
  if (ui && ui.replay) { clearTimeout(ui.replay.timer); ui.replay = null; }
}
function endReplay() {
  const final = ui.replay.steps.at(-1).state;
  ui.replay = null;
  ui.view = final;
  ui.base = final;
  ui.history = [];
  if (ui.mode === 'lesson') return lessonDone(final);
  run = L.afterTurn(run, final);
  if (run.status === 'done') {
    drop('run');
    records = L.recordRun(records, run);
    save('records', records);
    const finished = run;
    refresh();
    run = null;
    setInfo(finished.won ? '暁を守り抜いた' : '灯が尽きた', !finished.won);
    finished.won ? sfx.dawn() : sfx.lose();
    setTimeout(() => showResult(finished), 900);
    return;
  }
  save('run', run);
  refresh();
  if (run.status === 'choosing') { sfx.stage(); openChoose(); }
}

// ---------- 強化の 3 択 ----------

let pick = null;
function openChoose() {
  pick = null;
  const done = run.stage;
  const star = run.stars[done - 1];
  $('chooseTitle').textContent = `${stageName(done)}を守った`;
  $('chooseLine').textContent = `${star ? '灯を 1 つも消さなかった。星 ★' : '灯が消えたので星は無し'}。次は${stageName(done + 1)}。強化を 1 つ選ぶ。`;
  const cards = $('cards');
  cards.innerHTML = '';
  for (const id of run.offer) {
    const up = L.UPGRADES.find((x) => x.id === id);
    const b = document.createElement('button');
    b.className = 'card';
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<b>${up.name}</b><span>${up.desc}</span>`;
    b.addEventListener('click', () => {
      pick = id;
      for (const c of cards.children) c.setAttribute('aria-pressed', String(c === b));
      $('take').disabled = false;
      sfx.select();
    });
    cards.append(b);
  }
  $('take').disabled = true;
  $('choose').hidden = false;
}
$('take').addEventListener('click', () => {
  if (!pick) return;
  run = L.choose(run, pick);
  save('run', run);
  sfx.confirm();
  startBattle();
});

// ---------- 夜の結果 ----------

let shareText = '';
function showResult(r) {
  const lostStage = stageName(r.stage);
  const unitsGone = !r.won && L.unitsOf(r.battle).length === 0;
  $('resultHead').textContent = r.won ? '夜が明けた' : `${lostStage}で${unitsGone ? '駒が尽きた' : '灯が尽きた'}`;
  $('resultStars').textContent = starsText(r.stars);
  const nStars = r.stars.filter(Boolean).length;
  const taken = r.taken.map((id) => L.UPGRADES.find((x) => x.id === id).name).join('・') || 'なし';
  const score = L.scoreOf(r);
  $('resultStats').innerHTML = `<dt>星</dt><dd>${nStars} / 3</dd><dt>落とした敵</dt><dd>${r.stats.foesDropped}</dd><dt>消えた灯</dt><dd>${r.stats.nodesLost}</dd><dt>強化</dt><dd>${taken}</dd><dt>点数</dt><dd>${score}（最高 ${records.best}）</dd>`;
  $('resultSeed').hidden = !!r.dailyKey;
  $('resultSeed').textContent = `種 ${r.seed}`;
  $('again').hidden = !!r.dailyKey;
  const head = r.dailyKey ? `今夜 ${fmtDay(r.dailyKey)}` : `好きな夜（種 ${r.seed}）`;
  shareText = r.won
    ? `DAWNWARD ${head} 夜明けまで守った（星 ${nStars}/3・落とした敵 ${r.stats.foesDropped}）\n${starsText(r.stars)}`
    : `DAWNWARD ${head} ${lostStage}で${unitsGone ? '駒' : '灯'}が尽きた（落とした敵 ${r.stats.foesDropped}）\n${starsText(r.stars)}`;
  show('result');
  // 出た直後の 0.4 秒は押せない（確定の連打で飛ばさないように）
  const buttons = [$('shareResult'), $('again'), $('toTitle')];
  buttons.forEach((b) => { b.disabled = true; });
  setTimeout(() => buttons.forEach((b) => { b.disabled = false; }), 400);
}
$('shareResult').addEventListener('click', () => WebAppKit.share({ text: shareText }));
$('again').addEventListener('click', () => { begin((Date.now() ^ (Math.random() * 0x100000000)) >>> 0, null); });
$('toTitle').addEventListener('click', () => { sfx.undo(); showTitle(); });

// ---------- 手引き ----------

function startLesson(i) {
  lessonIndex = i;
  enterBattle(L.setupBattle(L.LESSONS[i].plan), 'lesson');
}
function lessonDone(final) {
  const les = L.LESSONS[lessonIndex];
  const ok = les.success(final);
  refresh();
  const last = lessonIndex === L.LESSONS.length - 1;
  $('lessonEndTitle').textContent = ok ? (last ? '手引きを終えた' : 'できた') : 'もう一度';
  $('lessonEndLine').textContent = ok ? (last ? '三つの駒の使い方はこれで全部。今夜を守りに行こう。' : `次は「${L.LESSONS[lessonIndex + 1].title}」。`) : `こつ: ${les.hint}`;
  $('lessonNext').textContent = ok ? (last ? 'タイトルへ' : '次へ') : 'やり直す';
  $('lessonNext').onclick = () => {
    sfx.confirm();
    if (!ok) return startLesson(lessonIndex);
    if (!last) return startLesson(lessonIndex + 1);
    settings.tutorialDone = true;
    save('settings', settings);
    showTitle();
  };
  $('lessonEnd').hidden = false;
  ok ? sfx.stage() : sfx.lose();
}
$('tutorial').addEventListener('click', () => { sfx.confirm(); startLesson(0); });

showTitle();
