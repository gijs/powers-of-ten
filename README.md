# Powers of Ten — scale engine + HUD

A Three.js homage to the 1977 Eames film. This is the foundation layer: the
scale engine and the HUD, with diagnostic content standing in for art.

Original film © Eames Office. The score (Elmer Bernstein) and narration
(Philip Morrison) are protected — anything shipped here needs its own.

## Run

    npm run dev        # node tools/serve.mjs
    open http://localhost:8080

No build step. `index.html` carries an importmap pointing at `node_modules`.

Use the bundled server rather than `python3 -m http.server`: that one is
single-threaded, so a multi-megabyte asset fetch blocks the module scripts
queued behind it and the page intermittently fails to boot.

Deep-link a position: `#s=6.8` (scale) or `#t=120` (timeline seconds).

Keys: `space` play · `←/→` scrub (shift = 10s) · `[` `]` step a decade ·
`h` HUD · `c` controls · `r` reset.

## The idea

The film spans 10⁻¹⁶ m to 10²⁴ m — 41 orders of magnitude. float32 carries
~7 decimal digits, so no scene graph can hold that in absolute coordinates.

Instead the camera is bolted to the origin and never moves. One scalar drives
everything:

    s = log10(the width the measuring square denotes, in metres)

Content is authored per decade in normalised units (1 unit = 10^level metres)
and placed into the scene scaled by `10^(level - s)`. Only decades within
`blendRadius` of `s` are ever live, so that exponent stays inside [-1.5, 1.5]
and every number the GPU sees is comfortably in range — whether we are looking
at quarks or at superclusters.

## Files

| File | Role |
|---|---|
| `src/scale-director.js` | owns `s`, the timeline, cross-fade weights, build hysteresis |
| `src/hud.js` | nested measuring squares + readouts |
| `src/frame.js` | geometry constants shared by HUD and camera — **do not duplicate these** |
| `src/stage.js` | Three.js setup, decade build/dispose lifecycle |
| `src/registry.js` | band table: tiling validation, per-band weights |
| `src/bands/star-points.js` | shared star shader, photometry, exposure |
| `src/bands/stars.js` | catalogue star field, 10^17..10^18 |
| `src/bands/galactic-field.js` | procedural star field, 10^19 |
| `src/bands/galaxy.js` | raymarched Milky Way, 10^20..10^21 |
| `src/bands/local-group.js` | galaxy billboards, 10^22 |
| `src/bands/cosmic-web.js` | procedural large-scale structure, 10^23..10^24 |
| `src/bands/galaxy-sprites.js` | shared galaxy billboard rendering |
| `src/bands/raymarch.js` | shared volume-march scaffold for the inward bands |
| `src/bands/tissue.js` | skin, 10^-3..10^-1 |
| `src/bands/cell.js` | cells, 10^-6..10^-4 |
| `src/bands/molecule.js` | DNA, 10^-9..10^-7 |
| `src/bands/atom.js` | electron orbitals, 10^-11..10^-10 |
| `src/bands/nucleus.js` | nucleus and quarks, 10^-16..10^-13 |
| `src/audio.js` | synthesised score, mixed by scale |
| `src/post.js` | bloom, grain, gate weave, film response |
| `src/rng.js` | seeded PRNG and distributions |
| `src/decades.js` | diagnostic stand-in content |
| `src/format.js` | SI / astronomical / duration formatting |
| `tools/build-star-catalog.mjs` | HYG CSV -> packed binary |
| `tools/build-galaxy-catalog.mjs` | McConnachie FITS -> JSON |
| `tools/serve.mjs` / `tools/shot.mjs` | static server; CDP screenshot tool |

### Two invariants

**The square defines the scale, not the camera.** `s` is the width the square
denotes, so the camera must see `FRAME_UNITS` (~2.15) decade-units across for
one unit to land exactly on it. `frame.js` exists so the HUD and the camera
cannot drift apart; the moment they do, the squares stop nesting.

