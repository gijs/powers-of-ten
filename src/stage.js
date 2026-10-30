// Stage — Three.js setup plus the decade lifecycle.
//
// The camera is bolted down at the origin and never moves. "Zooming" is done
// entirely by rescaling decade content, which is what keeps every coordinate
// the GPU sees inside float32's comfortable range regardless of whether we are
// looking at quarks or at superclusters.

import * as THREE from 'three';

import { FOV, ASPECT, CAMERA_DISTANCE } from './frame.js';

export class Stage {
  /**
   * @param {HTMLElement} mount 4:3 container
   * @param {ReturnType<import('./registry.js').createRegistry>} registry
   */
  constructor(mount, registry) {
    this.mount = mount;
    this.registry = registry;
    /** @type {Map<string, {band: object, instance: object, ready: boolean, failed: boolean}>} */
    this.built = new Map();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setClearColor(0x05070b, 1);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.domElement.className = 'stage-canvas';
    mount.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, ASPECT, 0.01, 200);
    this.camera.position.set(0, 0, CAMERA_DISTANCE);
    this.camera.lookAt(0, 0, 0);

    this.decadeRoot = new THREE.Group();
    this.scene.add(this.decadeRoot);

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(mount);
    this.resize();
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.mount;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    const pr = Math.min(devicePixelRatio, 2);
    this.renderer.setPixelRatio(pr);
    for (const e of this.built?.values() ?? []) e.instance.setPixelRatio?.(pr);
    // Aspect stays pinned to 4:3 so the HUD square maths holds; the container
    // is already letterboxed by CSS.
    this.camera.aspect = ASPECT;
    this.camera.updateProjectionMatrix();
  }

  _build(band) {
    const instance = band.create();
    instance.root.visible = false;
    const entry = { band, instance, ready: !instance.ready, failed: false, disposed: false };
    this.decadeRoot.add(instance.root);
    this.built.set(band.key, entry);

    instance.ready?.then(() => {
      if (!entry.disposed) entry.ready = true;
    }).catch((err) => {
      entry.failed = true;
      console.error(`band "${band.name}" failed to load:`, err);
    });
  }

  _dispose(entry) {
    entry.disposed = true;
    this.decadeRoot.remove(entry.instance.root);
    entry.instance.dispose();
    this.built.delete(entry.band.key);
  }

  /**
   * Reconcile what is built and how it is placed against the director.
   * Build and dispose use different radii, which gives hysteresis — content is
   * ready before it is needed and survives a brief scrub past it.
   */
  sync(director) {
    const { build, keep } = director.buildRange();
    const wanted = this.registry.bandsInRange(build);
    const retained = this.registry.bandsInRange(keep);

    for (const band of wanted) if (!this.built.has(band.key)) this._build(band);
    for (const entry of [...this.built.values()]) {
      if (!retained.has(entry.band)) this._dispose(entry);
    }

    const raw = this.registry.bandWeights(director);

    // Renormalise across bands that are actually ready. A band still loading
    // would otherwise take its share of the weight and render nothing,
    // darkening the frame; this hands its share to its neighbours until it
    // arrives, and it then fades in rather than popping.
    let readySum = 0;
    for (const [band, w] of raw) {
      const entry = this.built.get(band.key);
      if (entry?.ready && !entry.failed) readySum += w;
    }

    for (const entry of this.built.values()) {
      const share = raw.get(entry.band) ?? 0;
      const w = entry.ready && !entry.failed && readySum > 0 ? share / readySum : 0;
      const visible = w > 0.001;
      entry.instance.root.visible = visible;
      if (!visible) continue;
      // The one line the whole architecture rests on. A band is authored around
      // its reference decade, so a 3-decade band spans 10^3 local units — fine
      // for float32, which is why bands must stay narrow.
      entry.instance.root.scale.setScalar(10 ** (entry.band.ref - director.s));
      entry.instance.setWeight(w);
      entry.instance.update?.(director.s);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  get liveCount() {
    let n = 0;
    for (const e of this.built.values()) if (e.instance.root.visible) n++;
    return n;
  }

  /** True while any built band is still fetching. */
  get loading() {
    for (const e of this.built.values()) if (!e.ready && !e.failed) return true;
    return false;
  }

  dispose() {
    this._ro.disconnect();
    for (const e of [...this.built.values()]) this._dispose(e);
    this.renderer.dispose();
  }
}
