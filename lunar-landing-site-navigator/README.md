# Lunar Landing Site Navigator

NASA Space Apps Challenge 2026 — *Lunar Landing Site Navigator*.

An interactive tool for comparing lunar landing sites and landing dates by **sunlight (power)** and **direct-to-Earth (DTE) communication windows**, computed from real terrain at the south pole.

The screen has three parts that share one time and one selected site:

- **The Moon** (top left): 3D terrain of everything south of 80°S, built from NASA LRO LOLA altimetry on the true curved Moon and lit by the real Sun at the scene time, with cast shadows. Below it, the **sky view**: the horizon all the way round the selected site, with the Sun's and Earth's paths over the window and their positions now at true angular size.
- **The site** (right): time left until the next sunset, sunrise, Earthset or Earthrise, the Sun's and Earth's elevation, the window statistics, and a scan of the ground a few hundred metres around the site.
- **The deck** (bottom): every site as a row on one time axis. Each row has its numbers (sunlight, Earth in view, both, longest night, longest comm gap), its best landing date for the chosen mission length, and strips showing when it is sunlit and when Earth is in view. Drag anywhere on the strips to move the time.

What you can do:

- **Compare sites**: the best value in each column is highlighted. Add sites from the library (south-pole candidate areas; IM-1, IM-2 and LCROSS; Apollo 11, 15 and 17, Blue Ghost, Chandrayaan-3, Chang'e 4 and 6 for contrast), by coordinates anywhere on the Moon, or by clicking the terrain.
- **Compare dates**: choose a mission length. A marker on each row shows the best landing time; click it or the date to go there. "Landing score" turns the strips into a map of how good every landing time is. "This mission" switches the numbers to a mission that lands at the scene time, so they update as you drag.
- **See why small moves matter**: the nearby scan checks a 5 × 5 grid of points 400 m apart around a site.
- **Set an exact time** in UTC, play time forward, **copy a link** that reopens the same scenario, and **export** a site's time series as CSV.

## Run it

It is a static site with no build step:

```bash
python3 tools/serve.py 8643
```

Then open http://localhost:8643. Three.js and Astronomy Engine load from the jsDelivr CDN.

## How it works

| Piece | Source / method |
|---|---|
| Terrain | LRO LOLA `LDEM_80S_80M` (PDS LRO-L-LOLA-4-GDR), Mean Earth/Polar Axis frame, averaged to 160 m/px (`tools/prep_dem.py`), packed losslessly to 7.3 MB with a predictor and a 4-stream rANS entropy coder in 8 independent bands, plus a 0.8 MB 640 m preview (`tools/pack_dem.mjs`, `js/demcodec.js`); the bands are decoded on the helper threads |
| Horizon | 1,440 rays per site across the DEM out to the map edge, on the curved Moon; max elevation angle in 0.5° azimuth bins (`js/terrain.js`), traced on up to 3 helper threads (`js/hzworker.js`) |
| Sun & Earth | Astronomy Engine positions, rotated into the Moon-fixed frame with the IAU/WGCCRE lunar rotation model, with topocentric parallax (`js/ephem.js`) |
| Sunlight | fraction of the solar disc above the terrain horizon; "sunlit" means at least half the disc is visible |
| Earth in view | Earth's centre above the terrain horizon plus a user-set margin (line of sight only, not a link budget) |
| Both | sunlight counted only while Earth is in view |
| Landing dates | for each landing time, the averages of the three values above over the mission; the best time is the maximum, optionally limited to landings that are sunlit with Earth in view (`js/analysis.js`) |
| Sites off the map | horizon of a smooth sphere at the sensor height; local terrain is not included |

### Validation

`node tools/validate_horizons.mjs` compares the app's Sun and Earth azimuth and elevation with **NASA/JPL Horizons (DE441)** at four polar sites every ~2 days through 2026–2027:

```
2800 comparisons. Worst |Δaz·cos(el)| / |Δel| in degrees:
  sun    0.0043 / 0.0023
  earth  0.0036 / 0.0028
```

That is about 1/120 of the Sun's diameter.

Sanity checks on the terrain: Shackleton crater's floor gets 0% sunlight and never sees Earth, as expected for a permanently shadowed region. The tool's search for the best-lit point on the Shackleton–de Gerlache ridge lands at 89.44°S, 222.63°E (about 89% average sunlight in 2027), next to the high-illumination "connecting ridge" point often cited in the literature (89.45°S, 222.7°E). The ~5 km-high Malapert Massif has the best Earth visibility of the presets (69%).

`node tools/test_planner.mjs` checks the landing-date maths against brute force on the real terrain, and the smooth-sphere sites against known geometry: Apollo 11 gets a 14.8-day night with the Earth always 58° to 73° up, and Chang'e 4 on the far side never sees the Earth.

### Speed

`node tools/bench.mjs` times each stage and estimates first-load time. On a recent laptop:

```
  Decode preview terrain (640 m)          14 ms   0.76 MB
  Decode full terrain (160 m)            172 ms   7.31 MB, one thread
    ... 8 bands on 3 helper threads       75 ms   as the app does; identical result
  Trace one horizon (1,440 rays)          88 ms   median of 6 sites
  Trace all 6 preset horizons            523 ms   one thread; about 175 ms over 3 helpers
  Sun & Earth, 1 year (60 min)            83 ms   8,761 samples
  Analyse one site for a year              2 ms
  Best landing dates, 14-day mission     0.2 ms
  Nearby scan (25 horizons)             1363 ms   one thread

Estimated first load, seconds:   terrain visible   ready   previous version (ready)
  10 Mbit/s                            2.8          8.2          10.6
  25 Mbit/s                            1.1          3.4           4.7
  100 Mbit/s                           0.3          1.0           1.7
```

The page loads the 640 m preview first and draws it within a second, so the Moon can be explored while the full grid downloads. Helper threads, started while the file downloads, decode its bands in parallel and then trace horizons; if they cannot run, the main worker does both. In the browser, `window.lsnTiming` holds the measured load stages. Served locally in Chrome, the full grid decoded in 104 ms, the terrain appeared at 0.44 s and the app was ready at 1.09 s; the nearby scan took 0.65 s.

### Preset sites

`node tools/find_sites.mjs` searches each named feature for its best-lit point (year 2027, 2 m height). The Shackleton floor point is a fixed contrast case.

## Limits

- 160 m terrain resolution: boulders, small craters and the lander itself are not modelled.
- No terrain north of 80°S. Sites near the map edge (IM-1) miss distant terrain to the north, and sites off the map use a smooth horizon.
- For study and education, not flight operations.

## Use of AI

The code, the terrain codec and this documentation were written with help from Claude Code, an AI coding assistant. The science comes from NASA LRO LOLA data and published ephemeris models, and the results are checked against NASA/JPL Horizons and brute-force tests (see Validation). The app itself uses no AI at runtime.

## Files

```
index.html, css/style.css
js/app.js        interface and state
js/scene.js      three.js terrain, sun, shadows, markers
js/charts.js     sky view and the deck's time axis and strips
js/worker.js     terrain loading and decoding, ephemeris sampling (Web Worker)
js/hzworker.js   helper thread: decodes terrain bands, then traces horizons; several run in parallel
js/demcodec.js   lossless terrain codec (predictor + interleaved rANS, in bands)
js/terrain.js    DEM access, projection, horizon tracing
js/ephem.js      Sun/Earth geometry in the Moon-fixed frame
js/analysis.js   per-site time series, statistics and landing-date scan
data/            dem160.wasm (full grid), dem640.wasm (preview), dem.json (metadata);
                 the .wasm extension only makes static hosts serve the bytes as they are
tools/           data prep and packing, validation, tests, speed benchmark, preset search, dev server
index-classic.html, css/classic.css, js/app-classic.js, js/charts-classic.js
                 the earlier interface, kept for reference at /index-classic.html
```
