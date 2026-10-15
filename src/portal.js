// The Red Rift: swirling red-black tear in space.  Shader disc + inward-spiralling particles + red light.
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const FRAG = `
varying vec2 vUv; uniform float uTime; uniform float uOpen;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float a = atan(p.y, p.x);
  // tear shape: tall slit that widens as it opens
  float slit = 1.0 - smoothstep(0.0, 1.0, length(vec2(p.x * (1.6 / max(uOpen, 0.05)), p.y * 0.85)));
  float swirl = n(vec2(a * 2.0 + uTime * 1.6 + r * 5.0, r * 6.0 - uTime * 2.4));
  float swirl2 = n(vec2(a * 4.0 - uTime * 2.2, r * 9.0 + uTime));
  float core = smoothstep(0.55, 0.0, r);
  float ring = smoothstep(0.04, 0.0, abs(r - 0.78 * uOpen)) * 1.2;
  vec3 col = mix(vec3(0.02,0.0,0.01), vec3(1.0,0.08,0.1), swirl * 0.9 + swirl2 * 0.4);
  col += vec3(1.0,0.35,0.2) * ring + vec3(0.6,0.0,0.05) * core;
  float alpha = clamp(slit * 1.4 + ring * 0.5, 0.0, 1.0) * smoothstep(1.0, 0.7, r);
  col *= mix(0.35, 1.0, swirl);
  gl_FragColor = vec4(col, alpha);
}`;

export class RedRift {
  constructor(scene) {
    this.scene = scene; this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 }, uOpen: { value: 0 } } });
    this.disc = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.2), this.mat); this.group.add(this.disc);
    this.light = new THREE.PointLight(0xff1020, 0, 14, 1.6); this.group.add(this.light);
    const n = 260, pos = new Float32Array(n * 3); this.seeds = Array.from({ length: n }, () => ({ a: Math.random() * 6.28, r: 0.4 + Math.random() * 2.4, s: 0.4 + Math.random() * 1.2, y: (Math.random() - 0.5) * 3 }));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xff3a3a, size: 0.07, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })); this.group.add(this.pts);
    this.t = 0; this.open = 0; this.state = 'closed';
  }
  /** Tear open at world pos, facing the given point. */
  openAt(pos, lookAt) { this.group.position.copy(pos); this.group.lookAt(lookAt.x, pos.y, lookAt.z); this.group.visible = true; this.state = 'opening'; this.t = 0; this.open = 0.02; }
  close() { this.state = 'closing'; }
  update(dt) {
    if (!this.group.visible) return;
    this.t += dt; this.mat.uniforms.uTime.value = this.t;
    if (this.state === 'opening') { this.open = Math.min(1, this.open + dt * 0.9); if (this.open >= 1) this.state = 'open'; }
    else if (this.state === 'closing') { this.open -= dt * 1.5; if (this.open <= 0) { this.group.visible = false; this.state = 'closed'; this.open = 0; } }
    this.mat.uniforms.uOpen.value = Math.max(this.open, 0.02);
    this.disc.scale.set(this.open * 1.1 + 0.05, this.open + 0.05, 1);
    this.light.intensity = this.open * (14 + Math.sin(this.t * 17) * 5);
    const p = this.pts.geometry.attributes.position;
    this.seeds.forEach((s, i) => {
      s.r -= dt * s.s * 1.1 * (0.5 + this.open); if (s.r < 0.05) s.r = 2.6;      // sucked inward
      s.a += dt * (2.2 / (s.r + 0.3));
      p.setXYZ(i, Math.cos(s.a) * s.r * 0.8, s.y * (s.r / 2.6) , Math.sin(s.a) * s.r * 0.8 - 0.6 * (1 - s.r / 2.6));
    });
    p.needsUpdate = true; this.pts.material.opacity = 0.9 * this.open;
  }
}