**Nothing visual may key off a slot index.** Squares are addressed as offsets
from `floor(s)`, but those renumber every time the fractional part wraps.
Opacity, emphasis and ticks are all functions of `d = n - s`, which is
continuous across boundaries. Keying any of them to the slot pops 41 times.

### Bands

A *band* owns a contiguous run of decades and renders them as one thing. The
star field is why: 10^17..10^18 is a single point cloud seen at two scales, not
two cross-faded copies of itself. Discrete artwork plates are just bands of
width 1.

    { root, ready?, setWeight(w), update?(s), dispose() }

`ready` is an optional promise; a band still loading is skipped and its weight
is handed to its neighbours, so the frame never darkens waiting on a fetch and
the band fades in when it arrives instead of popping.

**Bands must tile [S_MIN, S_MAX] exactly.** `ScaleDirector` normalises its
per-level weights to sum to 1, so if every level belongs to exactly one band
then the band weights sum to 1 too and no handoff can dim or flare. A gap
breaks that silently, so `createRegistry` validates the tiling and fills
anything unclaimed with width-1 diagnostic bands.

A band is authored around a reference decade and scaled by `10^(ref - s)`, so a
band spanning N decades needs local coordinates spanning 10^N. Three or four
decades is fine for float32; ten would not be. Keep bands narrow.

**Everything is heliocentric.** The Sun sits at the scene origin in every
band, because the piece holds its starting point at frame centre — that is what
the HUD's nested squares measure outward from. The galaxy band originally
centred the Milky Way itself, which quietly moved the viewpoint 8 kpc to the
galactic centre partway through, leaving the squares framing a place the
journey never passed through. The volume is offset instead, so at 10^21 the
bulge sits off to one side with the Sun centred, which is also the truthful
picture.

**A bounded band must freeze its exposure at its own range.** Star brightness is
computed from distance to the camera and then normalised against the camera's
own distance, so that a receding viewpoint does not make the whole field fade
out. But every field here is bounded — a catalogue reaches only so far, a
generated one is sampled only so far — while the viewpoint keeps going. Let the
exposure track the camera past the edge of the content and it compensates for
distance the content no longer spans: what remains collapses toward frame centre
and is pumped brighter the further away it gets. Measured on the catalogue band,
coverage ran from 0.47 at 10^18 to **39.5** by 10^20, a saturated white wash. The
fix is `exposureRange` in star-points.js: a band is exposed for its own decades
and simply falls away beyond them, which is what the cross-fade is there to
cover.

### Calibrating a band

Two measures, and both are needed — matching either alone gives a wrong image.

| Measure | What it catches |
|---|---|
| **coverage** — total ink as a fraction of frame area | overall density; target ~0.45 |
| **ink per in-frame star** | whether points are too fat |

Coverage alone is degenerate: half as many stars at four times the area gives
the same total and looks like mush, because the points overlap rather than
reading as separate stars. The first cut of the procedural field sat at 122 px²
per star against the catalogue's 23 and looked like porridge at the same
coverage. What actually controls it is the point size ceiling, far more than the
count.

Two things moved the result more than expected:

- **The faint cutoff of the luminosity function.** Truncating it near the bright
  end gives every star nearly the same luminosity, so every point renders nearly
  the same size. A field reads as a field because of the spread — many small
  points, a few large ones.
- **The giant fraction.** Giants are bright by construction, while the
  luminosity function makes luminous stars only ~0.4% of the sample. At a
  seemingly modest 12%, giants were 89% of everything large enough to resolve
  and the field came out uniformly orange. It wants to be near 1%.

One character difference is inherent and not a calibration failure: the
catalogue band has real nearby stars with enormous dynamic range, so it shows
large bright points against black, while a field seen from hundreds of parsecs
is finer and more even. That step is physically right.

### The galaxy volume

