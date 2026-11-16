// 2D canvas charts: the 360° sky view from a site, and the site deck's shared time axis and strips.
import { horizonAt } from './terrain.js';

const C = {
  sun: '#f5b942', earth: '#6fb1ff', score: '134,214,160',
  grid: 'rgba(236,235,230,0.07)', gridStrong: 'rgba(236,235,230,0.16)',
  axis: '#6f6e6a', text: '#a9a8a2', ink: '#ecebe6',
};
const MONO = '10.5px "IBM Plex Mono", ui-monospace, monospace';
const SANS = '600 10.5px "Instrument Sans", system-ui, sans-serif';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fit(canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// ---------------- Sky view ----------------
// The horizon all the way round a site, with the Sun's and Earth's paths over the window and where they are now.
export class Panorama {
  constructor(canvas, tip) {
    this.canvas = canvas; this.tip = tip; this.data = null;
    canvas.addEventListener('pointermove', e => this._hover(e));
    canvas.addEventListener('pointerleave', () => { tip.hidden = true; this.hoverX = null; this.draw(); });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }
  set(data) { this.data = data; this.draw(); }

  _layout(w, h) {
    const d = this.data;
    let lo = Infinity, hi = -Infinity;
    for (const v of d.hz) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    let pathHi = -Infinity;
    if (d.series) {
      const s = d.series;
      for (let i = 0; i < s.sunEl.length; i++) pathHi = Math.max(pathHi, s.sunEl[i], s.earthEl[i]);
    }
    lo = Math.min(lo, -1) - 0.8;
    hi = Math.max(hi, pathHi, 1) + 1.2;
    const L = 40, R = 8, T = 6, B = 20, c0 = (d.centerAz ?? 180) - 180;
    const wrap = a => ((a - c0) % 360 + 360) % 360;
    return { lo, hi, L, R, T, B, pw: w - L - R, ph: h - T - B, c0,
      x: az => L + wrap(az) / 360 * (w - L - R), y: el => T + (hi - el) / (hi - lo) * (h - T - B) };
  }

  draw() {
    const { ctx, w, h } = fit(this.canvas);
    ctx.clearRect(0, 0, w, h);
    if (!this.data || w < 50) return;
    const d = this.data, lay = this._layout(w, h), { x, y, L, T, pw, ph, lo, hi } = lay;
    this.lay = lay;
    ctx.fillStyle = '#050506'; ctx.fillRect(L, T, pw, ph);
    // elevation grid
    const span = hi - lo, stepEl = span > 90 ? 15 : span > 45 ? 10 : span > 24 ? 5 : span > 12 ? 2 : 1;
    ctx.font = MONO; ctx.textBaseline = 'middle'; ctx.textAlign = 'right'; ctx.lineWidth = 1;
    for (let e = Math.ceil(lo / stepEl) * stepEl; e <= hi; e += stepEl) {
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(L, Math.round(y(e)) + .5); ctx.lineTo(L + pw, Math.round(y(e)) + .5); ctx.stroke();
      ctx.fillStyle = C.axis; ctx.fillText(`${e}°`, L - 6, y(e));
    }
    // azimuth grid
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    const ax = a => L + (a - lay.c0) / 360 * pw;          // unwrapped position for tick placement
    for (let a = Math.ceil(lay.c0 / 30) * 30; a <= lay.c0 + 360; a += 30) {
      const an = ((a % 360) + 360) % 360, px = Math.round(ax(a)) + .5, cardinal = names[an] !== undefined;
      ctx.strokeStyle = cardinal ? C.gridStrong : C.grid;
      ctx.beginPath(); ctx.moveTo(px, T); ctx.lineTo(px, T + ph); ctx.stroke();
      if (!cardinal && pw < 520) continue;                 // narrow charts: cardinal labels only
      ctx.fillStyle = cardinal ? C.ink : C.axis;
      ctx.font = cardinal ? SANS : MONO;
      ctx.fillText(names[an] || `${an}°`, Math.min(Math.max(px, L + 8), L + pw - 8), T + ph + 5);
    }
    // local level
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(236,235,230,0.35)';
    ctx.beginPath(); ctx.moveTo(L, Math.round(y(0)) + .5); ctx.lineTo(L + pw, Math.round(y(0)) + .5); ctx.stroke(); ctx.setLineDash([]);

    // Sun and Earth paths over the window (drawn before the terrain so the terrain hides what is below it)
    if (d.series) {
      const s = d.series, n = s.sunAz.length, stride = Math.max(1, Math.floor(n / 9000));
      for (let i = 0; i < n; i += stride) {
        ctx.fillStyle = s.earthVis[i] ? 'rgba(111,177,255,0.6)' : 'rgba(111,177,255,0.16)';
        ctx.fillRect(x(s.earthAz[i]) - 0.75, y(s.earthEl[i]) - 0.75, 1.5, 1.5);
      }
      for (let i = 0; i < n; i += stride) {
        ctx.fillStyle = s.sunFrac[i] >= 0.5 ? 'rgba(245,185,66,0.6)' : 'rgba(245,185,66,0.16)';
        ctx.fillRect(x(s.sunAz[i]) - 0.75, y(s.sunEl[i]) - 0.75, 1.5, 1.5);
      }
    }
    // terrain silhouette
    const hzY = px => y(horizonAt(d.hz, (lay.c0 + px / pw * 360 + 720) % 360));
    const tg = ctx.createLinearGradient(0, y(hi), 0, T + ph);
    tg.addColorStop(0, '#8b8983'); tg.addColorStop(0.4, '#45443f'); tg.addColorStop(1, '#161615');
    ctx.beginPath(); ctx.moveTo(L, T + ph);
    for (let px = 0; px <= pw; px++) ctx.lineTo(L + px, hzY(px));
    ctx.lineTo(L + pw, T + ph); ctx.closePath();
    ctx.globalAlpha = 0.94; ctx.fillStyle = tg; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let px = 0; px <= pw; px++) px ? ctx.lineTo(L + px, hzY(px)) : ctx.moveTo(L, hzY(0));
    ctx.strokeStyle = '#d9d7cf'; ctx.lineWidth = 1.1; ctx.stroke();

    // the Sun and Earth now, at true angular size
    const pxPerDeg = ph / (hi - lo);
    const body = (az, el, rDeg, color, visible, glow) => {
      const cx = x(az), cy = y(el), r = Math.max(3.5, rDeg * pxPerDeg);
      if (cy - r > T + ph + 2 || cy + r < T - 2) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
      if (glow && visible) {
        const g = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 4.5);
        g.addColorStop(0, 'rgba(245,185,66,0.45)'); g.addColorStop(1, 'rgba(245,185,66,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 4.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.globalAlpha = visible ? 1 : 0.35; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5; ctx.strokeStyle = visible ? '#fff' : color; ctx.setLineDash(visible ? [] : [3, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    };
    if (d.now) {
      body(d.now.earthAz, d.now.earthEl, d.now.earthR, C.earth, d.now.earthVis, false);
      body(d.now.sunAz, d.now.sunEl, d.now.sunR, C.sun, d.now.sunFrac > 0, true);
    }
    if (this.hoverX != null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.hoverX + .5, T); ctx.lineTo(this.hoverX + .5, T + ph); ctx.stroke();
    }
  }

  _hover(e) {
    if (!this.data || !this.lay) return;
    const r = this.canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const { L, T, pw, ph, lo, hi } = this.lay;
    if (mx < L || mx > L + pw || my < T || my > T + ph) { this.tip.hidden = true; this.hoverX = null; this.draw(); return; }
    const az = ((this.lay.c0 + (mx - L) / pw * 360) % 360 + 360) % 360, el = hi - (my - T) / ph * (hi - lo);
    const hz = horizonAt(this.data.hz, az);
    this.hoverX = mx; this.draw();
    this.tip.hidden = false;
    this.tip.innerHTML = `az ${az.toFixed(1)}° · el ${el.toFixed(2)}°<br>horizon ${hz.toFixed(2)}° ${el > hz ? '<span class="ok">clear sky</span>' : '<span class="no">blocked</span>'}`;
    const tw = this.tip.offsetWidth;
    this.tip.style.left = `${Math.min(mx + 12, r.width - tw - 6)}px`;
    this.tip.style.top = `${Math.max(4, my - 44)}px`;
  }
}

// ---------------- Site deck ----------------
// One row per site on a shared time axis. Sample i of the ephemeris occupies the slice [i/n, (i+1)/n) of the
// width, so every band, marker and the cursor use the same scale.
//   mode 'bands': a sunlit band and an Earth-in-view band per row
//   mode 'score': one band per row, brighter where landing then gives a better mission
// Rows: { id, name, a, selected, score: { values, count, best } | null }.
export class DeckChart {
  constructor(axisCanvas, stripCanvas, tip, onScrub, onPick) {
    this.axis = axisCanvas; this.canvas = stripCanvas; this.tip = tip; this.onScrub = onScrub; this.onPick = onPick;
    this.rows = []; this.eph = null; this.time = 0; this.mission = 0; this.mode = 'bands'; this.scoreLabel = '';
    this.ROW = 34;
    for (const cv of [axisCanvas, stripCanvas]) {
      let dragging = false;
      cv.addEventListener('pointerdown', e => {
        if (!this.eph) return;
        if (cv === stripCanvas && this._pickBest(e)) return;
        dragging = true;
        try { cv.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        this._scrub(e, cv);
      });
      cv.addEventListener('pointermove', e => { if (dragging) this._scrub(e, cv); if (cv === stripCanvas) this._hover(e); });
      const stop = e => { if (!dragging) return; dragging = false; try { cv.releasePointerCapture(e.pointerId); } catch { /* not captured */ } };
      cv.addEventListener('pointerup', stop); cv.addEventListener('pointercancel', stop);
      new ResizeObserver(() => this.draw()).observe(cv);
    }
    stripCanvas.addEventListener('pointerleave', () => { this.tip.hidden = true; });
  }
  set(eph, rows) {
    this.eph = eph; this.rows = rows;
    this.canvas.style.height = `${Math.max(1, rows.length) * this.ROW}px`;
    this.draw();
  }
  setTime(t) { this.time = t; this.draw(); }
  setMission(ms) { this.mission = ms; this.draw(); }
  setMode(mode, scoreLabel) { this.mode = mode; this.scoreLabel = scoreLabel; this.draw(); }

  _span() { return this.eph.n * this.eph.stepMs; }
  _x(t, w) { return (t - this.eph.startMs) / this._span() * w; }
  _t(px, w) { return this.eph.startMs + Math.max(0, Math.min(1, px / w)) * this._span(); }

  _ticks() {
    const e = this.eph, end = e.startMs + this._span(), spanDays = this._span() / 864e5, d0 = new Date(e.startMs), ticks = [];
    if (spanDays > 150) {
      for (let m = d0.getUTCMonth() + 1; ; m++) {
        const t = Date.UTC(d0.getUTCFullYear(), m, 1); if (t > end) break;
        const dd = new Date(t), jan = dd.getUTCMonth() === 0;
        ticks.push([t, jan ? `${dd.getUTCFullYear()}` : MON[dd.getUTCMonth()], jan]);
      }
    } else {
      const step = spanDays > 45 ? 7 : 2;
      for (let t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() + 1); t <= end; t += step * 864e5) {
        const dd = new Date(t); ticks.push([t, `${dd.getUTCDate()} ${MON[dd.getUTCMonth()]}`, false]);
      }
    }
    return ticks;
  }

  draw() {
    const A = fit(this.axis), S = fit(this.canvas);
    A.ctx.clearRect(0, 0, A.w, A.h); S.ctx.clearRect(0, 0, S.w, S.h);
    if (!this.eph || S.w < 40) return;
    const e = this.eph, n = e.n, ROW = this.ROW, w = S.w, ticks = this._ticks();
    // axis: date labels and tick marks
    let ctx = A.ctx;
    ctx.font = MONO; ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
    let lastEnd = -Infinity;
    for (const [t, label, major] of ticks) {
      const px = Math.round(this._x(t, w)) + .5;
      ctx.strokeStyle = major ? 'rgba(236,235,230,0.4)' : C.gridStrong;
      ctx.beginPath(); ctx.moveTo(px, A.h - 5); ctx.lineTo(px, A.h); ctx.stroke();
      const tw = ctx.measureText(label).width;
      if (px + 4 > lastEnd + 8 && px + 4 + tw < w) { ctx.fillStyle = major ? C.ink : C.axis; ctx.fillText(label, px + 4, A.h / 2 - 1); lastEnd = px + 4 + tw; }
    }
    const cx = Math.round(this._x(this.time, w)) + .5;
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(cx - 5, A.h - 7); ctx.lineTo(cx + 5, A.h - 7); ctx.lineTo(cx, A.h); ctx.closePath(); ctx.fill();

    // rows
    ctx = S.ctx; ctx.lineWidth = 1;
    this.rows.forEach((row, r) => {
      const y0 = r * ROW;
      if (row.selected) { ctx.fillStyle = 'rgba(236,235,230,0.055)'; ctx.fillRect(0, y0, w, ROW); }
      ctx.fillStyle = 'rgba(236,235,230,0.07)'; ctx.fillRect(0, y0 + ROW - 1, w, 1);
      const s = row.a;
      if (this.mode === 'score') {
        const sc = row.score, by = y0 + 8, bh = ROW - 17;
        ctx.fillStyle = 'rgba(236,235,230,0.04)'; ctx.fillRect(0, by, w, bh);
        if (sc) {
          for (let px = 0; px < w; px++) {
            const i0 = Math.floor(px / w * n), i1 = Math.max(i0 + 1, Math.floor((px + 1) / w * n));
            let v = 0, k = 0;
            for (let i = i0; i < i1 && i < sc.count; i++) { v += sc.values[i]; k++; }
            if (!k) continue;
            v /= k;
            ctx.fillStyle = `rgba(${C.score},${(0.05 + 0.95 * v * v).toFixed(3)})`; ctx.fillRect(px, by, 1, bh);
          }
          const xEnd = Math.ceil(sc.count / n * w);      // landings past here would overrun the window
          if (xEnd < w) {
            ctx.save(); ctx.beginPath(); ctx.rect(xEnd, by, w - xEnd, bh); ctx.clip();
            ctx.strokeStyle = 'rgba(236,235,230,0.2)'; ctx.beginPath();
            for (let x = xEnd - bh; x < w; x += 5) { ctx.moveTo(x, by + bh); ctx.lineTo(x + bh, by); }
            ctx.stroke(); ctx.restore();
          }
        }
      } else {
        const bh = 8, ys = y0 + 7, ye = y0 + 19;
        ctx.fillStyle = 'rgba(236,235,230,0.04)'; ctx.fillRect(0, ys, w, bh); ctx.fillRect(0, ye, w, bh);
        for (let px = 0; px < w; px++) {
          const i0 = Math.floor(px / w * n), i1 = Math.max(i0 + 1, Math.floor((px + 1) / w * n));
          let lit = 0, com = 0, k = 0;
          for (let i = i0; i < i1 && i < n; i++) { lit += s.sunFrac[i] >= 0.5; com += s.earthVis[i]; k++; }
          if (!k) continue;
          if (lit) { ctx.fillStyle = `rgba(245,185,66,${0.15 + 0.85 * lit / k})`; ctx.fillRect(px, ys, 1, bh); }
          if (com) { ctx.fillStyle = `rgba(111,177,255,${0.15 + 0.85 * com / k})`; ctx.fillRect(px, ye, 1, bh); }
        }
      }
      // best landing time for this site
      if (row.score && row.score.best >= 0) {
        const bx = Math.round((row.score.best + 0.5) / n * w);
        ctx.fillStyle = '#fff'; ctx.fillRect(bx - 0.5, y0 + 3, 1, ROW - 7);
        ctx.beginPath(); ctx.moveTo(bx - 4.5, y0 + 2); ctx.lineTo(bx + 4.5, y0 + 2); ctx.lineTo(bx, y0 + 8); ctx.closePath(); ctx.fill();
      }
    });
    const hAll = Math.max(1, this.rows.length) * ROW;
    // month lines over the rows
    for (const [t, , major] of ticks) {
      const px = Math.round(this._x(t, w)) + .5;
      ctx.strokeStyle = major ? 'rgba(236,235,230,0.22)' : 'rgba(236,235,230,0.06)';
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, hAll); ctx.stroke();
    }
    // mission window: from the scene time to the end of the surface mission
    if (this.mission > 0) {
      const x0 = this._x(this.time, w), x1 = Math.min(w, this._x(this.time + this.mission, w));
      ctx.fillStyle = 'rgba(236,235,230,0.10)'; ctx.fillRect(x0, 0, x1 - x0, hAll);
      ctx.strokeStyle = 'rgba(236,235,230,0.6)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(x1) + .5, 0); ctx.lineTo(Math.round(x1) + .5, hAll); ctx.stroke(); ctx.setLineDash([]);
    }
    // cursor
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, hAll); ctx.stroke(); ctx.lineWidth = 1;
  }

  _row(ev) {
    const r = this.canvas.getBoundingClientRect();
    return { r, mx: ev.clientX - r.left, my: ev.clientY - r.top, row: this.rows[Math.floor((ev.clientY - r.top) / this.ROW)] };
  }
  // A press on a row's best-landing marker jumps there instead of scrubbing.
  _pickBest(ev) {
    const { r, mx, row } = this._row(ev);
    if (!row || !row.score || row.score.best < 0) return false;
    const bx = (row.score.best + 0.5) / this.eph.n * r.width;
    if (Math.abs(mx - bx) > 6) return false;
    this.onPick(row.id, this.eph.startMs + row.score.best * this.eph.stepMs);
    return true;
  }
  _scrub(ev, cv) {
    const r = cv.getBoundingClientRect();
    this.onScrub(this._t(ev.clientX - r.left, r.width));
  }
  _hover(ev) {
    if (!this.eph) return;
    const { r, mx, my, row } = this._row(ev);
    if (!row) { this.tip.hidden = true; return; }
    const e = this.eph, a = row.a;
    const i = Math.max(0, Math.min(e.n - 1, Math.floor(mx / r.width * e.n)));
    const ts = new Date(e.startMs + i * e.stepMs).toISOString().slice(0, 16).replace('T', ' ');
    let html = `<b>${row.name}</b> · ${ts} UTC<br><span class="sun">Sun ${(a.sunFrac[i] * 100).toFixed(0)}% of disc</span> · <span class="earth">Earth ${a.earthVis[i] ? 'in view' : 'hidden'}</span>`;
    if (row.score) html += `<br>${i < row.score.count ? `Land then: <span class="score">${(row.score.values[i] * 100).toFixed(0)}%</span> ${this.scoreLabel}` : 'A landing then would run past the window'}`;
    this.tip.hidden = false;
    this.tip.innerHTML = html;
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight, ri = Math.floor(my / this.ROW);
    this.tip.style.left = `${Math.max(0, Math.min(mx + 12, r.width - tw - 4))}px`;
    // above the row, or below it for the first rows where there is no room above
    this.tip.style.top = `${ri * this.ROW - th - 4 < 0 && ri < 2 ? (ri + 1) * this.ROW + 4 : ri * this.ROW - th - 4}px`;
  }
}
