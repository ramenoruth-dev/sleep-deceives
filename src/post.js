// Post-processing for a filmic, photographic look: HDR bloom around light sources and wet highlights, subtle
// chromatic aberration, film grain and vignette, then ACES tone mapping.  Disabled on the "low" quality setting.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.018 }, aberr: { value: 0.0018 }, vig: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, grain, aberr, vig; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float d = dot(c, c);
      vec2 off = c * aberr * (1.0 + d * 6.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col += (rnd(vUv * 1024.0) - 0.5) * grain * (1.0 - clamp(lum * 1.5, 0.0, 0.8));
      col *= 1.0 - vig * smoothstep(0.15, 0.75, d * 2.2);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.enabled = false; this.baseAberr = 0.0018;
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.65, 0.55); this.composer.addPass(this.bloom);
    this.film = new ShaderPass(FilmShader); this.composer.addPass(this.film);
    this.composer.addPass(new OutputPass());
  }
  setQuality(q) {
    this.enabled = q !== 'low'; this.bloom.strength = q === 'high' ? 0.7 : 0.5; this.bloom.radius = q === 'high' ? 0.8 : 0.6;
    this.film.uniforms.grain.value = q === "high" ? 0.022 : 0.016;
  }
  setSize(w, h) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
  render(dt, time, distort = 0) {
    this.film.uniforms.time.value = time % 100; this.film.uniforms.aberr.value = this.baseAberr + distort * 0.012;
    this.composer.render(dt);
  }
}
