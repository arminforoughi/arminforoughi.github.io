// Helper worker started by the page (several run in parallel). It decodes bands of the terrain file
// when the app loads, then holds its own copy of the grid and traces horizons on request.
import { Dem, computeHorizon } from './terrain.js';
import { parseLdm, decoderTables, decodeBand } from './demcodec.js';

let dem = null, file = null, info = null, tables = null;
self.onmessage = ({ data: m }) => {
  if (m.type === 'file') { file = m.bytes; info = parseLdm(file); tables = decoderTables(file, info); return; }
  if (m.type === 'dem') { dem = new Dem(m.h, m.meta); file = info = tables = null; return; }
  try {
    if (m.type === 'band') {
      const band = info.bands[m.band];
      const out = new Int16Array(band.rows * info.n);
      decodeBand(file, info, tables, band, out, band.firstRow);
      self.postMessage({ id: m.id, result: { h: out } }, [out.buffer]);
    } else if (m.type === 'horizon') {
      const r = computeHorizon(dem, m.x, m.y, m.mast);
      self.postMessage({ id: m.id, result: r }, [r.hz.buffer]);
    }
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err && err.message || err) });
  }
};
