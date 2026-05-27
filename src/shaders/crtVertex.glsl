varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 pos = position;
  
  // Trapezoidal screen shaping (wider at the bottom base, narrower at the top)
  float trapezoidFactor = mix(1.04, 0.95, uv.y);
  pos.x *= trapezoidFactor;
  
  // Calculate distance from absolute center (0.5, 0.5) in UV space
  float dist = length(uv - vec2(0.5));
  
  // Custom retro bulb dome-cone displacement profile
  // 1.0 at center, 0.0 at mid-edges, negative at corners
  float factor = 1.0 - pow(dist * 2.0, 1.5);
  
  // Max center bulge: +0.07. Corners descend to approx -0.04 (approx 4 centimeters)
  pos.z += factor * 0.07;
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
