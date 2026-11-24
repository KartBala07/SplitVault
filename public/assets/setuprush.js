/* Setup Rush, web port — hold to open, drag down to flip, release to cash out.
   Candles are the recorded 15-minute series from the SetupRush app
   (public/assets/markets.json). Mechanics follow GameEngine.swift:
   notional = max(500, equity) × leverage, pnl = notional × dir × (exit − entry) / entry,
   0.04% fee per side, candles print over 1.5s of real time. */

const CANDLE_SECS = 1.5;
const WARMUP = 50;
const FEE = 0.0004;

const MODES = {
  rush: { key: 'rush', name: 'RUSH', lev: 1, short: false, secs: 60, bars: 40, note: 'spot · long only' },
  pro: { key: 'pro', name: 'PRO', lev: 25, short: true, secs: 60, bars: 40, note: '25× · long & short' },
  blowup: { key: 'blowup', name: 'BLOW-UP', lev: 25, short: true, secs: 60, bars: 40, note: '25× → 100×' },
  sniper: { key: 'sniper', name: 'SNIPER', lev: 10, short: true, secs: 90, bars: 55, note: 'one trade' }
};

const BOARD = 'sv.setuprush.runs';
const ORDER = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'DOGE-USD', 'LINK-USD', 'AVAX-USD', 'XRP-USD', 'SUI-USD'];

