// Post stack.
//
// What separates an homage from a tech demo. The original is 16mm film shot on
// an animation stand, and almost everything that reads as "1977" rather than
// "WebGL" happens after the image is formed: halation around bright areas,
// grain, the slight unsteadiness of a projector gate, and a response curve
// that is not linear.
//
// All analytic — no LUT texture, no grain plate, nothing to download.

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import * as THREE from 'three';

const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.055 },
    uWeave: { value: 1.0 },
    uVignette: { value: 0.42 },
    uWarmth: { value: 1.0 },
    uEnabled: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uWeave, uVignette, uWarmth, uEnabled;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;

      // Gate weave: the frame never sits perfectly still in a projector. A
      // fraction of a pixel, drifting — too small to notice directly, and
      // immediately noticeable by its absence.
      if (uEnabled > 0.5) {
        float t = uTime * 0.7;
        vec2 weave = vec2(
          sin(t * 2.3) * 0.5 + sin(t * 5.7) * 0.25,
          sin(t * 1.9 + 2.1) * 0.5 + sin(t * 4.3) * 0.2);
        uv += weave * uWeave * 0.0007;
      }

      vec3 c = texture2D(tDiffuse, uv).rgb;

      if (uEnabled > 0.5) {
        // Film response: a gentle S-curve, with highlights running warm and
        // shadows cool. Stock is not linear and not neutral.
        c = clamp(c, 0.0, 1.0);
        vec3 s = c * c * (3.0 - 2.0 * c);
        c = mix(c, s, 0.45);
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 warm = vec3(1.045, 1.0, 0.945);
        vec3 cool = vec3(0.96, 0.985, 1.06);
        c *= mix(cool, warm, smoothstep(0.15, 0.85, luma)) * mix(1.0, 1.0, uWarmth);

        // Grain, scaled down in the highlights as it is on real stock.
        float g = hash12(gl_FragCoord.xy + fract(uTime) * 571.0) - 0.5;
        c += g * uGrain * (1.0 - 0.65 * luma);

        // Vignette.
        vec2 d = vUv - 0.5;
        c *= 1.0 - uVignette * dot(d, d) * 1.6;
      }

      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }
  `,
};

export class PostStack {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // Halation: bright areas bleed into the emulsion around them.
    //
    // Calibrated against the un-posted image rather than chosen. A low
    // threshold seems right for a film that is mostly dark with small bright
    // things in it, but at 0.18 every star in a dense field qualifies and the
    // frame washes out — measured, mean brightness went from 49 to 201. These
    // values lift the brightest scale slightly and leave the rest alone, which
    // is what halation actually does.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.5, 0.75);
    this.composer.addPass(this.bloom);

    this.film = new ShaderPass(FilmShader);
    this.film.renderToScreen = true;
    this.composer.addPass(this.film);

    this.enabled = true;
  }

  setEnabled(on) {
    this.enabled = on;
    this.bloom.enabled = on;
    this.film.uniforms.uEnabled.value = on ? 1 : 0;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  render() {
    this.film.uniforms.uTime.value = performance.now() / 1000;
    this.composer.render();
  }

  dispose() { this.composer.dispose?.(); }
}