`galaxy.js` is a raymarched emission-absorption volume rather than points: past
10^19 individual stars stop being resolvable, and dust lanes are *absorption*,
which additive points cannot do at all. It renders a box with `BackSide` and
marches in **object space**, so the shader is independent of which decade we are
at — the only per-frame input is the camera's object-space position, which is
`CAMERA_DISTANCE / scale` because the band root is uniformly scaled at the
origin.

Two things about it were not obvious:

**The tone curve has to act on luminance, not on each channel.** An exponential
disk spans an enormous range of surface brightness; shown linearly the bulge
saturates while the disk dies out around 5 kpc, where it should read to 10-15.
Every astronomical image of a galaxy is stretched for this reason. But curving
R, G and B separately drives them all toward 1 together, bleaching the warm core
and the blue arms to the same flat white — and that colour split is the one cue
distinguishing old central light from young light in the arms. Mapping luminance
and carrying the colour ratios through keeps it.

**A logarithmic spiral winds infinitely toward the centre.** Left alone it packs
the innermost kiloparsec with ever-tighter arms, and at 10^20 m — where the
frame is only ~3 kpc — that fake winding is most of the picture. Real galaxies
have a bulge and a bar there and no arm structure at all, so the arm term is
faded out below ~3.5 kpc.

Cost scales with pixels times steps, so `galaxyBand({ steps })` is tunable; 72
is the default.

### Billboard bands

`local-group.js` draws each galaxy as a camera-facing quad with a procedural
profile shader — so they stay sharp across a decade and each gets its own arms,
inclination and colour without a texture.

Brightness here is **surface brightness, not magnitude**, and that is the thing
worth getting right. Galaxies are *extended* objects: total flux falls as
1/distance^2, but so does apparent area, so surface brightness does not change
with distance at all. Drawing each at its intrinsic surface brightness and
letting the sprite's size carry the distance is both simpler and more correct
than the recession-and-exposure treatment the point bands need.

### Verifying it

The diagnostic grid is the correctness test. Each decade draws 11×11 cells of
1/10 unit, with one cell centred on the origin — odd count is required, or
every decade sits half a cell off from the next. When the maths is right:

- decade *n*'s centre cell exactly contains decade *n-1*'s unit square
- decade *n+1*'s cell boundaries land exactly on the HUD's primary square

Both are visible at a glance, at any scale.

### The inward volumes, and step size

`raymarch.js` carries the box-and-ray boilerplate for the inward journey; each
band supplies only a `sampleVolume` and an exposure. Two things bite:

**Step size has to be smaller than the smallest feature.** A DNA strand is
0.034 local units thick; with the box six units deep and 72 steps, a step was
0.17 and the ray walked straight past it. The per-pixel jitter that normally
hides banding then turned the whole frame into colour noise. Shallow boxes,
more steps.

**Point the content across the view, not along it.** The first DNA helix ran
along z — the view axis — so it rendered as a disc with no helix visible
anywhere in it.

Exposures are measured, not chosen: each band is rendered across its own decade
range and the exposure picked that puts mean brightness in range without
blowing the 95th percentile.

### Audio

`audio.js` is entirely synthesised — no samples, no score, zero payload, and
nothing anyone else owns. Ten layers tile [S_MIN, S_MAX] and are mixed through
`weightsOverRanges`, the same window function the band registry uses, so a
sound layer fades on exactly the curve its matching visuals do.

Two things run continuously rather than in layers: a drone whose fundamental
tracks `s` directly, falling five octaves from 440 Hz at the quantum end to
13.75 Hz at the cosmic one, and a reverb wet level that grows with scale.

**Weights summing to 1 does not make the mix level.** The voice types have very
different inherent loudness — shimmer runs about eight times quieter than
filtered noise — and the raw mix climbed 18 dB across the journey. Each layer's
gain is the measured value that brings it to the same RMS rendered solo, which
holds the whole range within about 4 dB.

The playhead switches from rAF time to `audioContext.currentTime` when audio
starts, via `director.rebase`, so a seven-minute run cannot drift against the
score.

### Post

Bloom, grain, gate weave, vignette and an analytic film response — all
parametric, no LUT texture or grain plate.

