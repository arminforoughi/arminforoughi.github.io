// Lossless codec for the terrain grids (written by tools/pack_dem.mjs, read in the workers).
//
// The grid is cut into horizontal bands that decode independently, so several threads can share the
// work. Within a band each height is predicted from its neighbours (left + above - above-left; along
// the band's first row from the left, and the first sample is stored as is). The prediction residuals
// are entropy-coded with rANS, using one frequency table per context. The context is how large the
// residuals just above were (above-left, above, above-right), so flat ground and rough crater walls each
// get their own statistics. Because the context never depends on the row being decoded, four rANS
// streams are interleaved (column j uses stream j mod 4), which lets the CPU decode four symbols at
// once. About 30% smaller than the earlier gzip packing; the heights come back bit for bit.
//
// File layout (little-endian):
//   u32 magic 'LDM4', u32 n (grid is n x n int16), u32 nBands
//   per band: u32 firstRow, u32 rows, u32 nEsc, u32 ransLen
//   u16 freq[NCTX][NSYM]          normalised to 2^PROB_BITS per used context (shared by all bands)
//   per band: i16 esc[nEsc]       residuals too large for the symbol alphabet, in order
//   per band: u8 rans[ransLen]    LANES initial states (4 bytes each, big-endian), then the byte stream

export const MAGIC = 0x344d444c;   // 'LDM4'
export const LANES = 4;
export const PROB_BITS = 14;
export const PROB_SCALE = 1 << PROB_BITS;
export const RANS_L = 1 << 23;
export const MAX_ABS = 255;                       // |residual| <= MAX_ABS is coded directly
export const ESC = 2 * MAX_ABS + 1;               // escape symbol
export const NSYM = ESC + 1;
export const EDGE_CTX = 16;                       // a band's first row, and the first column
export const NCTX = 17;
const ESC_MARK = -32768;                          // decoder table value for the escape symbol
const CAP = 1024;                                 // |residual| cap for contexts (they saturate long before)

// Context from the summed magnitudes of the three residuals above: 0..15 on a half-octave scale.
export const CTX_OF_ACT = new Uint8Array(3 * CAP + 1);
for (let a = 0; a <= 3 * CAP; a++) CTX_OF_ACT[a] = Math.min(15, Math.floor(2 * Math.log2(a + 1)));
export const capAbs = r => { const a = r < 0 ? -r : r; return a > CAP ? CAP : a; };

// Contexts of a row from the capped |residuals| of the row above.
export function rowContexts(absUp, ctx, n) {
  ctx[0] = EDGE_CTX;
  for (let j = 1; j < n - 1; j++) ctx[j] = CTX_OF_ACT[absUp[j - 1] + absUp[j] + absUp[j + 1]];
  ctx[n - 1] = CTX_OF_ACT[absUp[n - 2] + absUp[n - 1]];
}

export const zig = r => (r >= 0 ? 2 * r : -2 * r - 1);
export const unzig = s => ((s & 1) ? -((s + 1) >> 1) : s >> 1);

// Reads the header: grid size, band directory (with byte offsets) and where the tables are.
export function parseLdm(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || dv.getUint32(0, true) !== MAGIC) throw new Error('Terrain file is not in the expected format');
  const n = dv.getUint32(4, true), nBands = dv.getUint32(8, true);
  let o = 12;
  const bands = [];
  for (let b = 0; b < nBands; b++, o += 16) {
    bands.push({ index: b, firstRow: dv.getUint32(o, true), rows: dv.getUint32(o + 4, true), nEsc: dv.getUint32(o + 8, true), ransLen: dv.getUint32(o + 12, true) });
  }
  const tablesAt = o;
  o += NCTX * NSYM * 2;
  for (const b of bands) { b.escAt = o; o += 2 * b.nEsc; }
  for (const b of bands) { b.ransAt = o; o += b.ransLen; }
  if (o !== bytes.byteLength) throw new Error(`Terrain file is truncated (${bytes.byteLength} bytes)`);
  let rows = 0;
  for (const b of bands) { if (b.firstRow !== rows) throw new Error('Terrain file has a bad band directory'); rows += b.rows; }
  if (rows !== n) throw new Error('Terrain file has a bad band directory');
  return { n, bands, tablesAt };
}

// Decoder tables, per context and slot: the step packed as (freq << PROB_BITS | slot - cum), and the
// residual the slot stands for (ESC_MARK for an escape), so each symbol costs two table reads.
export function decoderTables(bytes, info) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const step = new Uint32Array(NCTX * PROB_SCALE), resid = new Int16Array(NCTX * PROB_SCALE);
  let o = info.tablesAt;
  for (let c = 0; c < NCTX; c++) {
    let acc = 0;
    for (let s = 0; s < NSYM; s++) {
      const f = dv.getUint16(o, true); o += 2;
      if (!f) continue;
      if (acc + f > PROB_SCALE) throw new Error('Terrain file has a bad frequency table');
      const r = s === ESC ? ESC_MARK : unzig(s), base = c * PROB_SCALE + acc;
      for (let t = 0; t < f; t++) { step[base + t] = (f << PROB_BITS) | t; resid[base + t] = r; }
      acc += f;
    }
    if (acc !== 0 && acc !== PROB_SCALE) throw new Error('Terrain file has a bad frequency table');
  }
  return { step, resid };
}

