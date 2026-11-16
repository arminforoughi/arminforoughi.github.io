// 3D view of the LOLA south-polar terrain, lit by the true Sun with cast shadows.
// World units are km. The terrain is built on the real (curved) lunar sphere in a frame where the
// south pole surface point is the origin and "up" at the pole is +Y:
//   world = (-bf.y, -bf.z - R, bf.x)   (bf = Moon body-fixed, km)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const R_KM = 1737.4;

export function mapToWorld(x, y, h, out = new THREE.Vector3(), R = 1737400) {
  const rho2 = x * x + y * y, k = 4 * R * R, d = rho2 + k;
  const ux = 4 * R * y / d, uy = 4 * R * x / d, uz = (rho2 - k) / d;
  const r = (R + h) / 1000;
  return out.set(-uy * r, -uz * r - R_KM, ux * r);
}
export function bfToWorldDir(v) { return new THREE.Vector3(-v[1], -v[2], v[0]).normalize(); }
export function worldToBF(p) { return [p.z, -p.x, -(p.y + R_KM)]; }

const ELEV_STOPS = [ // elevation colour ramp (m): deep blue-violet -> teal -> sand -> white
  [-6000, [0.13, 0.10, 0.32]], [-3000, [0.16, 0.29, 0.55]], [-1000, [0.20, 0.53, 0.62]],
  [500, [0.45, 0.68, 0.50]], [2000, [0.86, 0.78, 0.48]], [4000, [0.82, 0.50, 0.32]], [6500, [0.97, 0.95, 0.93]],
];
function elevColor(h, out) {
  if (h <= ELEV_STOPS[0][0]) return out.set(...ELEV_STOPS[0][1]);
  for (let i = 1; i < ELEV_STOPS.length; i++) {
    const [h1, c1] = ELEV_STOPS[i];
    if (h <= h1) {
      const [h0, c0] = ELEV_STOPS[i - 1], t = (h - h0) / (h1 - h0);
      return out.setRGB(c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t);
    }
  }
  return out.set(...ELEV_STOPS[ELEV_STOPS.length - 1][1]);
}