Bloom is calibrated against the un-posted image. A low threshold sounds right
for a film that is mostly dark with small bright things in it, but at 0.18
every star in a dense field qualified and the frame washed out: mean brightness
went from 49 to 201. The shipped values lift the brightest scale slightly and
leave the rest alone.

### Depth

There is no logarithmic depth buffer and there does not need to be. Every band
is transparent or additive with `depthTest: false`, compositing in band order,
so nothing is ever depth-sorted — the scale renormalisation removed the problem
that would have called for one.

What the audit did find was the opposite mistake: a *tight* far plane clipping
real content. At 200 it cut the star catalogue's outer shell by a factor of 43
and clipped the Local Group and both cosmic web shells. Near and far are now
generous, which costs nothing when no one reads the depth buffer.

## Content plan

41 decades, grouped by the technique each band wants. The bands matter more
than the individual levels: within a band one approach carries several decades,
and the expensive part of the project is the handful of places where the
approach has to change.

### Outward

| Decades | Subject | Source | Technique |
|---|---|---|---|
| 10⁰–10² | picnic, figures, lawn | photographic plates | layered plates with parallax offsets |
| 10³–10⁴ | city block, lakefront | ortho imagery | tile pyramid, straight to plate |
| 10⁵–10⁷ | lake, continent, Earth | ortho + DEM | textured relief, single-scattering atmosphere |
| 10⁸–10⁹ | Earth–Moon system | NASA BMNG, LRO | real geometry, real albedo maps |
| 10¹⁰–10¹³ | inner and outer solar system | VSOP87 / astronomy-engine | instanced bodies, orbit lines |
| 10¹⁴–10¹⁶ | Oort cloud, interstellar void | procedural | sparse points, near-empty frames |
| 10¹⁷–10¹⁸ | local stars | HYG catalogue | `Points` + custom vertex shader — **built** |
| 10¹⁹ | outer solar neighbourhood | procedural disk model | `Points`, generated at load — **built** |
| 10²⁰–10²¹ | Milky Way | procedural density field | raymarched volume, 3D fbm — **built** |
| 10²² | Local Group | McConnachie catalogue | instanced galaxy billboards — **built** |
| 10²³–10²⁴ | large-scale structure | procedural cosmic web | galaxy billboards on a density field — **built** |
| 10²⁴ | cosmic web, CMB | procedural + Planck map | filament field, outer sphere |

### Inward

| Decades | Subject | Source | Technique |
|---|---|---|---|
| 10⁻¹–10⁻³ | hand, skin surface | procedural | displaced surface march — **built** |
| 10⁻⁴–10⁻⁶ | cells, cell nucleus | procedural | jittered lattice, membranes and nuclei — **built** |
| 10⁻⁷–10⁻⁹ | DNA | procedural | raymarched double helix — **built** |
| 10⁻¹⁰–10⁻¹¹ | atoms, electron cloud | closed form | raymarched \|ψ\|² — **built** |
| 10⁻¹³–10⁻¹⁶ | nucleus, nucleons, quarks | procedural | soft emission volumes — **built** |


**Catalogue data runs out at ~10^18.** HYG is magnitude-limited: its apparent
stellar density falls ~26000x between the solar neighbourhood and 900 pc, while
the real galactic disk is roughly uniform over that range. It is complete to
about 20 pc and badly incomplete past 50. At 10^19 m the frame is 324 pc wide
and that selection effect dominates the image — a dense cluster centred on the
Sun that is an artefact of the survey, not a thing in the sky. Those decades
need a field that restores uniform density, which is what
`galactic-field.js` does: it samples an exponential disk and applies a *uniform*
cutoff, so it is volume-complete for the luminosities it draws and carries no
false gradient. Spiral structure is deliberately absent — it has kiloparsec
scale and cannot show in a 324 pc frame; it belongs to the volumetric band.