// Decodes one band into out (Int16Array of the whole grid, or of just this band when outRow0 = firstRow).
export function decodeBand(bytes, info, tables, band, out, outRow0 = 0) {
  const { n } = info, { step, resid } = tables;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const esc = new Int16Array(band.nEsc);
  for (let e = 0; e < band.nEsc; e++) esc[e] = dv.getInt16(band.escAt + 2 * e, true);
  const buf = bytes.subarray(band.ransAt, band.ransAt + band.ransLen);

  const rd = p => ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0;
  let x0 = rd(0), x1 = rd(4), x2 = rd(8), x3 = rd(12), q = 16, e = 0;
  const MASK = PROB_SCALE - 1, n4 = n - (n % 4);
  // One symbol on stream x (for the leftover columns at the end of a row): returns [x, residual].
  const one = (x, c) => {
    const idx = (c << PROB_BITS) | (x & MASK), st = step[idx];
    x = (st >>> PROB_BITS) * (x >>> PROB_BITS) + (st & MASK);
    if (x < RANS_L) { x = ((x << 8) | buf[q++]) >>> 0; if (x < RANS_L) x = ((x << 8) | buf[q++]) >>> 0; }
    const r = resid[idx];
    return [x, r === ESC_MARK ? esc[e++] : r];
  };
  const h = out, base0 = (band.firstRow - outRow0) * n;
  const ctx = new Uint8Array(n).fill(EDGE_CTX), res = new Int32Array(n), absUp = new Uint16Array(n);
  for (let i = 0; i < band.rows; i++) {
    // 1. Residuals of the row: four interleaved streams, one step each per iteration.
    for (let j = 0; j < n4; j += 4) {
      const i0 = (ctx[j] << PROB_BITS) | (x0 & MASK), i1 = (ctx[j + 1] << PROB_BITS) | (x1 & MASK);
      const i2 = (ctx[j + 2] << PROB_BITS) | (x2 & MASK), i3 = (ctx[j + 3] << PROB_BITS) | (x3 & MASK);
      const s0 = step[i0], s1 = step[i1], s2 = step[i2], s3 = step[i3];
      x0 = (s0 >>> PROB_BITS) * (x0 >>> PROB_BITS) + (s0 & MASK);
      x1 = (s1 >>> PROB_BITS) * (x1 >>> PROB_BITS) + (s1 & MASK);
      x2 = (s2 >>> PROB_BITS) * (x2 >>> PROB_BITS) + (s2 & MASK);
      x3 = (s3 >>> PROB_BITS) * (x3 >>> PROB_BITS) + (s3 & MASK);
      // Refill in stream order (the encoder wrote the bytes in exactly the reverse order).
      if (x0 < RANS_L) { x0 = ((x0 << 8) | buf[q++]) >>> 0; if (x0 < RANS_L) x0 = ((x0 << 8) | buf[q++]) >>> 0; }
      if (x1 < RANS_L) { x1 = ((x1 << 8) | buf[q++]) >>> 0; if (x1 < RANS_L) x1 = ((x1 << 8) | buf[q++]) >>> 0; }
      if (x2 < RANS_L) { x2 = ((x2 << 8) | buf[q++]) >>> 0; if (x2 < RANS_L) x2 = ((x2 << 8) | buf[q++]) >>> 0; }
      if (x3 < RANS_L) { x3 = ((x3 << 8) | buf[q++]) >>> 0; if (x3 < RANS_L) x3 = ((x3 << 8) | buf[q++]) >>> 0; }
      let r;
      r = resid[i0]; res[j] = r === ESC_MARK ? esc[e++] : r;
      r = resid[i1]; res[j + 1] = r === ESC_MARK ? esc[e++] : r;
      r = resid[i2]; res[j + 2] = r === ESC_MARK ? esc[e++] : r;
      r = resid[i3]; res[j + 3] = r === ESC_MARK ? esc[e++] : r;
    }
    if (n4 < n) { const t = one(x0, ctx[n4]); x0 = t[0]; res[n4] = t[1]; }
    if (n4 + 1 < n) { const t = one(x1, ctx[n4 + 1]); x1 = t[0]; res[n4 + 1] = t[1]; }
    if (n4 + 2 < n) { const t = one(x2, ctx[n4 + 2]); x2 = t[0]; res[n4 + 2] = t[1]; }
    // 2. Heights from the residuals, and the next row's contexts.
    const row = base0 + i * n;
    if (i === 0) {
      let v = 0;
      for (let j = 0; j < n; j++) { v += res[j]; h[row + j] = v; }
    } else {
      let hl = h[row - n] + res[0], hul = h[row - n];
      h[row] = hl;
      for (let j = 1; j < n; j++) {
        const hu = h[row - n + j];
        hl = hl + hu - hul + res[j];
        h[row + j] = hl;
        hul = hu;
      }
    }
    for (let j = 0; j < n; j++) { const r = res[j], a = r < 0 ? -r : r; absUp[j] = a > CAP ? CAP : a; }
    rowContexts(absUp, ctx, n);
  }
  if (e !== band.nEsc || q !== band.ransLen) throw new Error('Terrain file did not decode cleanly');
  return out;
}

// Whole grid on one thread. bytes: Uint8Array of the whole file. Returns { n, h: Int16Array(n*n) }.
export function decodeLdm(bytes) {
  const info = parseLdm(bytes), tables = decoderTables(bytes, info);
  const h = new Int16Array(info.n * info.n);
  for (const band of info.bands) decodeBand(bytes, info, tables, band, h);
  return { n: info.n, h };
}