export class TerrainScene {
  constructor(container, labelLayer) {
    this.container = container;
    this.labelLayer = labelLayer;
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020308);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 30000);
    this.camera.position.set(-120, 210, 300);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 1400;
    this.controls.target.set(0, 0, 0);

    this.sun = new THREE.DirectionalLight(0xfff6e8, 3.2);
    this.sun.castShadow = true;
    const ms = Math.min(4096, renderer.capabilities.maxTextureSize);
    this.sun.shadow.mapSize.set(ms, ms);
    this.sun.shadow.bias = -0.00008;
    this.sun.shadow.normalBias = 0.12;
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.HemisphereLight(0x8fa6d8, 0x000000, 0.05);
    this.scene.add(this.fill);

    this.sky = new THREE.Group();
    this.scene.add(this.sky);
    this._buildStars();
    this._buildSunEarth();

    this.markers = new Map();
    this.labels = new Map();
    this.raycaster = new THREE.Raycaster();
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.earthDir = new THREE.Vector3(0, 1, 0);
    this._anim = null;
    this.onResize();
    new ResizeObserver(() => this.onResize()).observe(container);
    renderer.setAnimationLoop(() => this._frame());
  }

  onResize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- terrain ----------
  buildTerrain(meta, mesh, detail) {
    this.meta = meta; this.mesh = mesh;
    const { m, f, g } = mesh;
    const scale = meta.scale, off = meta.offset;
    const pos = new Float32Array(m * m * 3), uv = new Float32Array(m * m * 2), col = new Float32Array(m * m * 3);
    const v = new THREE.Vector3(), c = new THREE.Color();
    const md = detail.m, fd = detail.f;
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
      const k = i * m + j;
      const x = (j * f + (f - 1) / 2 - off) * scale, y = (off - (i * f + (f - 1) / 2)) * scale;
      mapToWorld(x, y, g[k], v);
      pos.set([v.x, v.y, v.z], 3 * k);
      uv[2 * k] = ((x / scale + off - (fd - 1) / 2) / fd + 0.5) / md;
      uv[2 * k + 1] = ((off - y / scale - (fd - 1) / 2) / fd + 0.5) / md;
      elevColor(g[k], c); col.set([c.r, c.g, c.b], 3 * k);
    }
    const idx = new Uint32Array((m - 1) * (m - 1) * 6);
    let p = 0;
    for (let i = 0; i < m - 1; i++) for (let j = 0; j < m - 1; j++) {
      const a = i * m + j, b = a + 1, cc = a + m, d = cc + 1;
      idx[p++] = a; idx[p++] = cc; idx[p++] = b; idx[p++] = b; idx[p++] = cc; idx[p++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    // Fix triangle winding so normals point up (+Y at the pole).
    const nrm = geo.attributes.normal;
    if (nrm.getY(Math.floor(m * m / 2 + m / 2)) < 0) {
      for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; }
      geo.index.needsUpdate = true; geo.computeVertexNormals();
    }

    this.normalTex = this._normalMap(meta, detail);
    this.material = new THREE.MeshStandardMaterial({
      color: 0xb4b0a8, roughness: 0.97, metalness: 0,
      normalMap: this.normalTex, normalMapType: THREE.ObjectSpaceNormalMap,
    });
    this.terrain = new THREE.Mesh(geo, this.material);
    this.terrain.castShadow = true;
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
    this.bbox = geo.boundingBox;
    this._buildGraticule(meta, mesh);
    this._updateShadowFrustum();
  }

  // Swap in a sharper normal map once the full-resolution grid has loaded (the mesh itself is unchanged).
  setDetail(meta, detail) {
    if (!this.material) return;
    const old = this.normalTex;
    this.normalTex = this._normalMap(meta, detail);
    this.material.normalMap = this.normalTex;
    this.material.needsUpdate = true;
    if (old) old.dispose();
  }

  _normalMap(meta, detail) {
    const { m, f, g } = detail, scale = meta.scale, off = meta.offset;
    const data = new Uint8Array(m * m * 4);
    const P = (i, j, out) => {
      i = Math.max(0, Math.min(m - 1, i)); j = Math.max(0, Math.min(m - 1, j));
      const x = (j * f + (f - 1) / 2 - off) * scale, y = (off - (i * f + (f - 1) / 2)) * scale;
      return mapToWorld(x, y, g[i * m + j], out);
    };
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
    const dx = new THREE.Vector3(), dy = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
      P(i, j - 1, a); P(i, j + 1, b); P(i - 1, j, c); P(i + 1, j, d);
      dx.subVectors(b, a); dy.subVectors(d, c);
      n.crossVectors(dy, dx).normalize();
      if (n.y < 0) n.negate();
      const k = 4 * (i * m + j);
      data[k] = (n.x * 0.5 + 0.5) * 255; data[k + 1] = (n.y * 0.5 + 0.5) * 255; data[k + 2] = (n.z * 0.5 + 0.5) * 255; data[k + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, m, m, THREE.RGBAFormat);
    tex.flipY = false;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    return tex;
  }

  setShading(mode) {
    if (!this.material) return;
    this.material.vertexColors = mode === 'elevation';
    this.material.color.set(mode === 'elevation' ? 0xffffff : 0xb4b0a8);
    this.material.needsUpdate = true;
    // The elevation map should stay readable inside shadows; realistic mode keeps the Moon's near-black shadows.
    this.fill.intensity = mode === 'elevation' ? 1.1 : 0.05;
  }

  _heightAtMesh(meta, mesh, x, y) {
    const { m, f, g } = mesh, s = meta.scale * f;
    const c = (x / meta.scale + meta.offset - (f - 1) / 2) / f, r = (meta.offset - y / meta.scale - (f - 1) / 2) / f;
    const c0 = Math.max(0, Math.min(m - 2, Math.floor(c))), r0 = Math.max(0, Math.min(m - 2, Math.floor(r)));
    const fc = Math.max(0, Math.min(1, c - c0)), fr = Math.max(0, Math.min(1, r - r0));
    const k = r0 * m + c0;
    void s;
    return (g[k] * (1 - fc) + g[k + 1] * fc) * (1 - fr) + (g[k + m] * (1 - fc) + g[k + m + 1] * fc) * fr;
  }

  _buildGraticule(meta, mesh) {
    const grp = this.graticule = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0.28, depthWrite: false });
    const D2R = Math.PI / 180, R = meta.radius;
    const lift = 60; // m above terrain so lines are not z-fought
    const half = meta.offset * meta.scale;
    const pt = (lat, lon) => {
      const rho = 2 * R * Math.tan((90 + lat) * D2R / 2);
      const x = rho * Math.sin(lon * D2R), y = rho * Math.cos(lon * D2R);
      if (Math.abs(x) > half || Math.abs(y) > half) return null;
      return mapToWorld(x, y, this._heightAtMesh(meta, mesh, x, y) + lift);
    };
    const addLine = pts => {
      const segs = [];
      let cur = [];
      for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
      if (cur.length) segs.push(cur);
      for (const s of segs) if (s.length > 1) grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(s), mat));
    };
    this.gratLabels = [];
    for (const lat of [-89, -88, -87, -86, -85, -84, -82, -80]) {
      const pts = [];
      for (let lon = 0; lon <= 360; lon += 0.5) pts.push(pt(lat, lon));
      addLine(pts);
      const lp = pt(lat, 45 + (lat === -80 ? 0 : 0));
      if (lp) this.gratLabels.push({ text: `${-lat}°S`, pos: lp });
    }
    for (let lon = 0; lon < 360; lon += 30) {
      const pts = [];
      for (let lat = -89.9; lat <= -79.5; lat += 0.05) pts.push(pt(lat, lon));
      addLine(pts);
      const lp = pt(-80.6, lon) || pt(-82.0, lon);
      if (lp) this.gratLabels.push({ text: lon === 0 ? '0°' : lon <= 180 ? `${lon}°E` : `${360 - lon}°W`, pos: lp, lon: true });
    }
    this.scene.add(grp);
    for (const l of this.gratLabels) {
      const el = document.createElement('div');
      el.className = 'grat-label' + (l.lon ? ' lon' : '');
      el.textContent = l.text;
      this.labelLayer.appendChild(el);
      l.el = el;
    }
  }
  setGraticule(on) {
    if (this.graticule) this.graticule.visible = on;
    for (const l of this.gratLabels || []) l.el.style.display = on ? '' : 'none';
    this._gratOn = on;
  }

  // ---------- sky ----------
  _buildStars() {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const n = 5000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(t) * 20000, u * 20000, r * Math.sin(t) * 20000], 3 * i);
      const b = 0.25 + Math.pow(rnd(), 6) * 0.9, warm = rnd();
      col.set([b * (0.9 + 0.1 * warm), b * 0.95, b * (1.05 - 0.15 * warm)], 3 * i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.3, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
    this.stars.renderOrder = -2;
    this.sky.add(this.stars);
  }

  _buildSunEarth() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const cx = cv.getContext('2d');
    const gr = cx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.105, 'rgba(255,250,235,1)');
    gr.addColorStop(0.13, 'rgba(255,214,140,0.55)'); gr.addColorStop(0.35, 'rgba(255,170,80,0.12)'); gr.addColorStop(1, 'rgba(255,150,60,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    this.sky.add(this.sunSprite);
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0x3f7bd9, roughness: 0.55, emissive: 0x050b18 }));
    this.sky.add(this.earth);
  }

  setSunEarth(sunBF, earthBF, sunAngR, earthAngR) {
    this.sunDir.copy(bfToWorldDir(sunBF));
    this.earthDir.copy(bfToWorldDir(earthBF));
    this.sunAngR = sunAngR; this.earthAngR = earthAngR;
    this._updateShadowFrustum();
  }

  // The shadow map is fitted to the region around the orbit target (sharper when zoomed in), while its
  // depth range always spans the whole terrain so distant mountains still cast shadows into that region.
  _updateShadowFrustum() {
    if (!this.bbox) return;
    const L = this.sun, b = this.bbox;
    const tgt = this.controls.target;
    const radius = Math.min(460, Math.max(25, this.camera.position.distanceTo(tgt) * 1.6));
    const center = tgt.clone();
    L.target.position.copy(center);
    L.position.copy(center).addScaledVector(this.sunDir, 2500);
    L.updateMatrixWorld(); L.target.updateMatrixWorld();
    const view = new THREE.Matrix4().lookAt(L.position, center, L.shadow.camera.up);
    view.setPosition(L.position);
    view.invert();
    const v = new THREE.Vector3();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const drop = radius * radius / (2 * R_KM);   // curvature drop at the edge of the focus region
    for (const X of [-radius, radius]) for (const Y of [-20 - drop - 0.18 * radius, 20 + 0.18 * radius]) for (const Z of [-radius, radius]) {
      v.set(center.x + X, center.y + Y, center.z + Z).applyMatrix4(view);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    for (const X of [b.min.x, b.max.x]) for (const Y of [b.min.y, b.max.y]) for (const Z of [b.min.z, b.max.z]) {
      v.set(X, Y, Z).applyMatrix4(view);
      z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z);
    }
    const c = L.shadow.camera;
    c.left = x0; c.right = x1; c.bottom = y0; c.top = y1; c.near = Math.max(0.1, -z1 - 5); c.far = -z0 + 5;
    c.updateProjectionMatrix();
    const below = this.sunDir.y < -0.35;   // Sun far below the polar horizon: render as night
    L.intensity = below ? 0 : 3.2;
  }

  // ---------- markers ----------
  setMarkers(sites, selectedId) {
    const keep = new Set(sites.map(s => s.id));
    for (const [id, mk] of this.markers) if (!keep.has(id)) {
      this.scene.remove(mk.group); mk.label.remove(); this.markers.delete(id);
    }
    for (const s of sites) {
      let mk = this.markers.get(s.id);
      if (!mk) {
        const group = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ color: s.color, depthTest: true });
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8).translate(0, 0.5, 0), mat);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), mat);
        head.position.y = 1;
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 40).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
        ring.position.y = 0.02;
        group.add(stem, head, ring);
        const label = document.createElement('button');
        label.className = 'site-label';
        label.dataset.id = s.id;
        this.labelLayer.appendChild(label);
        mk = { group, head, stem, ring, label, mat };
        this.markers.set(s.id, mk);
        this.scene.add(group);
      }
      mk.mat.color.set(s.color); mk.ring.material.color.set(s.color);
      const p = mapToWorld(s.x, s.y, s.h0);
      const up = p.clone().add(new THREE.Vector3(0, R_KM, 0)).normalize();
      mk.group.position.copy(p);
      mk.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      mk.label.innerHTML = `<i style="background:${s.color}"></i>${escapeHtml(s.name)}`;
      mk.label.classList.toggle('selected', s.id === selectedId);
      mk.selected = s.id === selectedId;
    }
  }

  focus(site, distKm = 40) {
    // Before a site's horizon is traced its ground height is not known yet; use the drawn terrain's.
    const h = Number.isFinite(site.h0) ? site.h0 : this.mesh ? this._heightAtMesh(this.meta, this.mesh, site.x, site.y) : 0;
    const p = mapToWorld(site.x, site.y, h);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.35) { dir.y = 0.35; dir.normalize(); }
    this._anim = { t0: performance.now(), dur: 1100,
      fromT: this.controls.target.clone(), toT: p,
      fromP: this.camera.position.clone(), toP: p.clone().addScaledVector(dir, distKm) };
  }

  // Look straight down at the current target, like a map: 0°E (the Earth-facing side) is up, 90°E is right.
  topView() {
    const t = this.controls.target.clone();
    const d = Math.max(60, this.camera.position.distanceTo(t));
    this._anim = { t0: performance.now(), dur: 900, fromT: t.clone(), toT: t,
      fromP: this.camera.position.clone(), toP: t.clone().add(new THREE.Vector3(0, d, -d * 0.002)) };
  }

  pick(clientX, clientY) {
    if (!this.terrain) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    if (!hit) return null;
    const bf = worldToBF(hit.point);
    const rr = Math.hypot(bf[0], bf[1], bf[2]);
    const lat = Math.asin(bf[2] / rr) * 180 / Math.PI;
    let lon = Math.atan2(bf[1], bf[0]) * 180 / Math.PI; if (lon < 0) lon += 360;
    return { lat, lon };
  }

  // ---------- frame ----------
  _frame() {
    const cam = this.camera;
    if (this._anim) {
      const a = this._anim, t = Math.min(1, (performance.now() - a.t0) / a.dur), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.controls.target.lerpVectors(a.fromT, a.toT, e);
      cam.position.lerpVectors(a.fromP, a.toP, e);
      if (t >= 1) this._anim = null;
    }
    this.controls.update();
    this._updateShadowFrustum();
    this.sky.position.copy(cam.position);
    const D = 9000;
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(D);
    const sunSize = Math.tan((this.sunAngR || 0.267) * Math.PI / 180) * D * 2 / 0.21;  // disc is 21% of sprite width
    this.sunSprite.scale.set(sunSize, sunSize, 1);
    this.earth.position.copy(this.earthDir).multiplyScalar(D);
    this.earth.scale.setScalar(Math.tan((this.earthAngR || 0.95) * Math.PI / 180) * D);

    // keep markers a constant on-screen size
    for (const mk of this.markers.values()) {
      const d = cam.position.distanceTo(mk.group.position);
      const k = d * 0.022;
      mk.group.scale.setScalar(k * (mk.selected ? 1.25 : 1));
    }
    this.renderer.render(this.scene, cam);
    this._placeLabels();
  }

  _placeLabels() {
    const w = this.container.clientWidth, h = this.container.clientHeight, v = new THREE.Vector3();
    const place = (el, pos, yOff) => {
      v.copy(pos).project(this.camera);
      const vis = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.visibility = vis ? 'visible' : 'hidden';
      if (vis) el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h + yOff}px)`;
    };
    for (const mk of this.markers.values()) {
      const top = new THREE.Vector3(0, 1.25, 0).applyMatrix4(mk.group.matrixWorld);
      place(mk.label, top, 0);
    }
    if (this._gratOn !== false) for (const l of this.gratLabels || []) place(l.el, l.pos, 0);
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