**The galaxy catalogue runs out at 10^22, for the same reason the star one ran
out at 10^18.** McConnachie reaches 3 Mpc, but by 10^23 the viewpoint has
receded to ~9.8 Mpc — three times beyond the data — so the Local Group sits in
frame as a small clump with nothing around it. Measured, the galaxies cover
0.01% of the frame there, and exposure cannot rescue it: the sprite cores are
already saturated, so turning it up only widens a few white dots. Those decades
need a procedurally extended field of galaxies.

Everything from 10⁻⁹ inward and 10²⁰ outward is pure shader: closed-form or
procedural, zero bytes of asset. That is most of both tails, and it is why the
payload budget below is achievable at all.

### Two seams that will cost the most

These are where the technique changes, and they are the only places the
approach can actually fail.

- **10⁶ → 10⁷** — photographic imagery hands off to 3D geometry. The frame has
  to stop being a plate and start being a globe without a visible seam.
- **10⁰ → 10⁻¹** — macro to micro. The same handoff problem, with no data to
  lean on and a much less forgiving subject.

A seam is a handoff *between* two bands, so neither is buildable in isolation —
there is nothing to test until content exists on both sides. They are where to
expect disproportionate time, not where to start. Sequence the bands so that
both sides of a seam land early rather than leaving either for last.

### Payload budget

Target under 50–80 MB total.

- KTX2/Basis for every texture, never PNG or JPEG at source resolution
- star catalog as a binary `Float32Array` blob, not JSON — 100k stars at 16
  bytes each is ~1.6 MB, the same data as JSON is ~30× that
- prefetch decade *n*±2 while showing *n*; the build hysteresis in
  `ScaleDirector.buildRange` already gives the lead time

### Authoring the geo decades

10⁰–10⁷ are the one band that can be generated rather than drawn. A WMTS or XYZ
tile pyramid is already a scale pyramid, so each decade is a render at the
matching zoom level. Real aerial imagery plus an elevation model gives those
eight decades for the cost of a QGIS export script — pick a location with good
open coverage and render ortho + DEM per level.

## Next

23 of 41 decades have real content. What is left is the outward journey from
the ground to the stars, and it is left because it is the part that needs
source material rather than shaders:

1. **10^0–10^6 — picnic to Earth.** Photographic plates and orthoimagery. See
   *Authoring the geo decades* above: a tile pyramid is already a scale
   pyramid, so these can be generated from real aerial imagery and elevation
   rather than drawn.
2. **10^7–10^13 — Earth, Moon, solar system.** Real body textures and
   ephemerides. Data exists; it needs fetching and a band each.
3. **10^14–10^16 — interstellar void.** Nearly empty by nature, and the one
   band here that could be procedural. It wants art direction more than code.
4. **10^-12** is deliberately left diagnostic: between the electron cloud and
   the nucleus there is genuinely nothing to see, and faking something would be
   worse than the grid.

Beyond content: the inward bands are a first pass. Each works at its own
reference decade and thins out toward the edges of its range, because the
shaders have features at one characteristic scale while a band spans two or
three decades. Making detail emerge as the frame closes is the next real
rendering problem.

## Attribution

Star positions and photometry from the [HYG Database](https://github.com/astronexus/HYG-Database)
by David Nash / astronexus, licensed CC BY-SA 4.0. `assets/stars.bin` is a
derived subset; regenerate it with:

    npm run build:stars -- path/to/hygdata_v40.csv.gz

Note that ShareAlike attaches to derivatives of the data, which is worth
settling before publishing anything built on it.

Galaxy positions and photometry from A. W. McConnachie (2012), AJ 144, 4,
["The Observed Properties of Dwarf Galaxies in and around the Local
Group"](https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/en/community/nearby/),
January 2021 public release. `assets/galaxies.json` is derived from it with:

    node tools/build-galaxy-catalog.mjs path/to/NearbyGalaxies.fits

It is a catalogue of *dwarf* galaxies, so the Milky Way and M31 appear in it
only as the hosts whose satellites are listed. Both are added by the build tool
from standard values, flagged `supplementary` in the output.
