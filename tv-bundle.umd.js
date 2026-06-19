(function(se,he){typeof exports=="object"&&typeof module<"u"?he(require("three"),require("three/examples/jsm/loaders/GLTFLoader.js")):typeof define=="function"&&define.amd?define(["three","three/examples/jsm/loaders/GLTFLoader.js"],he):(se=typeof globalThis<"u"?globalThis:se||self,he(se.THREE,se.THREE))})(this,function(se,he){"use strict";function Rt(e){const n=Object.create(null,{[Symbol.toStringTag]:{value:"Module"}});if(e){for(const t in e)if(t!=="default"){const i=Object.getOwnPropertyDescriptor(e,t);Object.defineProperty(n,t,i.get?i:{enumerable:!0,get:()=>e[t]})}}return n.default=e,Object.freeze(n)}const m=Rt(se),kt=`varying vec2 vUv;
varying float vFogDepth;
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
  
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vFogDepth = -mvPosition.z;
}
`,At=`uniform float uTime;
uniform sampler2D uTexture;
uniform sampler2D uTextureChild;
uniform sampler2D uTextureText;
uniform float uChildVisibility;
uniform vec2 uMagneticCenter;
uniform float uMagneticTime;
uniform float uMagneticIntensity;
uniform float uMagneticBuildup;
uniform vec2 uMagneticVelocity;
uniform int uFilterMode;
uniform vec3 uFilterColor;
uniform float uScaleX;
uniform float uScaleY;
uniform float uIsVideo;
uniform float uPowerOff;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;
varying float vFogDepth;

// ─────────────────────────────────────────────
// NOISE UTILITIES
// ─────────────────────────────────────────────

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Smooth noise (value noise)
float smoothNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
    mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x),
    u.y
  );
}

// FBM — fractal brownian motion (layered smooth noise)
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * smoothNoise(p);
    p  = p * 2.1 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;

  // ─────────────────────────────────────────────
  // STEP 1. BARREL / PINCUSHION CRT DISTORTION
  // The actual CRT tube bends the image inward at edges
  // ─────────────────────────────────────────────
  vec2 cuv = uv * 2.0 - 1.0;
  float barrel = 0.07;
  cuv *= 1.0 + barrel * dot(cuv, cuv);
  uv = cuv * 0.5 + 0.5;

  // ─────────────────────────────────────────────
  // STEP 1.5. INTERACTIVE MAGNETIC DISTORTION (Click / Hold effect)
  // ─────────────────────────────────────────────
  if (uMagneticIntensity > 0.0) {
    float mDist = distance(vUv, uMagneticCenter);
    float waveSpeed = 2.6;
    float waveFront = mod(uMagneticTime * waveSpeed, 2.0);
    float waveWidth = 0.24 + uMagneticBuildup * 0.10;

    float buildupBoost = 1.0 + uMagneticBuildup * 5.5;

    float distFromFront = mDist - waveFront;
    if (abs(distFromFront) < waveWidth) {
      float normDist = distFromFront / waveWidth;
      float waveEnvelope = cos(normDist * 3.14159265 * 0.5);
      waveEnvelope = waveEnvelope * waveEnvelope;

      float waveOffset = sin(mDist * 55.0 - uMagneticTime * 35.0) * 0.022 * uMagneticIntensity * waveEnvelope * buildupBoost;

      vec2 mDir = normalize(vUv - uMagneticCenter + vec2(0.0001));
      vec2 mPerp = vec2(-mDir.y, mDir.x);

      uv += mDir * waveOffset;
      uv += mPerp * waveOffset * 0.65;

      float fineStatic  = (hash(vec2(floor(vUv.y * 300.0), uTime * 4.0)) - 0.5) * 0.038 * uMagneticIntensity * waveEnvelope * buildupBoost;
      float fineStaticY = (hash(vec2(floor(vUv.x * 300.0), uTime * 4.0 + 1.7)) - 0.5) * 0.028 * uMagneticIntensity * waveEnvelope * buildupBoost;
      uv.x += fineStatic;
      uv.y += fineStaticY;
    }
  }

  if (uMagneticIntensity > 0.0) {
    float velLen = length(uMagneticVelocity);
    if (velLen > 0.001) {
      float velEffect = min(velLen, 1.0) * uMagneticIntensity;
      uv += uMagneticVelocity * velEffect * 0.055;
      float hSmear = (hash(vec2(floor(vUv.y * 180.0), uTime * 5.0)) - 0.5) * velEffect * 0.07;
      uv.x += hSmear;
    }
  }

  // Kill pixels outside the barrel-distorted frame
  float inFrame = step(0.0, uv.x) * step(uv.x, 1.0) *
                  step(0.0, uv.y) * step(uv.y, 1.0);

  // ─────────────────────────────────────────────
  // STEP 2. SIGNAL WIDE WARP — constant horizontal turbulence
  // The whole image breathes and warps slightly, always
  // ─────────────────────────────────────────────
  float warpY   = fbm(vec2(uv.y * 3.5, uTime * 0.18)) - 0.5;
  float warpTime = sin(uTime * 0.43) * 0.5 + 0.5;
  uv.x += warpY * 0.009 * warpTime;

  // ─────────────────────────────────────────────
  // STEP 3. VHS TRACKING DAMAGE
  // Horizontal displacement bands that appear especially at top/bottom
  // ─────────────────────────────────────────────

  // Slow rolling tracking band (VHS head mis-alignment)
  float trackBandY = fract(uTime * -0.055);
  float distToTrack = abs(uv.y - trackBandY);
  if (distToTrack > 0.5) distToTrack = 1.0 - distToTrack;
  float trackStrength = exp(-pow(distToTrack * 7.0, 2.0));

  // The band itself displaces horizontal + adds tear
  float trackShift = (hash(vec2(uv.y * 80.0, uTime * 1.1)) - 0.5) * 0.032 * trackStrength;
  uv.x += trackShift;

  // Top-of-frame tearing (VHS heads lose sync at extremes)
  float topTear = smoothstep(0.94, 1.0, uv.y) + smoothstep(0.06, 0.0, uv.y);
  uv.x += (hash(vec2(floor(uv.y * 120.0), uTime * 3.0)) - 0.5) * 0.045 * topTear;

  // ─────────────────────────────────────────────
  // STEP 4. HORIZONTAL JITTER (1-3px live vibration)
  // ─────────────────────────────────────────────
  float jitterSpeed  = hash(vec2(floor(uTime * 18.0), 0.0));
  float jitterAmount = mix(0.001, 0.004, jitterSpeed);
  float jitterWave   = sin(uv.y * 220.0 + uTime * 14.0) * jitterAmount;
  uv.x += jitterWave;

  // ─────────────────────────────────────────────
  // STEP 5. GLITCH LINES (random horizontal tear events)
  // ─────────────────────────────────────────────
  float glitchRand = hash(vec2(0.0, floor(uv.y * 200.0)) + floor(uTime * 22.0));
  if (glitchRand > 0.978) {
    uv.x += (hash(vec2(uv.y, uTime * 5.0)) - 0.5) * 0.03;
  }

  // ─────────────────────────────────────────────
  // STEP 6. ASPECT RATIO CORRECTION
  // ─────────────────────────────────────────────
  vec2 texUv = vec2((uv.x - 0.5) * uScaleX + 0.5, (uv.y - 0.5) * uScaleY + 0.5);

  // Border clamping
  float inTex = step(0.0, texUv.x) * step(texUv.x, 1.0) * step(0.0, texUv.y) * step(texUv.y, 1.0);

  // ─────────────────────────────────────────────
  // STEP 7. CHROMA BLEED — RGB split (1-2px chromatic aberration)
  // Colors misalign along edges — very analog VHS characteristic
  // ─────────────────────────────────────────────
  float chromaTime = uTime * 0.07;
  float chromaWave = sin(uv.y * 180.0 + chromaTime) * 0.0012
                   + fbm(vec2(uv.y * 2.0, chromaTime)) * 0.006;
  vec2 chromaShiftR = vec2( chromaWave, 0.0);
  vec2 chromaShiftB = vec2(-chromaWave, 0.0);

  vec2 texUvR = clamp(texUv + chromaShiftR, 0.0, 1.0);
  vec2 texUvG = clamp(texUv, 0.0, 1.0);
  vec2 texUvB = clamp(texUv + chromaShiftB, 0.0, 1.0);

  // Sample R, G, B channels independently
  vec4 texR = vec4(0.0);
  vec4 texG = vec4(0.0);
  vec4 texB = vec4(0.0);
  if (inTex > 0.5) {
    texR = texture2D(uTexture, texUvR);
    texG = texture2D(uTexture, texUvG);
    texB = texture2D(uTexture, texUvB);
  }
  vec4 texColor = vec4(texR.r, texG.g, texB.b, texG.a);

  float childMaskVal = 0.0;
  float childLumaVal = 0.0;

  // Blend the child silhouette over the father image's face vortex
  // Shrunk coordinates shifted higher up (Y+) to fit beautifully inside the vortex
  vec2 childMin = vec2(0.4556, 0.567);
  vec2 childMax = vec2(0.5444, 0.743);
  if (texUv.x >= childMin.x && texUv.x <= childMax.x &&
      texUv.y >= childMin.y && texUv.y <= childMax.y) {
    vec2 childUv = (texUv - childMin) / (childMax - childMin);
    vec4 childColor = texture2D(uTextureChild, childUv);
    childMaskVal = childColor.a * 0.82 * uChildVisibility;
    childLumaVal = dot(childColor.rgb * 5.0, vec3(0.299, 0.587, 0.114));
    texColor.a = max(texColor.a, childColor.a * 0.82 * uChildVisibility);
  }

  // ─────────────────────────────────────────────
  // STEP 8. GHOSTING — double exposure, offset ~4px horizontal
  // Duplicated image at 10-20% opacity creates analog drag artifact
  // ─────────────────────────────────────────────
  vec2 ghostOffset = vec2(0.013, 0.0);
  vec2 ghostUv = clamp(texUv - ghostOffset, 0.0, 1.0);
  vec4 ghostColor = vec4(0.0);
  if (inTex > 0.5) ghostColor = texture2D(uTexture, ghostUv);
  texColor.rgb = mix(texColor.rgb, ghostColor.rgb, 0.14);

  // ─────────────────────────────────────────────
  // STEP 9. DESATURATE + LIFT BLACKS + MATCH PHOSPHOR HUE
  // CRT+VHS destroys color. Crucially: push the image INTO
  // the same color space as the phosphor background so the
  // figure feels like it materializes FROM the screen, not
  // like it's pasted ON TOP of it.
  // ─────────────────────────────────────────────

  // Desaturate heavily (near monochrome)
  float luma = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
  if (uIsVideo > 0.5) {
    // Preserve video colors: 85% original color saturation, less black lift, very subtle phosphor hue tint
    texColor.rgb = mix(vec3(luma), texColor.rgb, 0.85);
    texColor.rgb = texColor.rgb * 0.90 + 0.05;
    vec3 phosphorHue = vec3(0.68, 0.73, 0.90);
    texColor.rgb = mix(texColor.rgb, texColor.rgb * phosphorHue * 1.10, 0.15);
  } else {
    texColor.rgb = mix(vec3(luma), texColor.rgb, 0.12);
    // Lift blacks — no pure black in VHS/CRT
    texColor.rgb = texColor.rgb * 0.75 + 0.10;
    // Force image hue to match exactly the phosphor screen color palette.
    // Instead of a generic cold tint, tint toward the actual phosphorBase hue
    // so figure and background live in the same color space.
    vec3 phosphorHue = vec3(0.68, 0.73, 0.90); // same as phosphorBase hue
    // Mix image toward phosphor hue: 70% phosphor hue color weighting
    texColor.rgb = mix(texColor.rgb, texColor.rgb * phosphorHue * 1.15, 0.75);
  }

  // ─────────────────────────────────────────────
  // STEP 10. MACROBLOCKING + POSTERIZATION
  // Digital compression on top of analog — dirty texture blocks
  // ─────────────────────────────────────────────
  float blockSize = 38.0;
  vec2 blockUv = floor(texUv * blockSize) / blockSize;
  float blockNoise = hash(blockUv + floor(uTime * 0.9)) * 0.04;
  float posterSteps = 10.0;
  texColor.rgb = floor(texColor.rgb * posterSteps + blockNoise) / posterSteps;

  // ─────────────────────────────────────────────
  // STEP 11. EDGE FEATHERING (no hard cut)
  // ─────────────────────────────────────────────
  float fadeX = smoothstep(0.0, 0.13, texUv.x) * smoothstep(1.0, 0.87, texUv.x);
  float fadeY = smoothstep(0.0, 0.04, texUv.y) * smoothstep(1.0, 0.96, texUv.y);
  float texAlpha = texColor.a * fadeX * fadeY;

  // ─────────────────────────────────────────────
  // STEP 12. PHOSPHOR BACKGROUND — cold grey-blue static field
  // The CRT beam paints the screen with this
  // ─────────────────────────────────────────────

  // Multi-layer luma noise: fine + coarse + FBM blobs
  float fineNoise   = hash(uv + sin(uTime * 31.0));
  vec2  coarseUv    = floor(uv * 90.0) / 90.0;
  float coarseNoise = hash(coarseUv + sin(uTime * 11.0));
  float blobNoise   = fbm(uv * 4.0 + uTime * 0.12);
  float lumaNoise   = fineNoise * 0.45 + coarseNoise * 0.35 + blobNoise * 0.20;
  if (uIsVideo > 0.5) {
    // Make noise much more subtle when video is active
    lumaNoise       = lumaNoise * 0.15 + 0.85; 
  } else {
    lumaNoise       = lumaNoise * 0.55 + 0.25; // lifted — no pure black
  }

  vec3 phosphorBase = vec3(0.68, 0.73, 0.90) * lumaNoise;

  // ─────────────────────────────────────────────
  // STEP 13. STATIC INTEGRATED + LUMINANCE COMPOSITING
  // The figure is composited by LUMINANCE only — it modulates
  // the phosphor base brightness rather than replacing its color.
  // This makes the figure feel like it's EMERGING from the CRT
  // phosphor field, sharing the exact same hue and grain.
  // ─────────────────────────────────────────────

  // Blend static noise INTO the father image multiplicatively
  vec3 imageWithStatic = texColor.rgb * (lumaNoise * 0.55 + 0.55);

  // Extract just the brightness of the father image...
  float imageLuma = dot(imageWithStatic, vec3(0.299, 0.587, 0.114));

  // Father keeps the gamma boost (0.42 power curve) to recover shadow details
  float fatherLumaBoosted = pow(imageLuma, 0.42);

  // Child bypasses the gamma boost completely (linear, power of 1.0)
  float childLumaWithStatic = childLumaVal * (lumaNoise * 0.55 + 0.55);

  // Combine the father's boosted luma with the child's linear luma using the child mask
  float recoveredLuma = mix(fatherLumaBoosted, childLumaWithStatic, childMaskVal);

  // ...and use it to brighten/darken the phosphor base color.
  // The figure NEVER introduces its own color — it only changes how bright the phosphor shines.
  vec3 figureAsPhosphor;
  if (uIsVideo > 0.5) {
    // When video is active, blend the actual video colors with phosphor Base
    figureAsPhosphor = mix(texColor.rgb * 1.35, phosphorBase * (recoveredLuma * 1.5), 0.12);
  } else {
    figureAsPhosphor = phosphorBase * (recoveredLuma * 5.2 + 0.25);
  }

  // Soft alpha: edges dissolve into nothing very gently
  float softAlpha = texAlpha * texAlpha; // quadratic — very fast falloff at edges

  // Final composite: figure = phosphor brightness modulation
  vec3 screenContent = mix(phosphorBase, figureAsPhosphor, softAlpha * 0.95);

  if (uPowerOff > 0.5) {
    screenContent = vec3(0.0);
  }

  // ─────────────────────────────────────────────
  // STEP 13.5. PHOSPHORESCENT GREEN TEXT OVERLAY (top-left screen mapping with chroma aberration)
  // ─────────────────────────────────────────────
  vec2 txtUvR = clamp(uv + chromaShiftR, 0.0, 1.0);
  vec2 txtUvG = clamp(uv, 0.0, 1.0);
  vec2 txtUvB = clamp(uv + chromaShiftB, 0.0, 1.0);
  
  float txtA_R = texture2D(uTextureText, txtUvR).a;
  float txtA_G = texture2D(uTextureText, txtUvG).a;
  float txtA_B = texture2D(uTextureText, txtUvB).a;
  
  if (txtA_R > 0.01 || txtA_G > 0.01 || txtA_B > 0.01) {
    vec3 textPhosphor = vec3(0.22, 1.0, 0.08) * (lumaNoise * 0.45 + 0.75) * 5.0;
    vec3 textCol = vec3(
      textPhosphor.r * txtA_R,
      textPhosphor.g * txtA_G,
      textPhosphor.b * txtA_B
    );
    float textAlpha = max(max(txtA_R, txtA_G), txtA_B);
    screenContent = mix(screenContent, textCol, textAlpha * inFrame);
  }

  // ─────────────────────────────────────────────
  // STEP 14. IRREGULAR SCANLINES
  // Variable opacity, variable thickness, small breaks
  // ─────────────────────────────────────────────
  float lineY    = uv.y * 280.0;
  float lineBase = sin(lineY) * 0.5 + 0.5; // 0-1 scanline
  // Vary opacity per line randomly
  float lineRand = hash(vec2(floor(lineY), floor(uTime * 2.5)));
  float lineOpa  = mix(0.06, 0.20, lineRand);
  // Occasional dark lines (line dropouts)
  float dropout  = step(0.97, hash(vec2(floor(lineY * 0.5), uTime * 0.3)));
  float scanline = 1.0 - lineBase * lineOpa - dropout * 0.15;
  scanline = clamp(scanline, 0.0, 1.0);

  screenContent *= scanline;

  // ─────────────────────────────────────────────
  // STEP 15. PHOSPHOR HORIZONTAL BLEEDING
  // Bright areas melt horizontally (CRT highlight bleed)
  // Done analytically: sample brightness and spread
  // ─────────────────────────────────────────────
  float lumaScreen = dot(screenContent, vec3(0.299, 0.587, 0.114));
  float bleedAmt   = smoothstep(0.5, 0.9, lumaScreen) * 0.025;
  // Approximate blur by sampling left+right neighbors (4 taps)
  vec2 bleedStep = vec2(bleedAmt, 0.0);
  vec4 bleedL1 = (inTex > 0.5) ? texture2D(uTexture, clamp(texUv - bleedStep, 0.0, 1.0))       : vec4(0.0);
  vec4 bleedR1 = (inTex > 0.5) ? texture2D(uTexture, clamp(texUv + bleedStep, 0.0, 1.0))       : vec4(0.0);
  vec4 bleedL2 = (inTex > 0.5) ? texture2D(uTexture, clamp(texUv - bleedStep * 2.0, 0.0, 1.0)) : vec4(0.0);
  vec4 bleedR2 = (inTex > 0.5) ? texture2D(uTexture, clamp(texUv + bleedStep * 2.0, 0.0, 1.0)) : vec4(0.0);
  float bleedLuma = dot((bleedL1.rgb + bleedR1.rgb + bleedL2.rgb + bleedR2.rgb) / 4.0, vec3(0.299, 0.587, 0.114));
  screenContent += vec3(bleedLuma * 0.07 * smoothstep(0.4, 1.0, lumaScreen));

  // ─────────────────────────────────────────────
  // STEP 16. INTERNAL PHOSPHOR GLOW (horizontal bloom)
  // Not modern post-process bloom — soft horizontal haze
  // ─────────────────────────────────────────────
  float glowLuma = dot(screenContent, vec3(0.299, 0.587, 0.114));
  vec3  glowColor = vec3(0.70, 0.80, 1.0) * glowLuma * glowLuma * 0.18;
  screenContent += glowColor;

  // ─────────────────────────────────────────────
  // STEP 17. CRT VIGNETTE — strong corner darkening
  // Center bright, edges dark — exactly like a real tube
  // ─────────────────────────────────────────────
  vec2  vigUv    = uv * 2.0 - 1.0;
  float vignette = 1.0 - dot(vigUv * vec2(0.9, 1.1), vigUv * vec2(0.9, 1.1)) * 0.55;
  vignette = clamp(pow(vignette, 1.6), 0.0, 1.0);
  screenContent *= vignette;

  // ─────────────────────────────────────────────
  // STEP 18. IRREGULAR FLICKER — breathing, not metronome
  // Uses multiple sin at odd frequencies so it never repeats predictably
  // ─────────────────────────────────────────────
  float f1 = sin(uTime * 47.3) * 0.012;
  float f2 = sin(uTime * 11.7 + 1.3) * 0.018;
  float f3 = sin(uTime * 3.1  + 2.9) * 0.025; // slow breath
  // Occasional partial blackout
  float blackout = smoothstep(0.96, 1.0, hash(vec2(floor(uTime * 4.0), 3.7))) * 0.25;
  float flicker  = 1.0 + f1 + f2 + f3 - blackout;
  screenContent *= flicker;

  // ─────────────────────────────────────────────
  // STEP 19. V-SYNC ROLLING BAR
  // ─────────────────────────────────────────────
  float barPos     = fract(uTime * -0.07);
  float distToBar  = abs(uv.y - barPos);
  if (distToBar > 0.5) distToBar = 1.0 - distToBar;
  float rollingBar = exp(-pow(distToBar * 8.0, 2.0));
  screenContent += vec3(0.88, 0.92, 1.0) * rollingBar * 0.30 * vignette;

  // ─────────────────────────────────────────────
  // STEP 20. DISTORTION "NEAR DEATH" — signal almost lost
  // Occasional full-frame signal loss stripes
  // ─────────────────────────────────────────────
  float sigLoss = step(0.993, hash(vec2(floor(uTime * 1.7), floor(uv.y * 40.0))));
  screenContent = mix(screenContent, vec3(lumaNoise * 0.3), sigLoss * 0.6);

  // ─────────────────────────────────────────────
  // STEP 21. MAGNETIC RAINBOW GLITCH (buildup hold effect)
  // ─────────────────────────────────────────────
  if (uMagneticBuildup > 0.12 && uMagneticIntensity > 0.0) {
    float rDist    = distance(vUv, uMagneticCenter);
    float rFront   = mod(uMagneticTime * 2.6, 2.0);
    float rWidth   = 0.30 + uMagneticBuildup * 0.12;
    float rFromFront = rDist - rFront;

    if (abs(rFromFront) < rWidth) {
      float rNorm = rFromFront / rWidth;
      float rEnv  = cos(rNorm * 3.14159265 * 0.5);
      rEnv = rEnv * rEnv;

      vec2 rDir = normalize(vUv - uMagneticCenter + vec2(0.0001));
      float angle = atan(rDir.y, rDir.x) / 6.2831853 + 0.5;

      float h  = fract(angle * 2.5 + rDist * 4.0 - uMagneticTime * 1.8);
      float ri = clamp(abs(h * 6.0 - 3.0) - 1.0, 0.0, 1.0);
      float gi = clamp(2.0 - abs(h * 6.0 - 2.0), 0.0, 1.0);
      float bi = clamp(2.0 - abs(h * 6.0 - 4.0), 0.0, 1.0);
      vec3 rainbow = vec3(ri, gi, bi) * (lumaNoise * 0.35 + 0.72);

      float buildupFactor  = smoothstep(0.12, 0.75, uMagneticBuildup);
      float rainbowStrength = buildupFactor * rEnv * uMagneticIntensity * 0.92;
      screenContent = mix(screenContent, rainbow, clamp(rainbowStrength, 0.0, 0.9));
    }
  }

  // ─────────────────────────────────────────────
  // STEP 22. COLOR FILTER (GREEN, RED, YELLOW, RAINBOW, CUSTOM TINT)
  // ─────────────────────────────────────────────
  if (uFilterMode == 1) {
    // Green
    float screenLuma = dot(screenContent, vec3(0.299, 0.587, 0.114));
    screenContent = vec3(screenLuma) * vec3(0.22, 1.0, 0.08) * 1.35;
  } else if (uFilterMode == 2) {
    // Red
    float screenLuma = dot(screenContent, vec3(0.299, 0.587, 0.114));
    screenContent = vec3(screenLuma) * vec3(1.0, 0.15, 0.15) * 1.35;
  } else if (uFilterMode == 3) {
    // Yellow
    float screenLuma = dot(screenContent, vec3(0.299, 0.587, 0.114));
    screenContent = vec3(screenLuma) * vec3(1.0, 0.82, 0.0) * 1.35;
  } else if (uFilterMode == 4) {
    // Rainbow
    float h = fract(uv.x * 0.5 + uv.y * 0.5 - uTime * 0.15);
    float r = clamp(abs(h * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    float g = clamp(2.0 - abs(h * 6.0 - 2.0), 0.0, 1.0);
    float b = clamp(2.0 - abs(h * 6.0 - 4.0), 0.0, 1.0);
    vec3 rainbowColor = vec3(r, g, b);
    float screenLuma = dot(screenContent, vec3(0.299, 0.587, 0.114));
    screenContent = vec3(screenLuma) * rainbowColor * 1.5;
  } else if (uFilterMode == 5) {
    // Custom Color Tint
    float screenLuma = dot(screenContent, vec3(0.299, 0.587, 0.114));
    screenContent = vec3(screenLuma) * uFilterColor * 1.35;
  }

  // ─────────────────────────────────────────────
  // KILL outside barrel frame
  // ─────────────────────────────────────────────
  screenContent *= inFrame;

  // Apply distance-based depth fog (capped to 0.95 so the screen almost completely disappears)
  float fogFactor = clamp((vFogDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 0.95);
  screenContent = mix(screenContent * 1.5, uFogColor, fogFactor);

  gl_FragColor = vec4(screenContent, 1.0);
}
`;document.getElementById("loading-splash");const ct=document.getElementById("loading-bar-fill"),ut=document.getElementById("loading-text");let D={scene:10,overlay:5,lights:5,particles:10,texture1:0,texture2:0,model:0};function Ft(e,n){const t=Math.min(Math.max(Math.round(e),0),100);ct&&(ct.style.width=`${t}%`),n&&ut&&(ut.textContent=n)}function Ie(e,n){D[e]=n;const t=Math.min(D.scene+D.overlay+D.lights+D.particles+D.texture1+D.texture2+D.model,100);let i="Cargando...";t<30?i="Preparando escena...":D.model<50?i=`Cargando modelo 3D... ${Math.round(D.model/50*100)}%`:D.texture1<10||D.texture2<10?i="Cargando texturas...":i="Listo.",Ft(t,i)}function Re(e){const n="kw";let t="";for(let i=0;i<e.length;i+=2){const d=parseInt(e.substring(i,i+2),16),a=n.charCodeAt(i/2%n.length);t+=String.fromCharCode(d^a)}return t}const P={mode:"default",slideshow:{images:[],slideDuration:12,transitionDuration:.45}};let X=null,ie=null,z=null;const dt={};let ft=80,pe=null,o=null,A=null,T=null,S=null,I=null,C="",_="idle",q=0,ge="#ffffff",ce="center",ue=1e3;const ye=new m.Color(11196671),He=document.createElement("canvas");He.width=1,He.height=1;const mt=He.getContext("2d",{willReadFrequently:!0});let U=!1,R=null,V=null,vt=0,W=null,de=null,G=null,ke=0,Ae=null,ht=3,pt=5,gt=5,O=null;const Pt=()=>window.location.hostname==="localhost"||window.location.hostname==="127.0.0.1"?"ws://localhost:8088":"wss://kimeraware.macrostasis.dev/ws",Fe=e=>window.location.hostname==="localhost"||window.location.hostname==="127.0.0.1"?e:`https://kimeraware.macrostasis.dev${e}`,yt=e=>{const n=window.location.hostname;return n==="localhost"||n==="127.0.0.1"||n.includes("macrostasis.dev")?e:`https://kimeraware.macrostasis.dev${e}`},_e=e=>{if(!e)return e;let n=e;if(e.includes("/assets/")){const t=e.substring(e.indexOf("/assets/"));n=yt(t)}if((n.startsWith("http://")||n.startsWith("https://"))&&!n.includes("/api/yt-proxy")){const t=window.location.hostname;let i=!0;if(t==="localhost"||t==="127.0.0.1")try{const d=new URL(e);(d.hostname==="localhost"||d.hostname==="127.0.0.1")&&(i=!1)}catch{}(n.includes("local=true")||n.includes("/assets/")||n.includes("assets/")||n.includes("piped")||n.includes("cobalt")||n.includes("invidious")||n.includes("yewtu.be")||n.includes("nadeko.net"))&&(i=!1),i&&(n=Fe(`/api/yt-proxy?url=${encodeURIComponent(n)}`))}return n+=(n.includes("?")?"&":"?")+"t_cb="+Date.now(),n};function xe(e){return new Promise((n,t)=>{const i=new Image;i.onload=()=>{const a=new m.Texture(i);a.colorSpace=m.SRGBColorSpace,a.minFilter=m.LinearFilter,a.generateMipmaps=!1,a.needsUpdate=!0,n(a)},i.onerror=a=>{t(a)};let d=e;if(e&&e.includes("/assets/")){const a=e.substring(e.indexOf("/assets/"));d=yt(a)}d&&(d.startsWith("http://")||d.startsWith("https://"))&&(i.crossOrigin="anonymous"),i.src=d})}async function Te(e){P.mode=e.mode||"default",C=e.text||"",ce=e.textPosition||"center",Se=null,Ce=null,ht=e.minDuration||3,pt=e.maxDuration||5,gt=e.frequencyPerMinute||5,$e=-1;const n={default:0,green:1,red:2,yellow:3,rainbow:4,custom:5},t=e.filterMode||"default";q=n[t]!==void 0?n[t]:0,ge=e.filterColor||"#ffffff";const i=e.videoUrl||"",d=typeof e.videoLoop<"u"?e.videoLoop:!0,a=typeof e.videoAudio<"u"?e.videoAudio:!0;if(P.mode==="video"?tt(i,d,a):tt(null,!1,!1),e.mainImageData){const c=I;I=await xe(e.mainImageData),P.mode==="custom_image"?_="custom_image":_="idle",c&&c.dispose()}else _="idle",I&&I.dispose(),I=null;if(e.childImageData){const c=ie;ie=await xe(e.childImageData),c&&c!==X&&c!==Ae&&c.dispose()}else ie=Ae||X}let xt=0;function Tt(e,n){if(!o||o.paused||!e)return;if(o.readyState<3){console.log(`[Sync] Skipping sync: Video is buffering/loading (readyState: ${o.readyState})`);return}if((!n||n===1/0||!isFinite(n))&&(o.duration===1/0||!isFinite(o.duration)))return;let i=(Date.now()-e)/1e3;const d=n||1/0;if(i<0||i>=d)return;o.duration&&o.loop&&(i=i%o.duration);const a=Math.abs(o.currentTime-i),c=o.currentTime<8?2:.8;if(a>c){const s=Date.now();if(s-xt<6e3){console.log(`[Sync] Drift detected (${a.toFixed(2)}s) but throttling seek to let Hls.js buffer...`);return}let r=!1;try{const l=o.buffered;for(let u=0;u<l.length;u++)if(i>=l.start(u)&&i<=l.end(u)){r=!0;break}}catch{}if(!r&&a<4){console.log(`[Sync] Drift of ${a.toFixed(2)}s detected, but target position ${i.toFixed(2)}s is not in buffer yet. Waiting for Hls.js buffering...`);return}console.log(`[Sync] Correcting drift of ${a.toFixed(2)}s (threshold: ${c}s) — seeking to ${i.toFixed(2)}s`),xt=s,o.currentTime=i}}function be(){if(!o)return;let e=ft;U&&pe!==null&&(e=pe);const n=e/100;o.volume=n,console.log(`[Volume] Applied volume to video element: ${n} (${e}%)`)}function bt(){de&&clearInterval(de),de=setInterval(()=>{if(!U||!W){Pe();return}Tt(W.startTime,W.originalDuration)},2e3)}function Pe(){de&&(clearInterval(de),de=null)}let Ue=null;async function Ut(){if(Ue)return Ue;const e="75,87,95,65,82,71",n=new Uint8Array(e.split(",").map(Number)),t=new TextEncoder().encode("kimeraware-ws-2025"),i=await crypto.subtle.importKey("raw",n,{name:"HMAC",hash:"SHA-256"},!1,["sign"]),d=await crypto.subtle.sign("HMAC",i,t);return Ue=await crypto.subtle.importKey("raw",d,{name:"AES-GCM"},!1,["decrypt"]),Ue}async function Nt(e){try{if((typeof crypto>"u"||!crypto.subtle)&&typeof window<"u"&&typeof window.decryptWsMessageFallback=="function")return window.decryptWsMessageFallback(e);const n=Uint8Array.from(atob(e),r=>r.charCodeAt(0)),t=n.slice(0,12),i=n.slice(12,28),d=n.slice(28),a=new Uint8Array(d.length+16);a.set(d),a.set(i,d.length);const c=await Ut(),s=await crypto.subtle.decrypt({name:"AES-GCM",iv:t},c,a);return JSON.parse(new TextDecoder().decode(s))}catch(n){try{return JSON.parse(e)}catch{throw n}}}function We(){const e=Pt();S=new WebSocket(e),S.onopen=()=>{console.log("Connected to KimeraWare Event Server"),ue=1e3},S.onmessage=async t=>{try{const i=await Nt(t.data);console.log("WS Event received:",i.type),await n(i)}catch(i){console.error("Error handling WS event:",i)}finally{O&&(O(),O=null)}};async function n(t){if(Se=null,Ce=null,t.type==="apply_preset"){if(V=t,t.textPosition&&(ce=t.textPosition),U){console.log("Immediate video is active. Storing preset for later restoration.");return}await Te(t)}if(t.type==="trigger_video"){console.log("WS Event received: trigger_video",t),ke=0,U||V||(V={type:"apply_preset",presetId:"default",mode:"default",text:"",filterMode:"default",filterColor:"#ffffff",videoUrl:"",videoLoop:!0,videoAudio:!0,minDuration:2,maxDuration:4,frequencyPerMinute:3,mainImageData:null,childImageData:null});const i=parseFloat(t.originalDuration)||parseFloat(t.duration)||30,d=parseFloat(t.duration)||30;pe=t.videoVolume!==void 0?t.videoVolume:null;let a=0;if(t.startTime?a=Math.max(0,(Date.now()-t.startTime)/1e3):a=Math.max(0,i-d),a>=i){console.log(`Video override already expired (${a.toFixed(1)}s / ${i}s). Skipping.`);return}const c=Date.now()-t.startTime<5e3,s=performance.now(),r=++vt;let l=t.videoUrl||"";const u=Ct(l);if(u){console.log("Resolving general YouTube ID for immediate video:",u);try{l=await Mt(u)}catch(b){console.error("Failed to resolve stream for immediate video:",b),_="idle",C="";return}}if(r!==vt){console.log("Immediate video trigger superseded by a newer request.");return}T&&(T.destroy(),T=null),o&&(o.pause(),o.removeAttribute("src"),o.load());let h=!1;o||(o=document.createElement("video"),o.preload="auto",o.playsInline=!0,o.webkitPlaysInline=!0,o.crossOrigin="anonymous",h=!0),o.loop=typeof t.videoLoop<"u"?t.videoLoop:!0,o.muted=typeof t.videoAudio<"u"?!t.videoAudio:!0,o.dataset.shouldPlayAudio=typeof t.videoAudio<"u"?!!t.videoAudio:!0;const y=b=>{const p=o.error;if(console.error("[Video Error] Playback error occurred:",p),S&&S.readyState===WebSocket.OPEN)try{S.send(JSON.stringify({type:"video_error",videoUrl:t.videoUrl||l,errorCode:p?p.code:"unknown",errorMessage:p?p.message:"Playback error event fired"}))}catch{}U&&ke<3&&(ke++,console.log(`[Video Recovery] Attempting autonomous recovery (attempt ${ke}/3)...`),setTimeout(async()=>{try{T&&(T.destroy(),T=null),o.pause(),o.removeAttribute("src"),o.load();const N=_e(l);N.includes(".m3u8")&&typeof Hls<"u"?Hls.isSupported()&&(T=new Hls({maxBufferLength:8,maxMaxBufferLength:12,enableWorker:!0,lowLatencyMode:!0}),T.attachMedia(o),T.loadSource(N)):(o.src=N,o.load());const te=t.startTime?Math.max(0,(Date.now()-t.startTime)/1e3):o.currentTime||0;if(te>0&&te<i){const oe=()=>{o.currentTime=te,console.log(`[Video Recovery] Seeked to drift-corrected position: ${te.toFixed(2)}s`)};o.addEventListener("loadedmetadata",oe,{once:!0}),o.addEventListener("canplay",oe,{once:!0})}await o.play(),console.log("[Video Recovery] Autonomous recovery successfully resumed playback.")}catch(N){console.error("[Video Recovery] Autonomous recovery attempt failed:",N)}},1500))};o.removeEventListener("error",o._errHandler),o._errHandler=y,o.addEventListener("error",o._errHandler);let v=!1;const x=()=>{if(!v&&(v=!0,!c)){const b=(performance.now()-s)/1e3,p=t.startTime?Math.max(0,(Date.now()-t.startTime)/1e3):a+b;(i===1/0||!isFinite(i))&&(o.duration===1/0||!isFinite(o.duration))?console.log("[Seek] Live stream detected. Skipping initial seek to remain at the live edge."):p>0&&p<i&&(console.log(`[Seek] Jumping to ${p.toFixed(2)}s (load delay: ${b.toFixed(2)}s)`),o.currentTime=p)}};o.addEventListener("loadedmetadata",x,{once:!0}),o.addEventListener("canplay",x,{once:!0}),o.crossOrigin="anonymous";const g=_e(l);if(g.includes(".m3u8")&&typeof Hls<"u"?Hls.isSupported()?(T=new Hls({maxBufferLength:8,maxMaxBufferLength:12,enableWorker:!0,lowLatencyMode:!0}),T.attachMedia(o),T.loadSource(g),T.on(Hls.Events.MANIFEST_PARSED,()=>{console.log("[HLS.js WS] Manifest loaded, playing...")}),T.on(Hls.Events.ERROR,(b,p)=>{if(p.fatal)switch(p.type){case Hls.ErrorTypes.NETWORK_ERROR:console.warn("[HLS.js WS] Network error, attempting recovery...",p),T.startLoad();break;case Hls.ErrorTypes.MEDIA_ERROR:console.warn("[HLS.js WS] Media error, attempting recovery...",p),T.recoverMediaError();break;default:if(console.error("[HLS.js WS] Unrecoverable error",p),S&&S.readyState===WebSocket.OPEN)try{S.send(JSON.stringify({type:"video_error",videoUrl:t.videoUrl||l,errorCode:"HLS_FATAL_"+p.details,errorMessage:"HLS.js unrecoverable error: "+p.type}))}catch{}break}})):o.canPlayType("application/vnd.apple.mpegurl")&&(o.src=g,o.load()):(o.src=g,o.load()),o.loop||o.addEventListener("ended",async()=>{console.log("Immediate video ended naturally. Reverting to active preset locally."),U=!1,R&&(clearTimeout(R),R=null),G&&(clearInterval(G),G=null),V&&await Te(V)}),h)try{et(o)}catch(b){console.error("Audio filter setup failed:",b)}A||(A=new m.VideoTexture(o),A.colorSpace=m.SRGBColorSpace,A.minFilter=m.LinearFilter,A.generateMipmaps=!1);const f=()=>{_="idle",U=!0,P.mode="video",C=t.text||"",ce=t.textPosition||"center",R&&clearTimeout(R),G&&clearInterval(G),G=setInterval(()=>{if(!U||!o){clearInterval(G),G=null;return}if(S&&S.readyState===WebSocket.OPEN)try{S.send(JSON.stringify({type:"video_progress",videoUrl:t.videoUrl||l,currentTime:o.currentTime,duration:o.duration,paused:o.paused,playbackRate:o.playbackRate}))}catch(p){console.error("[WebSocket] Failed to send video_progress:",p)}},2e3);let b;if(c){if(b=i,S&&S.readyState===WebSocket.OPEN)try{S.send(JSON.stringify({type:"video_playing",videoUrl:t.videoUrl||l,originalDuration:i})),console.log("[WebSocket] Sent video_playing confirmation to server.")}catch(p){console.error("[WebSocket] Failed to send video_playing confirmation:",p)}}else t.startTime?b=Math.max(.1,i-(Date.now()-t.startTime)/1e3):b=Math.max(.1,i-a);c||(W={startTime:t.startTime,originalDuration:i},bt()),R=setTimeout(()=>{console.log("Immediate video override duration expired. Reverting to active preset."),U=!1,R=null,Pe(),G&&(clearInterval(G),G=null),W=null,V&&Te(V)},b*1e3)};o.addEventListener("playing",f,{once:!0}),o.play().then(()=>{console.log("Immediate video play started successfully.")}).catch(b=>{console.log("Immediate video autoplay blocked. Retrying with mute...",b),o.muted=!0,o.play().then(()=>{console.log("Muted fallback autoplay succeeded! Click to unmute listener added.");const p=()=>{o.muted=typeof t.videoAudio<"u"?!t.videoAudio:!1,w&&w.state==="suspended"&&w.resume(),console.log("User interacted. Restored original audio state."),document.removeEventListener("click",p),document.removeEventListener("keydown",p),document.removeEventListener("touchstart",p)};document.addEventListener("click",p),document.addEventListener("keydown",p),document.addEventListener("touchstart",p)}).catch(p=>{console.error("Even muted autoplay failed:",p),f()})})}if(t.type==="video_sync"&&o&&U&&t.startTime&&Tt(t.startTime,t.originalDuration),t.type==="trigger_static"){_="static";const i=t.duration||1;setTimeout(()=>{_="idle"},i*1e3)}if(t.type==="image"&&t.imageData){const i=I;I=await xe(t.imageData),_="custom_image",i&&i.dispose()}if(t.type==="text"&&(C=t.text||"",t.textPosition&&(ce=t.textPosition),Se=null,Ce=null),t.type==="filter"){const i={default:0,green:1,red:2,yellow:3,rainbow:4,custom:5},d=t.filterMode||"default";q=i[d]!==void 0?i[d]:0,ge=t.filterColor||"#ffffff"}t.type==="reset"&&(U=!1,pe=null,R&&(clearTimeout(R),R=null),Pe(),W=null,_="idle",C="",q=0,ge="#ffffff",tt(null,!1,!1),I&&I.dispose(),I=null,ie=Ae||X,V&&(console.log("Reset received. Restoring last applied preset:",V),await Te(V))),t.type==="trigger_easter_egg"&&(U=!1,R&&(clearTimeout(R),R=null),t.imageData?xe(t.imageData).then(i=>{z&&z.dispose(),z=i,Q(t)}).catch(()=>Q(t)):Q(t)),t.type==="default_volume_change"&&(ft=t.volume,be()),t.type==="override_volume_change"&&(pe=t.volume,be())}S.onclose=()=>{console.log(`WS connection closed. Reconnecting in ${ue}ms...`),O&&(O(),O=null),setTimeout(()=>{We(),ue=Math.min(ue*2,4e3)},ue)},S.onerror=t=>{console.error("WS error:",t),O&&(O(),O=null)}}document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){if(console.log("[Visibility] Tab is visible again — checking sync..."),!S||S.readyState===WebSocket.CLOSED||S.readyState===WebSocket.CLOSING){console.log("[Visibility] WS was closed. Reconnecting now..."),ue=1e3,We();return}if(U&&W&&W.startTime){console.log("[Visibility] Forcing immediate video resync.");const e=(Date.now()-W.startTime)/1e3;if(e>=W.originalDuration)console.log("[Visibility] Video expired while backgrounded. Reverting to preset."),U=!1,R&&(clearTimeout(R),R=null),Pe(),W=null,V&&Te(V);else if(o){const n=Math.abs(o.currentTime-e);console.log(`[Visibility] Drift: ${n.toFixed(2)}s → correcting to ${e.toFixed(2)}s`),o.currentTime=e,o.paused&&o.play().catch(()=>{})}bt()}}});const Y=document.createElement("canvas");Y.width=1024,Y.height=1586;const re=Y.getContext("2d"),K=new m.CanvasTexture(Y);K.colorSpace=m.SRGBColorSpace,K.minFilter=m.LinearFilter,K.generateMipmaps=!1;const fe=document.createElement("canvas");fe.width=256,fe.height=256;const wt=fe.getContext("2d"),F=new m.CanvasTexture(fe);F.colorSpace=m.SRGBColorSpace,F.wrapS=m.RepeatWrapping,F.wrapT=m.RepeatWrapping,F.minFilter=m.NearestFilter,F.magFilter=m.NearestFilter,F.generateMipmaps=!1;let Ne=null;const J=document.createElement("canvas");J.width=1024,J.height=1024;const B=J.getContext("2d"),me=new m.CanvasTexture(J);me.colorSpace=m.SRGBColorSpace,me.minFilter=m.LinearFilter,me.generateMipmaps=!1;let Ge=0,we=0,$e=-1,je=[],ze=0,k=!1,Z="idle",$=0;const St=.3;let Ye=7,qe=0,Xe={};function Q(e){Z==="idle"&&(Xe=e||{},typeof Xe.duration=="number"?Ye=Xe.duration:Ye=7,Z="transition_in",$=0,k=!0)}window[Re("1f0502100c1219320a041f1219320c10")]=async function(){try{const e=await fetch(Fe("/api/mx-cfg"));if(!e.ok){Q({});return}const n=await e.json();n.imageData?xe(n.imageData).then(t=>{z&&z.dispose(),z=t,Q(n)}).catch(()=>Q(n)):Q(n)}catch(e){console.error("[Macrostasis]",e),Q({})}};function ee(){Ne||(Ne=wt.createImageData(fe.width,fe.height));const e=Ne.data,n=e.length;for(let t=0;t<n;t+=4){const i=Math.floor(Math.random()*255);e[t]=i,e[t+1]=i,e[t+2]=i,e[t+3]=255}wt.putImageData(Ne,0,0),F.needsUpdate=!0}const Ke='"Sixtyfour", "SLNTHLN", monospace';function Ot(e,n,t,i){n.font=`${i}px ${Ke}`;const d=e.split(`
`),a=[];for(const c of d){if(c.trim()===""){a.push("");continue}const s=c.split(" ");let r="";for(let l=0;l<s.length;l++){const u=s[l];if(u==="")continue;const h=r?r+" "+u:u;n.measureText(h).width>t?r?(a.push(r),r=u):(a.push(u),r=""):r=h}r&&a.push(r)}return a}let Se=null,Ce=null;function M(e,n){const t=n||ce||"center";if(!(e===Se&&t===Ce)){if(Se=e,Ce=t,B.clearRect(0,0,J.width,J.height),e){B.save(),B.fillStyle="#ffffff",B.shadowColor="#ffffff";const i=850,d=850,a=16;let c=64,s=[],r=0,l=0;for(;c>=a;){if(r=Math.floor(c*1.35),s=Ot(e,B,i,c),l=s.length*r,l<=d){let f=!0;B.font=`${c}px ${Ke}`;for(const b of s)if(B.measureText(b).width>i){f=!1;break}if(f)break}c-=2}B.font=`${c}px ${Ke}`,B.shadowBlur=Math.max(2,Math.floor(c*.15));const u=40,h=J.width,y=J.height;let v,x,g;switch(t){case"top-left":v=u,x=u+r/2,g="left";break;case"top-right":v=h-u,x=u+r/2,g="right";break;case"top-center":v=h/2,x=u+r/2,g="center";break;case"bottom-left":v=u,x=y-u-l+r/2,g="left";break;case"bottom-right":v=h-u,x=y-u-l+r/2,g="right";break;case"bottom-center":v=h/2,x=y-u-l+r/2,g="center";break;default:v=h/2,x=y/2-(s.length-1)*r/2,g="center"}B.textAlign=g,B.textBaseline="middle";for(let f=0;f<s.length;f++){const b=s[f];b&&B.fillText(b,v,x+f*r)}B.restore()}me.needsUpdate=!0}}let Je=null,w=null,Ze=null,Me=null,Ee=null,ae=null;const Qe=()=>{if(!w)try{w=new(window.AudioContext||window.webkitAudioContext),console.log("[Brute Force Audio] Created new AudioContext on user interaction."),o&&et(o)}catch(e){console.error("[Brute Force Audio] Failed to create AudioContext:",e)}w&&w.state==="suspended"&&w.resume().then(()=>console.log("[Brute Force Audio] audioCtx resumed successfully! State:",w.state)).catch(e=>console.error("[Brute Force Audio] Failed to resume audioCtx:",e)),o&&o.dataset.shouldPlayAudio!=="false"&&(o.muted&&(o.muted=!1,console.log("[Brute Force Audio] activeVideo unmuted!")),be(),o.paused&&o.play().then(()=>console.log("[Brute Force Audio] Forced activeVideo playback to start!")).catch(n=>console.error("[Brute Force Audio] Forced activeVideo play failed:",n)))};window.addEventListener("click",Qe),window.addEventListener("touchstart",Qe),window.addEventListener("keydown",Qe);function et(e){try{if(!w){w=new(window.AudioContext||window.webkitAudioContext);const n=()=>{w.state==="suspended"&&w.resume()};window.addEventListener("click",n),window.addEventListener("mousemove",n),window.addEventListener("touchstart",n),window.addEventListener("keydown",n)}Ze?console.log("[Web Audio] Reusing existing MediaElementSourceNode connection."):(Ze=w.createMediaElementSource(e),Me=w.createBiquadFilter(),Me.type="highpass",Me.frequency.value=180,Ee=w.createBiquadFilter(),Ee.type="lowpass",Ee.frequency.value=4e3,ae=w.createBiquadFilter(),ae.type="peaking",ae.frequency.value=1e3,ae.Q.value=1.2,ae.gain.value=8,Ze.connect(Me),Me.connect(Ee),Ee.connect(ae),ae.connect(w.destination),console.log("[Web Audio] Filter chain connected and created successfully.")),w.state==="suspended"&&w.resume()}catch(n){console.error("Web Audio API setup failed:",n)}}function Ct(e){if(!e)return null;const n=/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/,t=e.match(n);return t&&t[2].length===11?t[2]:null}async function Bt(e){const n=["https://cobalt.projectsegfau.lt","https://cobalt.api.ryder.xyz","https://api.cobalt.tools","https://api.cobalt.download","https://cobalt.moe"],t=["https://api.piped.private.coffee"],i=["https://inv.thepixora.com","https://invidious.flokinet.to","https://invidious.nerdvpn.de","https://invidious.tiekoetter.com","https://inv.nadeko.net","https://yewtu.be"],d=async l=>{const u=new AbortController,h=setTimeout(()=>u.abort(),6e3);try{const y=await fetch(l.endsWith("/")?l:l+"/",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({url:`https://www.youtube.com/watch?v=${e}`,videoQuality:"720"}),signal:u.signal});if(clearTimeout(h),!y.ok)throw new Error(`HTTP ${y.status}`);const v=await y.json();if((v.status==="stream"||v.status==="redirect"||v.status==="success")&&v.url)return console.log(`[YouTube Client] Success from Cobalt instance: ${l}`),v.url;throw new Error(`Invalid Cobalt response status: ${v.status}`)}catch(y){throw clearTimeout(h),y}},a=async l=>{const u=new AbortController,h=setTimeout(()=>u.abort(),6e3);try{const y=await fetch(`${l}/streams/${e}`,{signal:u.signal});if(clearTimeout(h),!y.ok)throw new Error(`HTTP ${y.status}`);const v=await y.json();if(!v.videoStreams||v.videoStreams.length===0)throw new Error("No videoStreams");const x=v.videoStreams.find(g=>g.format==="MPEG_4"||g.mimeType.includes("video/mp4"));if(!x||!x.url)throw new Error("No MP4 stream found");return console.log(`[YouTube Client] Success from Piped instance: ${l}`),x.url}catch(y){throw clearTimeout(h),y}},c=async l=>{const u=new AbortController,h=setTimeout(()=>u.abort(),6e3);try{const y=await fetch(`${l}/api/v1/videos/${e}`,{signal:u.signal});if(clearTimeout(h),!y.ok)throw new Error(`HTTP ${y.status}`);const v=await y.json();if(!v.formatStreams||v.formatStreams.length===0)throw new Error("No formatStreams");const x=v.formatStreams.find(f=>f.container==="mp4"||f.type.includes("video/mp4"));if(!x||!x.url)throw new Error("No MP4 stream found");let g=x.url;if(g.includes("local=true")||(g+=g.includes("?")?"&local=true":"?local=true"),g.startsWith("/"))g=l+g;else if(g.startsWith("http")){const f=new URL(g),b=new URL(l);f.host=b.host,f.protocol=b.protocol,f.searchParams.has("local")||f.searchParams.set("local","true"),g=f.toString()}return console.log(`[YouTube Client] Success from Invidious instance: ${l}`),g}catch(y){throw clearTimeout(h),y}},s=l=>new Promise((u,h)=>{let y=[],v=0;l.forEach(x=>{Promise.resolve(x).then(u).catch(g=>{y.push(g),v++,v===l.length&&h(new Error("All client instances failed: "+y.map(f=>f.message).join(", ")))})})}),r=[...n.map(d),...t.map(a),...i.map(c)];try{return await s(r)}catch(l){throw console.error("[YouTube Client] All client-side resolution attempts failed:",l),l}}async function Mt(e){try{const n=await fetch(Fe(`/api/yt-resolve?id=${e}`));if(!n.ok)throw new Error(`Server returned HTTP ${n.status}`);const t=await n.json();if(!t.url)throw new Error("Server response missing URL");return t.url.startsWith("/api/")?Fe(t.url):t.url}catch(n){return console.warn("[YouTube] Server proxy failed. Falling back to client-side Piped/Invidious racing...",n.message),await Bt(e)}}async function tt(e,n,t){let i=e;if(!e){Je=null,T&&(T.destroy(),T=null),o&&(o.pause(),o.removeAttribute("src"),o.load()),A&&(A.dispose(),A=null);return}const d=Ct(e);if(d)try{i=await Mt(d)}catch(s){console.error("Failed to resolve YouTube video:",s);return}if(i===Je&&o){o.loop=n,o.muted=!t,o.dataset.shouldPlayAudio=!!t;return}Je=i,T&&(T.destroy(),T=null);let a=!1;o||(o=document.createElement("video"),o.preload="auto",o.playsInline=!0,o.webkitPlaysInline=!0,o.crossOrigin="anonymous",a=!0),o.loop=n,o.muted=!t,o.dataset.shouldPlayAudio=!!t,o.crossOrigin="anonymous";const c=_e(i);if(c.includes(".m3u8")&&typeof Hls<"u"?Hls.isSupported()?(T=new Hls({maxBufferLength:8,maxMaxBufferLength:12,enableWorker:!0,lowLatencyMode:!0}),T.attachMedia(o),T.loadSource(c),T.on(Hls.Events.MANIFEST_PARSED,()=>{console.log("[HLS.js] Manifest loaded, playing...")}),T.on(Hls.Events.ERROR,(s,r)=>{if(r.fatal)switch(r.type){case Hls.ErrorTypes.NETWORK_ERROR:console.warn("[HLS.js] Network error, attempting recovery...",r),T.startLoad();break;case Hls.ErrorTypes.MEDIA_ERROR:console.warn("[HLS.js] Media error, attempting recovery...",r),T.recoverMediaError();break;default:console.error("[HLS.js] Unrecoverable error",r);break}})):o.canPlayType("application/vnd.apple.mpegurl")&&(o.src=c,o.load()):(o.src=c,o.load()),be(),a)try{et(o)}catch(s){console.error("Audio filter setup failed:",s)}A||(A=new m.VideoTexture(o),A.colorSpace=m.SRGBColorSpace,A.minFilter=m.LinearFilter,A.generateMipmaps=!1),o.play().then(()=>{console.log("Preset video play started successfully.")}).catch(s=>{console.log("Preset video autoplay blocked. Retrying with mute...",s),o.muted=!0,o.play().then(()=>{console.log("Preset muted fallback autoplay succeeded!");const r=()=>{o.muted=!t,be(),w&&w.state==="suspended"&&w.resume(),console.log("User interacted. Restored preset audio state."),document.removeEventListener("click",r),document.removeEventListener("keydown",r),document.removeEventListener("touchstart",r)};document.addEventListener("click",r),document.addEventListener("keydown",r),document.addEventListener("touchstart",r)}).catch(r=>{console.error("Preset even muted autoplay failed:",r)})})}function Dt(){new m.TextureLoader;const e=document.createElement("canvas");e.width=1,e.height=1;const n=new m.CanvasTexture(e);return n.colorSpace=m.SRGBColorSpace,X=null,ie=n,Ae=n,z=null,new Promise(t=>{O=t,setTimeout(()=>{O&&(O(),O=null)},1800),We()})}function Et(e){const n=Math.floor(e/60),t=e%60;if(n!==$e){$e=n,je=[];const a=Math.max(1,gt),c=Math.max(.1,ht),s=Math.max(c,pt),r=60/a;for(let l=0;l<a;l++){const u=c+Math.random()*(s-c),h=l*r,y=Math.max(0,r-u),v=h+Math.random()*y;je.push({start:v,end:v+u})}}let i=!1;for(const a of je)if(t>=a.start&&t<=a.end){i=!0;break}return ze+=((i?1:0)-ze)*.12,Math.min(Math.max(ze,0),1)}function Lt(e,n,t){if(!e)return;e.uIsVideo&&(e.uIsVideo.value=P.mode==="video"?1:0),e.uPowerOff&&(e.uPowerOff.value=P.mode==="custom_image"&&!I?1:0),e.uScaleX&&e.uScaleY&&(e.uScaleX.value=1,e.uScaleY.value=1),e.uTextureText.value=me,typeof e.uFilterMode<"u"&&(e.uFilterMode.value=q),e.uFilterColor&&e.uFilterColor.value.set(ge);const i=()=>{C?M(C):qe>0?(qe-=t,M(Re("283f4b3c3c"),"top-left")):M("")};if(Z==="transition_in"){if($+=t,k=!0,ee(),M(""),e.uTexture.value=F,e.uChildVisibility.value=0,$>=St){if(Z="active",$=0,k=!1,re.clearRect(0,0,Y.width,Y.height),z&&z.image){re.save(),re.filter="invert(1)";const a=720,c=a*(769/612),s=(Y.width-a)/2,r=(Y.height-c)/2;re.drawImage(z.image,s,r,a,c),re.restore()}K.needsUpdate=!0}return}if(Z==="active"){$+=t,k=!1,C?M(C,ce):$<=2?M(Re("283f4b3a3f342f2f"),"top-left"):M(""),e.uScaleX&&(e.uScaleX.value=1.936872),e.uTexture.value=K,e.uChildVisibility.value=0,$>=Ye&&(Z="transition_out",$=0,k=!0);return}if(Z==="transition_out"){$+=t,k=!0,ee(),M(""),e.uTexture.value=F,e.uChildVisibility.value=0,$>=St&&(Z="idle",$=0,k=!1,qe=2);return}if(_==="static"){k=!1,ee(),e.uTexture.value=F,e.uChildVisibility.value=0,M(C||"");return}if(_==="custom_image"&&I){k=!1,e.uTexture.value=I,e.uChildVisibility.value=0,M(C||"");return}if(P.mode==="static"){k=!1,ee(),e.uTexture.value=F,M(C||""),e.uChildVisibility.value=0;return}if(P.mode==="custom_image"){k=!1,I?e.uTexture.value=I:(re.fillStyle="#000000",re.fillRect(0,0,Y.width,Y.height),K.needsUpdate=!0,e.uTexture.value=K),M(C||""),e.uChildVisibility.value=0;return}if(P.mode==="default"){k=!1,i(),I||X?(e.uScaleX&&(e.uScaleX.value=1.936872),e.uTexture.value=I||X,e.uTextureChild.value=ie,e.uChildVisibility.value=Et(n)):(ee(),e.uTexture.value=F,C||M("SEÑAL PENDIENTE"),e.uChildVisibility.value=0);return}if(P.mode==="video"){k=!1,A&&o&&(o.readyState>=2||o.currentTime>0)?(o.readyState>=2&&(A.needsUpdate=!0),e.uTexture.value=A):(ee(),e.uTexture.value=F),M(C||""),e.uChildVisibility.value=0;return}if(P.mode==="slideshow"){const a=P.slideshow.images;if(!a||a.length===0){k=!1,ee(),e.uTexture.value=F,C||M("SEÑAL PENDIENTE"),e.uChildVisibility.value=0;return}if(a.length<=1){k=!1;const c=a[0],s=dt[c]||X;i(),e.uTexture.value=s,e.uChildVisibility.value=0;return}if(we+=t,k)ee(),M(""),e.uTexture.value=F,e.uChildVisibility.value=0,we>=P.slideshow.transitionDuration&&(Ge=(Ge+1)%a.length,we=0,k=!1);else{const c=a[Ge],s=dt[c]||X;i(),e.uTexture.value=s,c===Re("4407340345130a03")?(e.uScaleX&&(e.uScaleX.value=1.936872),e.uTextureChild.value=ie,e.uChildVisibility.value=Et(n)):e.uChildVisibility.value=0,we>=P.slideshow.slideDuration&&(we=0,k=!0)}}const d=e.uTexture.value;if(d&&d.image){const a=d.image;let c=!0;if(a instanceof HTMLVideoElement&&(a.readyState<2||a.paused)&&(c=!1),c)try{mt.drawImage(a,0,0,1,1);const s=mt.getImageData(0,0,1,1).data;let r=s[0]/255,l=s[1]/255,u=s[2]/255;const h=.299*r+.587*l+.114*u;if(q===1)r=h*.22*1.35,l=h*1*1.35,u=h*.08*1.35;else if(q===2)r=h*1*1.35,l=h*.15*1.35,u=h*.15*1.35;else if(q===3)r=h*1*1.35,l=h*.82*1.35,u=0;else if(q===4){const x=n*.15%1,g=new m.Color().setHSL(x,1,.5);r=h*g.r*1.5,l=h*g.g*1.5,u=h*g.b*1.5}else if(q===5){const x=new m.Color(ge);r=h*x.r*1.35,l=h*x.g*1.35,u=h*x.b*1.35}else r=r*.68,l=l*.73,u=u*.9;const y=.299*r+.587*l+.114*u;let v=1;y>.82&&(v=.82/y),ye.setRGB(r*v,l*v,u*v)}catch{ye.setHex(11196671)}else ye.setHex(11196671)}else ye.setHex(11196671)}function Vt(){R&&(clearTimeout(R),R=null),U=!1,o&&(o.pause(),o.src="",o.load()),S&&S.close(),I&&I.dispose(),K.dispose(),F.dispose(),me.dispose(),A&&A.dispose()}const ot=()=>{P.mode==="video"&&o&&o.paused&&o.play().catch(()=>{})};window.addEventListener("click",ot),window.addEventListener("pointerdown",ot),window.addEventListener("touchstart",ot);/*! REJECTED FALSE ICONS (5/7) */const It=e=>{const n=new m.Box3;let t=!1;return e.traverse(i=>{if(i.isMesh){const d=new m.Box3().setFromObject(i);t?n.union(d):(n.copy(d),t=!0)}}),n};function Ht(e,n,t,i){const d=new he.GLTFLoader;typeof MeshoptDecoder<"u"&&d.setMeshoptDecoder(MeshoptDecoder);const a=new Promise((c,s)=>{d.load("/crt-tv.glb",r=>{Ie("model",50),c(r)},r=>{let l=r.total;(!l||l===0)&&(l=4862760);const u=Math.min(r.loaded/l,1);Ie("model",u*50)},r=>{console.error("Error loading TV GLTF:",r),s(r)})});return Ie("texture1",10),Ie("texture2",10),a.then(c=>Dt().then(()=>c)).then(c=>{const s=new m.Group;e.add(s);const r=c.scene;s.add(r),r.position.set(0,0,0),r.rotation.set(0,Math.PI,0),r.scale.set(1,1,1),r.updateMatrixWorld(!0);const l=2.4,h=It(r).getSize(new m.Vector3),y=l/h.y;r.scale.setScalar(y),r.updateMatrixWorld(!0);const v=It(r),x=v.getCenter(new m.Vector3);r.position.x=-x.x,r.position.y=-v.min.y,r.position.z=-x.z,r.updateMatrixWorld(!0),r.traverse(L=>{L.isMesh&&(L.castShadow=!0,L.receiveShadow=!0,L.material&&(L.material.metalness=.05,L.material.roughness=.75,L.material.color&&L.material.color.multiplyScalar(1.5)))});const g=new m.PlaneGeometry(1.75,1.54,16,16),f=new m.ShaderMaterial({vertexShader:kt,fragmentShader:At,uniforms:{uTime:{value:0},uTexture:{value:null},uTextureChild:{value:null},uTextureText:{value:null},uChildVisibility:{value:0},uMagneticCenter:{value:new m.Vector2(-10,-10)},uMagneticTime:{value:0},uMagneticIntensity:{value:0},uMagneticBuildup:{value:0},uMagneticVelocity:{value:new m.Vector2(0,0)},uFilterMode:{value:0},uFilterColor:{value:new m.Color("#ffffff")},uScaleX:{value:1},uScaleY:{value:1},uIsVideo:{value:0},uPowerOff:{value:0},uFogColor:{value:new m.Color(1185062)},uFogNear:{value:9},uFogFar:{value:25}}}),b=new m.Mesh(g,f),p=v.max.z-x.z;b.position.set(0,1.3,p-.08),s.add(b);const N=new m.SpotLight(11196671,12,9,Math.PI/2.2,.95,1.1);N.position.set(0,1.3,p-.04);const te=new m.Object3D;te.position.set(0,0,p+3.5),s.add(te),N.target=te,s.add(N);const oe=new m.SpotLight(16733457,14,3.2,Math.PI/2.5,.9,2);oe.position.set(0,1.3,p-1.7);const nt=new m.Object3D;nt.position.set(0,1.3,p-2.5),s.add(nt),oe.target=nt,s.add(oe);const E=new m.Vector3(0,0,12);s.position.copy(E),n.target.set(E.x,E.y+1.3,E.z),i.position.set(E.x,E.y+1.3,E.z),t.target=i;let Oe=!1,Be=0;const it=3.5,rt=.22;let De=0,Le=0,ve=0,at=0,lt=0,Ve=0;return{tvGroup:s,crtScreen:b,crtLight:N,internalCabinetLight:oe,basePosition:E,update:(L,H)=>{if(f.uniforms.uTime.value=L,Ve=Math.max(Ve-H*5,0),at*=Math.max(1-H*6,0),lt*=Math.max(1-H*6,0),Oe){Be=Math.min(Be+H,it);const j=Be/it;f.uniforms.uMagneticIntensity.value=Math.min(.15+j*.85+Ve*.4,1.3),f.uniforms.uMagneticBuildup.value=j,f.uniforms.uMagneticTime.value+=H,f.uniforms.uMagneticVelocity.value.set(at,lt);const ne=Math.min(j*.032,.032);ne>.001?s.position.set(E.x+(Math.random()-.5)*ne,E.y+(Math.random()-.5)*ne,E.z+(Math.random()-.5)*ne):s.position.copy(E)}else if(Le>0)if(ve+=H,f.uniforms.uMagneticTime.value+=H,f.uniforms.uMagneticVelocity.value.set(0,0),ve<0){const j=(ve+rt)/rt,ne=Math.sin(j*Math.PI)*.55,le=Math.min(De+ne,1.4);f.uniforms.uMagneticIntensity.value=le,f.uniforms.uMagneticBuildup.value=le,s.position.copy(E)}else{const j=Math.min(ve/Le,1),ne=1-j*j,le=De*ne;if(le<=.001||j>=1)f.uniforms.uMagneticIntensity.value=0,f.uniforms.uMagneticBuildup.value=0,Le=0,s.position.copy(E);else{f.uniforms.uMagneticIntensity.value=le,f.uniforms.uMagneticBuildup.value=le;const st=le*.032;s.position.set(E.x+(Math.random()-.5)*st,E.y+(Math.random()-.5)*st,E.z+(Math.random()-.5)*st)}}else f.uniforms.uMagneticVelocity.value.set(0,0),k?s.position.set(E.x+(Math.random()-.5)*.012,E.y+(Math.random()-.5)*.012,E.z+(Math.random()-.5)*.012):s.position.copy(E);e.fog&&(f.uniforms.uFogColor.value.copy(e.fog.color),f.uniforms.uFogNear.value=e.fog.near,f.uniforms.uFogFar.value=e.fog.far),Lt(f.uniforms,L,H),N.color.lerp(ye,.12),N.intensity=(1.4+Math.sin(L*35)*.18+Math.sin(L*7)*.06)*16*1.5,oe.intensity=10+Math.sin(L*22)*.8+Math.sin(L*4)*.25,r.position.set(-x.x,-v.min.y,-x.z)},destroy:()=>{g.dispose(),f.dispose(),Vt(),e.remove(s)},startMagneticHold:L=>{Oe=!0,Be=f.uniforms.uMagneticBuildup.value*it,Le=0,ve=0,f.uniforms.uMagneticCenter.value.copy(L)},stopMagneticHold:()=>{Oe&&(Oe=!1,De=f.uniforms.uMagneticBuildup.value,Le=1.5+De*9,ve=-rt)},setVelocityBoost:(L,H)=>{const j=Math.sqrt(L*L+H*H);Ve=Math.min(j*12,.6),at=L*8,lt=H*8}}})}window.KimerawareTV={loadTV:Ht,updateScreenManager:Lt}});