const fmtPrice = (n) => {
  if (!Number.isFinite(n)) return '—';
  const d = n >= 1000 ? 2 : n >= 10 ? 3 : n >= 1 ? 4 : 6;
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---- recorded data ---- */
let DATA = null;
async function loadMarkets() {
  if (DATA) return DATA;
  /* relative: the published build lives under /SplitVault/ */
  const res = await fetch(new URL('assets/markets.json', document.baseURI), { cache: 'no-cache' });
  if (!res.ok) throw new Error('markets.json ' + res.status);
  const raw = await res.json();
  const out = {};
  for (const [sym, wrap] of Object.entries(raw.markets)) {
    out[sym] = wrap.candles.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
  }
  DATA = out;
  return out;
}

/* ---- price path inside a candle (ported from Candle.subPrice) ---- */
function subPrice(c, p) {
  const legs = c.c >= c.o
    ? [[0, c.o], [0.20, c.l], [0.56, c.h], [0.82, c.c], [1, c.c]]
    : [[0, c.o], [0.20, c.h], [0.56, c.l], [0.82, c.c], [1, c.c]];
  const t = Math.min(Math.max(p, 0), 1);
  for (let i = 0; i < legs.length - 1; i++) {
    const [p0, v0] = legs[i];
    const [p1, v1] = legs[i + 1];
    if (t <= p1) {
      const f = p1 === p0 ? 1 : (t - p0) / (p1 - p0);
      return v0 + (v1 - v0) * f;
    }
  }
  return c.c;
}

function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function avgRange(cs, i, n = 14) {
  let sum = 0, count = 0;
  for (let k = Math.max(0, i - n + 1); k <= i; k++) { sum += cs[k].h - cs[k].l; count++; }
  return count ? sum / count : 0;
}

/* Compact port of the app's pattern detector: body geometry, not the full book. */
function detectSetup(cs, i) {
  if (i < 25) return null;
  const a = cs[i - 1], b = cs[i];
  const body = Math.abs(b.c - b.o);
  const range = Math.max(b.h - b.l, 1e-9);
  const up = b.c >= b.o;
  const atr = avgRange(cs, i - 1, 14) || range;
  let kind = null, dir = 0;

  if (up && a.c < a.o && b.c > a.o && b.o < a.c && body > Math.abs(a.c - a.o) * 0.9) { kind = 'BULL ENGULFING'; dir = 1; }
  else if (!up && a.c > a.o && b.c < a.o && b.o > a.c && body > Math.abs(a.c - a.o) * 0.9) { kind = 'BEAR ENGULFING'; dir = -1; }
  else if (body / range < 0.35 && (Math.min(b.o, b.c) - b.l) / range > 0.6) { kind = 'HAMMER'; dir = 1; }
  else if (body / range < 0.35 && (b.h - Math.max(b.o, b.c)) / range > 0.6) { kind = 'SHOOTING STAR'; dir = -1; }
  else if (up && b.c > Math.max(a.h, cs[i - 2].h) && b.v > a.v) { kind = 'RANGE BREAK'; dir = 1; }
  else if (!up && b.c < Math.min(a.l, cs[i - 2].l) && b.v > a.v) { kind = 'RANGE BREAK'; dir = -1; }
  if (!kind) return null;

  const slice = cs.slice(Math.max(0, i - 5), i + 1);
  const swing = dir > 0 ? Math.min(...slice.map((c) => c.l)) : Math.max(...slice.map((c) => c.h));
  const risk = Math.max(Math.abs(b.c - swing), atr * 0.55);
  return {
    kind, dir, at: i,
    entry: b.c,
    stop: dir > 0 ? b.c - risk : b.c + risk,
    target: dir > 0 ? b.c + risk * 2 : b.c - risk * 2
  };
}

export function initSetupRush({ toast }) {
  const el = (id) => document.getElementById(id);
  const stage = el('srRoot');
  const canvas = el('srChart');
  const ctx = canvas.getContext('2d');

  let st = null;
  let raf = null;
  let lastFrame = 0;
  let mounted = false;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let holdings = null;   // pointer hold bookkeeping
  let flashTimer = null;

  /* ---------------- lifecycle ---------------- */
  /* synchronous once the tape is loaded: an async reset would leave the old
     state live for a turn, so the first gesture would trade the previous mode */
  function reset(modeKey = (st ? st.mode.key : 'pro'), sym = (st ? st.sym : 'BTC-USD')) {
    if (!DATA) {
      loadMarkets().then(() => reset(modeKey, sym)).catch(() => {});
      return;
    }
    const markets = DATA;
    const mode = MODES[modeKey] || MODES.pro;
    const all = markets[sym] || markets[ORDER[0]];
    const need = WARMUP + mode.bars + 6;
    const maxStart = Math.max(0, all.length - need - 1);
    const start = Math.floor(Math.random() * (maxStart + 1));
    const window_ = all.slice(start, Math.min(all.length, start + need));

    st = {
      mode, sym,
      candles: window_,
      ema20: ema(window_.map((c) => c.c), 20),
      cursor: WARMUP,
      progress: 0,
      price: window_[WARMUP].c,
      timeLeft: mode.secs,
      speed: 1,
      bank: mode.key === 'blowup' ? 1000 : 0,
      equity: mode.key === 'blowup' ? 1000 : 0,
      peak: mode.key === 'blowup' ? 1000 : 0,
      position: null,
      trades: [],
      setups: [],
      lastSetupIndex: -99,
      leverage: mode.lev,
      liquidated: false,
      finished: false,
      started: false,
      startedAt: 0
    };
    el('srOver').hidden = true;
    modeButtons();
    hideFlash();
    renderAll();
    draw();
  }

  function modeButtons() {
    const box = el('srModes');
    if (!box) return; /* the app screen runs the single PRO table */
    if (box.dataset.built !== '1') {
      box.dataset.built = '1';
      box.innerHTML = Object.values(MODES).map((m) =>
        `<button data-mode="${m.key}" title="${m.note}">${m.name}</button>`).join('');
      box.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => { reset(b.dataset.mode, st.sym); toast(`${MODES[b.dataset.mode].name} — ${MODES[b.dataset.mode].note}`); }));
    }
    box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === st.mode.key));
  }

  /* ---------------- engine ---------------- */
  function priceAt(i, p) {
    const c = st.candles[Math.min(i, st.candles.length - 1)];
    return subPrice(c, p);
  }

  function unrealized() {
    if (!st.position) return 0;
    const p = st.position;
    return p.notional * p.dir * (st.price - p.entry) / Math.max(p.entry, 1e-9);
  }

  function mark() {
    st.equity = st.bank + unrealized();
    st.peak = Math.max(st.peak, st.equity);
    if (st.mode.key === 'blowup' && st.equity <= 0 && !st.liquidated) {
      st.liquidated = true;
      st.bank = 0;
      st.equity = 0;
      st.position = null;
      flash('LIQUIDATED', `${st.leverage.toFixed(0)}× GONE`, 'down', true);
      finish('liquidated');
    }
  }

  function canOpen() {
    if (!st || st.finished || st.liquidated) return false;
    if (st.mode.key === 'sniper' && st.trades.length >= 1) return false;
    return true;
  }

  function open(dir) {
    if (!canOpen() || st.position) return;
    const lev = st.mode.key === 'blowup' ? st.leverage : st.mode.lev;
    const base = st.mode.key === 'blowup' ? Math.max(st.bank, 1) : Math.max(500, st.equity);
    st.position = { dir, entry: st.price, notional: base * lev, lev, at: st.cursor };
    st.started = true;
    flash(dir > 0 ? 'LONG' : 'SHORT', `${lev.toFixed(0)}× @ ${fmtPrice(st.price)}`, dir > 0 ? 'up' : 'down', false);
    renderAll();
  }

  function close(silent = false) {
    if (!st.position) return;
    const p = st.position;
    const pnl = p.notional * p.dir * (st.price - p.entry) / Math.max(p.entry, 1e-9);
    const fee = p.notional * FEE;
    st.bank += pnl - fee;
    st.equity = st.bank;
    st.peak = Math.max(st.peak, st.equity);
    st.trades.unshift({ dir: p.dir, entry: p.entry, exit: st.price, pnl: pnl - fee, lev: p.lev, at: st.cursor });
    st.position = null;
    if (!silent) {
      const win = pnl - fee >= 0;
      flash(win ? 'CASHED' : 'STOPPED', `${money(pnl - fee)} · ${p.dir > 0 ? 'LONG' : 'SHORT'}`, win ? 'up' : 'down', true);
    }
    renderAll();
  }

  function step(dt) {
    if (!st || st.finished) return;
    st.timeLeft = Math.max(0, st.timeLeft - dt);
    if (st.mode.key === 'blowup') {
      st.leverage = Math.min(100, 25 + (st.mode.secs - st.timeLeft) / 45 * 75);
    }
    st.progress += dt / CANDLE_SECS * st.speed;
    while (st.progress >= 1 && st.cursor < st.candles.length - 2) {
      st.progress -= 1;
      st.cursor += 1;
      onCandleClose();
    }
    if (st.cursor >= st.candles.length - 2 && st.progress >= 1) st.progress = 0.999;
    st.price = priceAt(st.cursor, st.progress);
    mark();
    if (st.timeLeft <= 0) return finish('clock');
    if (st.cursor >= st.candles.length - 2) return finish('tape');
    renderTick();
  }

  function onCandleClose() {
    const i = st.cursor;
    const c = st.candles[i];

    for (const s of st.setups) {
      if (s.status !== 'forming' && s.status !== 'confirmed') continue;
      if (s.status === 'forming') {
        if (i - s.at > 4) { s.status = 'expired'; continue; }
        if ((c.c - s.entry) * s.dir > 0) s.status = 'confirmed';
      } else {
        const hitTarget = s.dir > 0 ? c.h >= s.target : c.l <= s.target;
        const hitStop = s.dir > 0 ? c.l <= s.stop : c.h >= s.stop;
        if (hitTarget) { s.status = 'target'; flash('TARGET', s.kind, 'up', false); }
        else if (hitStop) s.status = 'stopped';
      }
    }

    if (i - st.lastSetupIndex >= 3) {
      const hit = detectSetup(st.candles, i);
      if (hit) {
        st.lastSetupIndex = i;
        st.setups.push({ ...hit, status: 'forming' });
        if (st.setups.length > 4) st.setups.shift();
        flash(hit.kind, hit.dir > 0 ? 'BULLISH · FORMING' : 'BEARISH · FORMING', hit.dir > 0 ? 'up' : 'down', false);
      }
    }
  }

  function finish(reason) {
    if (!st || st.finished) return;
    close(true);
    st.finished = true;
    stopLoop();
    el('srState').textContent = reason === 'liquidated' ? 'liquidated' : 'closed';
    el('srState').className = 'chip paused';
    saveRun(reason);
    paintResult(reason);
    draw();
  }

  /* ---------------- scoring ---------------- */
  function score() {
    const wins = st.trades.filter((t) => t.pnl > 0).length;
    const winRate = st.trades.length ? wins / st.trades.length : 0;
    const pnl = st.equity - (st.mode.key === 'blowup' ? 1000 : 0);
    const best = st.trades.reduce((a, t) => Math.max(a, t.pnl), 0);
    return { wins, winRate, pnl, best, trades: st.trades.length };
  }

  function saveRun(reason) {
    if (!st.trades.length) return;
    const s = score();
    let runs = [];
    try { runs = JSON.parse(localStorage.getItem(BOARD) || '[]'); } catch {}
    runs.push({ mode: st.mode.key, pnl: s.pnl, trades: s.trades, winRate: s.winRate, sym: st.sym, reason, ts: Date.now() });
    runs.sort((a, b) => b.pnl - a.pnl);
    try { localStorage.setItem(BOARD, JSON.stringify(runs.slice(0, 20))); } catch {}
    renderBoard();
    renderHubBest();
  }

  function loadRuns() {
    try { return JSON.parse(localStorage.getItem(BOARD) || '[]'); } catch { return []; }
  }

  function renderBoard() {
    const runs = loadRuns();
    const body = el('srBoard');
    if (!body) return;
    if (!runs.length) { body.innerHTML = '<tr><td colspan="3" class="empty">No finished runs.</td></tr>'; return; }
    body.innerHTML = runs.slice(0, 5).map((r, i) =>
      `<tr><td>${i + 1}</td><td class="num ${r.pnl >= 0 ? 'up' : 'down'}">${money(r.pnl)}</td><td class="num">${MODES[r.mode] ? MODES[r.mode].name : r.mode} · ${r.trades}t</td></tr>`).join('');
  }

  function renderHubBest() {
    const hub = el('best-rush');
    if (!hub) return;
    const runs = loadRuns();
    hub.textContent = runs.length ? `best: ${money(runs[0].pnl)} (${MODES[runs[0].mode] ? MODES[runs[0].mode].name : runs[0].mode})` : 'best: —';
    hub.classList.toggle('neg', runs.length > 0 && runs[0].pnl < 0);
  }

  function paintResult(reason) {
    const s = score();
    const title = reason === 'liquidated' ? 'LIQUIDATED' : reason === 'tape' ? 'TAPE OVER' : 'TIME';
    const sub = reason === 'liquidated'
      ? 'Leverage took the whole bank.'
      : reason === 'tape'
        ? 'You reached the end of the recorded candles.'
        : 'The clock ran out — anything still open was closed at the last price.';
    el('srOver').hidden = false;
    el('srOverTitle').textContent = title;
    el('srOverSub').textContent = sub;
    el('srOverPnl').textContent = money(s.pnl);
    el('srOverPnl').className = s.pnl >= 0 ? 'up' : 'down';
    el('srOverTrades').textContent = `${s.trades}`;
    el('srOverWin').textContent = s.trades ? (s.winRate * 100).toFixed(0) + '%' : '—';
    el('srOverBest').textContent = s.trades ? money(s.best) : '—';
    el('srOverMode').textContent = `${st.mode.name} · ${st.sym.replace('-', '/')}`;
  }

  /* ---------------- HUD ---------------- */
  function flash(text, detail, tone, big) {
    const box = el('srFlash');
    box.hidden = false;
    box.className = 'flash ' + (tone || '') + (big ? ' big' : '');
    box.innerHTML = `${text}<span>${detail || ''}</span>`;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { box.hidden = true; }, 1100);
  }
  function hideFlash() { el('srFlash').hidden = true; }

  function renderTick() {
    el('srPx').textContent = fmtPrice(st.price);
    el('srEq').textContent = money(st.equity);
    el('srEq').className = st.equity >= 0 ? 'up' : 'down';
    el('srTime').textContent = st.timeLeft.toFixed(1) + 's';
    renderPosition();
    draw();
  }

  function renderPosition() {
    const pos = el('srPos');
    if (!st.position) { pos.hidden = true; return; }
    const p = st.position;
    const un = unrealized();
    pos.hidden = false;
    pos.className = 'position ' + (p.dir > 0 ? 'long' : 'short');
    pos.innerHTML = `<b>${p.dir > 0 ? 'LONG' : 'SHORT'} ${p.lev.toFixed(0)}×</b>
      <span>@ ${fmtPrice(p.entry)}</span>
      <strong class="${un >= 0 ? 'up' : 'down'}">${money(un)}</strong>
      <em>release to cash</em>`;
  }

  function renderAll() {
    if (!st) return;
    el('srState').textContent = st.finished ? 'closed' : st.started ? 'running' : 'ready';
    el('srState').className = 'chip ' + (st.finished ? 'paused' : st.started ? 'live' : '');
    /* an open position is a trade taken, not a finished one */
    el('srTrades').textContent = String(st.trades.length + (st.position ? 1 : 0));
    el('srHint').textContent = `${st.mode.note} · ${st.mode.short ? 'drag down to flip' : 'long only'}`;
    el('srLev').textContent = (st.mode.key === 'blowup' ? st.leverage : st.mode.lev).toFixed(0) + '×';
    renderBoard();
    renderHubBest();
    renderTick();
    renderPosition();
  }

  /* ---------------- chart ---------------- */
  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    draw();
  }

  function draw() {
    if (!st) return;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fbf9f2';
    ctx.fillRect(0, 0, W, H);

    const padL = 10, padR = 62, padT = 18, padB = 42;
    const plotW = Math.max(10, W - padL - padR);
    const plotH = Math.max(10, H - padT - padB);
    const VIS = 82;
    const end = st.cursor;
    const start = Math.max(1, end - VIS);
    const slice = st.candles.slice(start, end + 1);
    if (!slice.length) return;

    const last = st.candles[end];
    const forming = {
      o: last.o,
      c: st.price,
      h: Math.max(...slice.map((c) => c.h), st.price, last.o),
      l: Math.min(...slice.map((c) => c.l), st.price, last.o)
    };
    const barsForRange = slice.slice(0, -1).concat([forming]);
    let hi = -Infinity, lo = Infinity;
    for (const b of barsForRange) { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); }
    for (const s of st.setups) { hi = Math.max(hi, s.target, s.stop); lo = Math.min(lo, s.target, s.stop); }
    if (st.position) { hi = Math.max(hi, st.position.entry); lo = Math.min(lo, st.position.entry); }
    const span = Math.max(hi - lo, 1e-9);
    hi += span * 0.08; lo -= span * 0.08;
    const y = (p) => padT + (hi - p) / (hi - lo) * plotH;
    const n = Math.max(barsForRange.length, 1);
    const bw = plotW / n;

    /* horizontal grid + right price axis */
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const val = hi - (hi - lo) * (i / 4);
      const yy = Math.round(y(val)) + 0.5;
      ctx.strokeStyle = 'rgba(20,18,14,.09)';
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
      ctx.fillStyle = '#6c6457';
      ctx.fillText(fmtPrice(val), padL + plotW + 10, Math.min(Math.max(yy, padT + 6), padT + plotH - 8));
    }

    /* setups: entry / stop / target */
    const active = [...st.setups].reverse().find((s) => s.status === 'forming' || s.status === 'confirmed');
    st.setups.forEach((s) => {
      const dim = s !== active;
      const x0 = padL + Math.max(0, (s.at - start)) * bw;
      const x1 = padL + plotW;
      const line = (px, color, label) => {
        ctx.strokeStyle = color;
        ctx.globalAlpha = dim ? 0.25 : 1;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(x0, y(px)); ctx.lineTo(x1, y(px)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        if (!dim) {
          /* paper chip at the line's left end so the label never sits under the price tag */
          ctx.font = '700 10px ui-monospace, Menlo, monospace';
          const lw = ctx.measureText(label).width + 12;
          const ly = Math.min(Math.max(y(px), padT + 14), padT + plotH - 6);
          /* keep the chip inside the plot on a narrow phone screen */
          const lx = Math.max(padL + 2, Math.min(x0 + 4, padL + plotW - lw - 2));
          ctx.fillStyle = 'rgba(251, 249, 242, .94)';
          ctx.fillRect(lx, ly - 14, lw, 15);
          ctx.strokeStyle = color;
          ctx.strokeRect(lx + 0.5, ly - 13.5, lw - 1, 14);
          ctx.fillStyle = color;
          ctx.textAlign = 'left';
          ctx.fillText(label, lx + 6, ly - 6);
          ctx.font = '10px ui-monospace, Menlo, monospace';
        }
        ctx.globalAlpha = 1;
      };
      /* these belong to the detected pattern, not to your fill — label them so */
      line(s.entry, 'rgba(20,18,14,.8)', `SETUP ${fmtPrice(s.entry)}`);
      line(s.stop, 'rgba(194,58,43,.85)', `STOP ${fmtPrice(s.stop)}`);
      line(s.target, 'rgba(28,122,78,.9)', `2R TARGET ${fmtPrice(s.target)}`);
    });

    /* candles */
    const bodyW = Math.max(1.5, Math.min(11, bw * 0.6));
    barsForRange.forEach((b, i) => {
      const up = b.c >= b.o;
      const x = padL + bw * i + bw / 2;
      ctx.strokeStyle = up ? '#1c7a4e' : '#c23a2b';
      ctx.fillStyle = up ? '#1c7a4e' : '#c23a2b';
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, y(b.h));
      ctx.lineTo(Math.round(x) + 0.5, y(b.l));
      ctx.stroke();
      const yo = y(b.o), yc = y(b.c);
      ctx.fillRect(x - bodyW / 2, Math.min(yo, yc), bodyW, Math.max(1, Math.abs(yc - yo)));
    });

    /* ema20 through the window */
    ctx.strokeStyle = 'rgba(44,98,196,.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < barsForRange.length; i++) {
      const gi = start + i;
      if (gi < 20) continue;
      const x = padL + bw * i + bw / 2;
      const yy = y(st.ema20[Math.min(gi, st.ema20.length - 1)]);
      if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
    const emaLast = st.ema20[Math.min(start + barsForRange.length - 1, st.ema20.length - 1)];
    if (Number.isFinite(emaLast)) {
      ctx.fillStyle = 'rgba(44,98,196,.9)';
      ctx.font = '9px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.fillText('EMA20', padL + plotW - 4, Math.min(Math.max(y(emaLast) - 9, padT + 8), padT + plotH - 8));
      ctx.textAlign = 'left';
      ctx.font = '10px ui-monospace, Menlo, monospace';
    }

    /* position: entry line + P&L shading */
    if (st.position) {
      const p = st.position;
      const ye = y(p.entry), yc = y(st.price);
      ctx.fillStyle = st.price >= p.entry ? 'rgba(28,122,78,.07)' : 'rgba(194,58,43,.07)';
      ctx.fillRect(padL, Math.min(ye, yc), plotW, Math.abs(yc - ye));
      ctx.strokeStyle = 'rgba(226,87,58,.95)';
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(padL, ye); ctx.lineTo(padL + plotW, ye); ctx.stroke();
      ctx.setLineDash([]);
      const tag = `${p.dir > 0 ? 'LONG' : 'SHORT'} ${p.lev.toFixed(0)}× @ ${fmtPrice(p.entry)}`;
      ctx.font = '600 10px ui-monospace, Menlo, monospace';
      const tw = ctx.measureText(tag).width + 12;
      ctx.fillStyle = '#141210';
      ctx.fillRect(padL + 4, Math.min(ye, yc) + Math.max(2, Math.abs(yc - ye) / 2) - 8, tw, 16);
      ctx.strokeStyle = 'rgba(226,87,58,.6)';
      ctx.strokeRect(padL + 4.5, Math.min(ye, yc) + Math.max(2, Math.abs(yc - ye) / 2) - 7.5, tw - 1, 15);
      ctx.fillStyle = '#f7f4ea';
      ctx.fillText(tag, padL + 10, Math.min(ye, yc) + Math.max(2, Math.abs(yc - ye) / 2));
      ctx.font = '10px ui-monospace, Menlo, monospace';
    }

    /* live price tag */
    const yl = y(st.price);
    const upBar = st.price >= forming.o;
    ctx.fillStyle = upBar ? '#1c7a4e' : '#c23a2b';
    ctx.fillRect(padL + plotW + 2, yl - 9, padR - 10, 18);
    ctx.fillStyle = '#f7f4ea';
    ctx.font = '600 10.5px ui-monospace, Menlo, monospace';
    ctx.fillText(fmtPrice(st.price), padL + plotW + 8, yl);
    ctx.font = '10px ui-monospace, Menlo, monospace';

    /* time labels along the bottom */
    ctx.fillStyle = '#6c6457';
    const spanBars = barsForRange.length;
    for (let k = 0; k < 4; k++) {
      const gi = start + Math.floor((spanBars - 1) * (k / 3));
      const c = st.candles[Math.min(gi, st.candles.length - 1)];
      const x = padL + bw * Math.floor((spanBars - 1) * (k / 3));
      const d = new Date(c.t * 1000);
      const label = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      ctx.textAlign = k === 0 ? 'left' : k === 3 ? 'right' : 'center';
      ctx.fillText(label, k === 3 ? padL + plotW : x, padT + plotH + 16);
    }
    ctx.textAlign = 'left';
  }

  /* ---------------- input ---------------- */
  function beginHold(pos) {
    if (!st || st.finished) return;
    holdings = { y0: pos.y, flipped: false };
    stage.classList.add('holding');
    open(1);
  }

  function dragTo(pos) {
    if (!holdings || !st || !st.position) return;
    const dy = pos.y - holdings.y0;
    if (st.mode.short && !holdings.flipped && dy > 70) {
      holdings.flipped = true;
      const p = st.position;
      if (p.dir !== -1) { close(true); open(-1); flash('SHORT', 'FLIPPED', 'down', false); }
    }
  }

  function endHold() {
    if (!holdings) return;
    holdings = null;
    stage.classList.remove('holding');
    if (st && st.position) close();
  }

  function bind() {
    stage.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button')) return;
      try { stage.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
      beginHold({ y: ev.clientY });
    });
    stage.addEventListener('pointermove', (ev) => { if (holdings) dragTo({ y: ev.clientY }); });
    stage.addEventListener('pointerup', endHold);
    stage.addEventListener('pointercancel', endHold);
    stage.addEventListener('pointerleave', (ev) => { if (holdings && ev.buttons === 0) endHold(); });

    document.addEventListener('keydown', (ev) => {
      if (!el('srRoot')) return;
      if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
      if (ev.code === 'Space' && !ev.repeat) { ev.preventDefault(); beginHold({ y: 0 }); }
      if (ev.key === 'ArrowDown' && holdings) { ev.preventDefault(); if (st.mode.short) { close(true); open(-1); } }
      if (ev.key === 'r') reset();
    });
    document.addEventListener('keyup', (ev) => { if (ev.code === 'Space') { ev.preventDefault(); endHold(); } });

    el('srRestart').addEventListener('click', () => { reset(); toast('Fresh window.'); });
    el('srAgain').addEventListener('click', () => { reset(); });
    el('srClose').addEventListener('click', () => { el('srOver').hidden = true; });
    el('srMarket').addEventListener('change', (ev) => { reset(st.mode.key, ev.target.value); });
    document.querySelectorAll('#srSpeeds button').forEach((b) =>
      b.addEventListener('click', () => {
        st.speed = Number(b.dataset.speed);
        document.querySelectorAll('#srSpeeds button').forEach((x) => x.classList.toggle('on', x === b));
      }));
    window.addEventListener('resize', resize);
    if ('ResizeObserver' in window) new ResizeObserver(() => resize()).observe(stage);
  }

  /* ---------------- loop ---------------- */
  function loop(now) {
    if (!st || st.finished) { raf = null; return; }
    const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    if (!document.hidden) step(dt);
    raf = requestAnimationFrame(loop);
  }
  function startLoop() {
    if (raf) return;
    lastFrame = 0;
    raf = requestAnimationFrame(loop);
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  /* ---------------- public ---------------- */
  async function mount() {
    if (mounted) return;
    mounted = true;
    bind();
    try {
      await loadMarkets();
      const syms = Object.keys(DATA).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
      el('srMarket').innerHTML = syms.map((s) => `<option value="${s}">${s.replace('-', '/')}</option>`).join('');
      reset('pro', 'BTC-USD');
    } catch (err) {
      el('srOver').hidden = false;
      el('srOverTitle').textContent = 'NO TAPE';
      el('srOverPnl').textContent = '—';
      el('srOverMode').textContent = String(err.message || err);
    }
  }

  window.__rush = {
    get state() { return st; },
    mount,
    reset,
    step: (secs) => { for (let t = 0; t < secs; t += 0.05) step(0.05); },
    beginHold: () => { beginHold({ y: 0 }); },
    flip: () => { if (st && st.mode.short && st.position && st.position.dir === 1) { close(true); open(-1); } },
    release: () => endHold(),
    price: () => (st ? st.price : 0),
    equity: () => (st ? st.equity : 0),
    score: () => (st ? score() : null)
  };

  return {
    mount,
    show() { mount().then(() => { resize(); startLoop(); renderAll(); }); },
    hide() { stopLoop(); if (st && st.position) close(true); },
    /* launched from the dashboard with a chosen mode */
    startWith(modeKey) {
      mount().then(() => {
        reset(modeKey, st ? st.sym : 'BTC-USD');
        resize();
        startLoop();
        renderAll();
      });
    },
    renderHubBest
  };
}
