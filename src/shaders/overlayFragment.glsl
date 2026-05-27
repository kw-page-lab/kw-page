uniform float uTime;
uniform float uDarkness; // Control darkness intensity
uniform float uOffset;   // Vignette radius/offset
varying vec2 vUv;

// Optimized pseudo-random noise for movie-grain darkness feel
float random(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;
  
  // Distance from screen center
  vec2 uvDist = uv - vec2(0.5);
  float dist = length(uvDist);
  
  // Calculate vignette (radial darkness)
  float vignette = smoothstep(uOffset, uOffset + uDarkness, dist);
  
  // Animated fine noise/grain in dark spots
  float noise = random(uv + sin(uTime * 0.05)) * 0.025;
  
  // Combine vignette and noise
  float finalOpacity = clamp(vignette + noise * (vignette * 1.5), 0.0, 1.0);
  
  // Pure black layer overlay with varying opacity
  gl_FragColor = vec4(0.015, 0.015, 0.015, finalOpacity);
}
