(function(oe,de){typeof exports=="object"&&typeof module<"u"?de(require("three"),require("three/examples/jsm/loaders/GLTFLoader.js")):typeof define=="function"&&define.amd?define(["three","three/examples/jsm/loaders/GLTFLoader.js"],de):(oe=typeof globalThis<"u"?globalThis:oe||self,de(oe.THREE,oe.THREE))})(this,function(oe,de){"use strict";function Lt(e){const n=Object.create(null,{[Symbol.toStringTag]:{value:"Module"}});if(e){for(const t in e)if(t!=="default"){const i=Object.getOwnPropertyDescriptor(e,t);Object.defineProperty(n,t,i.get?i:{enumerable:!0,get:()=>e[t]})}}return n.default=e,Object.freeze(n)}const m=Lt(oe),It=`varying vec2 vUv;
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
`,Rt=`uniform float uTime;
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
  screenContent = mix(screenContent, uFogColor, fogFactor);

  gl_FragColor = vec4(screenContent, 1.0);
}
`;document.getElementById("loading-splash");const at=document.getElementById("loading-bar-fill"),lt=document.getElementById("loading-text");let B={scene:10,overlay:5,lights:5,particles:10,texture1:0,texture2:0,model:0};function Ft(e,n){const t=Math.min(Math.max(Math.round(e),0),100);at&&(at.style.width=`${t}%`),n&&lt&&(lt.textContent=n)}function Ee(e,n){B[e]=n;const t=Math.min(B.scene+B.overlay+B.lights+B.particles+B.texture1+B.texture2+B.model,100);let i="Cargando...";t<30?i="Preparando escena...":B.model<50?i=`Cargando modelo 3D... ${Math.round(B.model/50*100)}%`:B.texture1<10||B.texture2<10?i="Cargando texturas...":i="Listo.",Ft(t,i)}function Le(e){const n="kw";let t="";for(let i=0;i<e.length;i+=2){const d=parseInt(e.substring(i,i+2),16),a=n.charCodeAt(i/2%n.length);t+=String.fromCharCode(d^a)}return t}const A={mode:"default",slideshow:{images:[],slideDuration:12,transitionDuration:.45}};let z=null,Q=null,G=null;const st={};let ct=80,fe=null,o=null,R=null,T=null,k=null,E=null,b="",V="idle",$=0,me="#ffffff",ie="center",re=1e3;const he=new m.Color(11196671),Ne=document.createElement("canvas");Ne.width=1,Ne.height=1;const ut=Ne.getContext("2d",{willReadFrequently:!0});let P=!1,L=null,N=null,dt=0,H=null,ae=null,Ie=null,ft=3,mt=5,ht=5,U=null;const At=()=>window.location.hostname==="localhost"||window.location.hostname==="127.0.0.1"?"ws://localhost:8088":"wss://kimeraware.macrostasis.dev/ws",Re=e=>window.location.hostname==="localhost"||window.location.hostname==="127.0.0.1"?e:`https://kimeraware.macrostasis.dev${e}`,pt=e=>{const n=window.location.hostname;return n==="localhost"||n==="127.0.0.1"||n.includes("macrostasis.dev")?e:`https://kimeraware.macrostasis.dev${e}`},vt=e=>{if(!e)return e;let n=e;if(e.includes("/assets/")){const t=e.substring(e.indexOf("/assets/"));n=pt(t)}if((n.startsWith("http://")||n.startsWith("https://"))&&!n.includes("/api/yt-proxy")){const t=window.location.hostname;let i=!0;if(t==="localhost"||t==="127.0.0.1")try{const d=new URL(e);(d.hostname==="localhost"||d.hostname==="127.0.0.1")&&(i=!1)}catch{}(n.includes("local=true")||n.includes("/assets/")||n.includes("assets/")||n.includes("piped")||n.includes("cobalt")||n.includes("invidious")||n.includes("yewtu.be")||n.includes("nadeko.net"))&&(i=!1),i&&(n=Re(`/api/yt-proxy?url=${encodeURIComponent(n)}`))}return n+=(n.includes("?")?"&":"?")+"t_cb="+Date.now(),n};function pe(e){return new Promise((n,t)=>{const i=new Image;i.onload=()=>{const a=new m.Texture(i);a.colorSpace=m.SRGBColorSpace,a.minFilter=m.LinearFilter,a.generateMipmaps=!1,a.needsUpdate=!0,n(a)},i.onerror=a=>{t(a)};let d=e;if(e&&e.includes("/assets/")){const a=e.substring(e.indexOf("/assets/"));d=pt(a)}d&&(d.startsWith("http://")||d.startsWith("https://"))&&(i.crossOrigin="anonymous"),i.src=d})}async function ve(e){A.mode=e.mode||"default",b=e.text||"",ie=e.textPosition||"center",ye=null,Te=null,ft=e.minDuration||3,mt=e.maxDuration||5,ht=e.frequencyPerMinute||5,He=-1;const n={default:0,green:1,red:2,yellow:3,rainbow:4,custom:5},t=e.filterMode||"default";$=n[t]!==void 0?n[t]:0,me=e.filterColor||"#ffffff";const i=e.videoUrl||"",d=typeof e.videoLoop<"u"?e.videoLoop:!0,a=typeof e.videoAudio<"u"?e.videoAudio:!0;if(A.mode==="video"?Je(i,d,a):Je(null,!1,!1),e.mainImageData){const u=E;E=await pe(e.mainImageData),A.mode==="custom_image"?V="custom_image":V="idle",u&&u.dispose()}else V="idle",E&&E.dispose(),E=null;if(e.childImageData){const u=Q;Q=await pe(e.childImageData),u&&u!==z&&u!==Ie&&u.dispose()}else Q=Ie||z}let gt=0;function xt(e,n){if(!o||o.paused||!e)return;if(o.readyState<3){console.log(`[Sync] Skipping sync: Video is buffering/loading (readyState: ${o.readyState})`);return}if(o.duration===1/0||!isFinite(o.duration))return;let t=(Date.now()-e)/1e3;const i=n||1/0;if(t<0||t>=i)return;o.duration&&o.loop&&(t=t%o.duration);const d=Math.abs(o.currentTime-t),a=o.currentTime<8?2:.8;if(d>a){const u=Date.now();if(u-gt<6e3){console.log(`[Sync] Drift detected (${d.toFixed(2)}s) but throttling seek to let Hls.js buffer...`);return}let s=!1;try{const r=o.buffered;for(let l=0;l<r.length;l++)if(t>=r.start(l)&&t<=r.end(l)){s=!0;break}}catch{}if(!s&&d<4){console.log(`[Sync] Drift of ${d.toFixed(2)}s detected, but target position ${t.toFixed(2)}s is not in buffer yet. Waiting for Hls.js buffering...`);return}console.log(`[Sync] Correcting drift of ${d.toFixed(2)}s (threshold: ${a}s) — seeking to ${t.toFixed(2)}s`),gt=u,o.currentTime=t}}function ge(){if(!o)return;let e=ct;P&&fe!==null&&(e=fe);const n=e/100;o.volume=n,console.log(`[Volume] Applied volume to video element: ${n} (${e}%)`)}function yt(){ae&&clearInterval(ae),ae=setInterval(()=>{if(!P||!H){Fe();return}xt(H.startTime,H.originalDuration)},2e3)}function Fe(){ae&&(clearInterval(ae),ae=null)}let Ae=null;async function kt(){if(Ae)return Ae;const e="75,87,95,65,82,71",n=new Uint8Array(e.split(",").map(Number)),t=new TextEncoder().encode("kimeraware-ws-2025"),i=await crypto.subtle.importKey("raw",n,{name:"HMAC",hash:"SHA-256"},!1,["sign"]),d=await crypto.subtle.sign("HMAC",i,t);return Ae=await crypto.subtle.importKey("raw",d,{name:"AES-GCM"},!1,["decrypt"]),Ae}async function Pt(e){try{if((typeof crypto>"u"||!crypto.subtle)&&typeof window<"u"&&typeof window.decryptWsMessageFallback=="function")return window.decryptWsMessageFallback(e);const n=Uint8Array.from(atob(e),r=>r.charCodeAt(0)),t=n.slice(0,12),i=n.slice(12,28),d=n.slice(28),a=new Uint8Array(d.length+16);a.set(d),a.set(i,d.length);const u=await kt(),s=await crypto.subtle.decrypt({name:"AES-GCM",iv:t},u,a);return JSON.parse(new TextDecoder().decode(s))}catch(n){try{return JSON.parse(e)}catch{throw n}}}function Oe(){const e=At();k=new WebSocket(e),k.onopen=()=>{console.log("Connected to KimeraWare Event Server"),re=1e3},k.onmessage=async t=>{try{const i=await Pt(t.data);console.log("WS Event received:",i.type),await n(i)}catch(i){console.error("Error handling WS event:",i)}finally{U&&(U(),U=null)}};async function n(t){if(ye=null,Te=null,t.type==="apply_preset"){if(N=t,t.textPosition&&(ie=t.textPosition),P){console.log("Immediate video is active. Storing preset for later restoration.");return}await ve(t)}if(t.type==="trigger_video"){console.log("WS Event received: trigger_video",t),P||N||(N={type:"apply_preset",presetId:"default",mode:"default",text:"",filterMode:"default",filterColor:"#ffffff",videoUrl:"",videoLoop:!0,videoAudio:!0,minDuration:2,maxDuration:4,frequencyPerMinute:3,mainImageData:null,childImageData:null});const i=parseFloat(t.originalDuration)||parseFloat(t.duration)||30,d=parseFloat(t.duration)||30;fe=t.videoVolume!==void 0?t.videoVolume:null;let a=0;if(t.startTime?a=Math.max(0,(Date.now()-t.startTime)/1e3):a=Math.max(0,i-d),a>=i){console.log(`Video override already expired (${a.toFixed(1)}s / ${i}s). Skipping.`);return}const u=Date.now()-t.startTime<5e3,s=performance.now(),r=++dt;let l=t.videoUrl||"";const f=bt(l);if(f){console.log("Resolving general YouTube ID for immediate video:",f);try{l=await St(f)}catch(c){console.error("Failed to resolve stream for immediate video:",c),V="idle",b="";return}}if(r!==dt){console.log("Immediate video trigger superseded by a newer request.");return}T&&(T.destroy(),T=null),o&&(o.pause(),o.removeAttribute("src"),o.load());let p=!1;o||(o=document.createElement("video"),o.preload="auto",o.playsInline=!0,o.webkitPlaysInline=!0,o.crossOrigin="anonymous",p=!0),o.loop=typeof t.videoLoop<"u"?t.videoLoop:!0,o.muted=typeof t.videoAudio<"u"?!t.videoAudio:!0,o.dataset.shouldPlayAudio=typeof t.videoAudio<"u"?!!t.videoAudio:!0;let v=!1;const h=()=>{if(!v&&(v=!0,!u)){const c=(performance.now()-s)/1e3,y=t.startTime?Math.max(0,(Date.now()-t.startTime)/1e3):a+c;o.duration===1/0||!isFinite(o.duration)?console.log("[Seek] Live stream detected. Skipping initial seek to remain at the live edge."):y>0&&y<i&&(console.log(`[Seek] Jumping to ${y.toFixed(2)}s (load delay: ${c.toFixed(2)}s)`),o.currentTime=y)}};o.addEventListener("loadedmetadata",h,{once:!0}),o.addEventListener("canplay",h,{once:!0}),o.crossOrigin="anonymous";const g=vt(l);if(g.includes(".m3u8")&&typeof Hls<"u"?Hls.isSupported()?(T=new Hls({maxBufferLength:8,maxMaxBufferLength:12,enableWorker:!0,lowLatencyMode:!0}),T.attachMedia(o),T.loadSource(g),T.on(Hls.Events.MANIFEST_PARSED,()=>{console.log("[HLS.js WS] Manifest loaded, playing...")}),T.on(Hls.Events.ERROR,(c,y)=>{if(y.fatal)switch(y.type){case Hls.ErrorTypes.NETWORK_ERROR:console.warn("[HLS.js WS] Network error, attempting recovery...",y),T.startLoad();break;case Hls.ErrorTypes.MEDIA_ERROR:console.warn("[HLS.js WS] Media error, attempting recovery...",y),T.recoverMediaError();break;default:console.error("[HLS.js WS] Unrecoverable error",y);break}})):o.canPlayType("application/vnd.apple.mpegurl")&&(o.src=g,o.load()):(o.src=g,o.load()),o.loop||o.addEventListener("ended",async()=>{console.log("Immediate video ended naturally. Reverting to active preset locally."),P=!1,L&&(clearTimeout(L),L=null),N&&await ve(N)}),p)try{Ke(o)}catch(c){console.error("Audio filter setup failed:",c)}R||(R=new m.VideoTexture(o),R.colorSpace=m.SRGBColorSpace,R.minFilter=m.LinearFilter,R.generateMipmaps=!1);const x=()=>{V="idle",P=!0,A.mode="video",b=t.text||"",ie=t.textPosition||"center",L&&clearTimeout(L);let c;if(u){if(c=i,k&&k.readyState===WebSocket.OPEN)try{k.send(JSON.stringify({type:"video_playing",videoUrl:t.videoUrl||l,originalDuration:i})),console.log("[WebSocket] Sent video_playing confirmation to server.")}catch(y){console.error("[WebSocket] Failed to send video_playing confirmation:",y)}}else t.startTime?c=Math.max(.1,i-(Date.now()-t.startTime)/1e3):c=Math.max(.1,i-a);u||(H={startTime:t.startTime,originalDuration:i},yt()),L=setTimeout(()=>{console.log("Immediate video override duration expired. Reverting to active preset."),P=!1,L=null,Fe(),H=null,N&&ve(N)},c*1e3)};o.addEventListener("playing",x,{once:!0}),o.play().then(()=>{console.log("Immediate video play started successfully.")}).catch(c=>{console.log("Immediate video autoplay blocked. Retrying with mute...",c),o.muted=!0,o.play().then(()=>{console.log("Muted fallback autoplay succeeded! Click to unmute listener added.");const y=()=>{o.muted=typeof t.videoAudio<"u"?!t.videoAudio:!1,w&&w.state==="suspended"&&w.resume(),console.log("User interacted. Restored original audio state."),document.removeEventListener("click",y),document.removeEventListener("keydown",y),document.removeEventListener("touchstart",y)};document.addEventListener("click",y),document.addEventListener("keydown",y),document.addEventListener("touchstart",y)}).catch(y=>{console.error("Even muted autoplay failed:",y),x()})})}if(t.type==="video_sync"&&o&&P&&t.startTime&&xt(t.startTime,t.originalDuration),t.type==="trigger_static"){V="static";const i=t.duration||1;setTimeout(()=>{V="idle"},i*1e3)}if(t.type==="image"&&t.imageData){const i=E;E=await pe(t.imageData),V="custom_image",i&&i.dispose()}if(t.type==="text"&&(b=t.text||"",t.textPosition&&(ie=t.textPosition),ye=null,Te=null),t.type==="filter"){const i={default:0,green:1,red:2,yellow:3,rainbow:4,custom:5},d=t.filterMode||"default";$=i[d]!==void 0?i[d]:0,me=t.filterColor||"#ffffff"}t.type==="reset"&&(P=!1,fe=null,L&&(clearTimeout(L),L=null),Fe(),H=null,V="idle",b="",$=0,me="#ffffff",Je(null,!1,!1),E&&E.dispose(),E=null,Q=Ie||z,N&&(console.log("Reset received. Restoring last applied preset:",N),await ve(N))),t.type==="trigger_easter_egg"&&(P=!1,L&&(clearTimeout(L),L=null),t.imageData?pe(t.imageData).then(i=>{G&&G.dispose(),G=i,K(t)}).catch(()=>K(t)):K(t)),t.type==="default_volume_change"&&(ct=t.volume,ge()),t.type==="override_volume_change"&&(fe=t.volume,ge())}k.onclose=()=>{console.log(`WS connection closed. Reconnecting in ${re}ms...`),U&&(U(),U=null),setTimeout(()=>{Oe(),re=Math.min(re*2,4e3)},re)},k.onerror=t=>{console.error("WS error:",t),U&&(U(),U=null)}}document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){if(console.log("[Visibility] Tab is visible again — checking sync..."),!k||k.readyState===WebSocket.CLOSED||k.readyState===WebSocket.CLOSING){console.log("[Visibility] WS was closed. Reconnecting now..."),re=1e3,Oe();return}if(P&&H&&H.startTime){console.log("[Visibility] Forcing immediate video resync.");const e=(Date.now()-H.startTime)/1e3;if(e>=H.originalDuration)console.log("[Visibility] Video expired while backgrounded. Reverting to preset."),P=!1,L&&(clearTimeout(L),L=null),Fe(),H=null,N&&ve(N);else if(o){const n=Math.abs(o.currentTime-e);console.log(`[Visibility] Drift: ${n.toFixed(2)}s → correcting to ${e.toFixed(2)}s`),o.currentTime=e,o.paused&&o.play().catch(()=>{})}yt()}}});const j=document.createElement("canvas");j.width=1024,j.height=1586;const ee=j.getContext("2d"),Y=new m.CanvasTexture(j);Y.colorSpace=m.SRGBColorSpace,Y.minFilter=m.LinearFilter,Y.generateMipmaps=!1;const le=document.createElement("canvas");le.width=256,le.height=256;const Tt=le.getContext("2d"),F=new m.CanvasTexture(le);F.colorSpace=m.SRGBColorSpace,F.wrapS=m.RepeatWrapping,F.wrapT=m.RepeatWrapping,F.minFilter=m.NearestFilter,F.magFilter=m.NearestFilter,F.generateMipmaps=!1;let ke=null;const q=document.createElement("canvas");q.width=1024,q.height=1024;const D=q.getContext("2d"),se=new m.CanvasTexture(q);se.colorSpace=m.SRGBColorSpace,se.minFilter=m.LinearFilter,se.generateMipmaps=!1;let Ve=0,xe=0,He=-1,We=[],_e=0,I=!1,X="idle",W=0;const wt=.3;let Ge=7,je=0,$e={};function K(e){X==="idle"&&($e=e||{},typeof $e.duration=="number"?Ge=$e.duration:Ge=7,X="transition_in",W=0,I=!0)}window[Le("1f0502100c1219320a041f1219320c10")]=async function(){try{const e=await fetch(Re("/api/mx-cfg"));if(!e.ok){K({});return}const n=await e.json();n.imageData?pe(n.imageData).then(t=>{G&&G.dispose(),G=t,K(n)}).catch(()=>K(n)):K(n)}catch(e){console.error("[Macrostasis]",e),K({})}};function J(){ke||(ke=Tt.createImageData(le.width,le.height));const e=ke.data,n=e.length;for(let t=0;t<n;t+=4){const i=Math.floor(Math.random()*255);e[t]=i,e[t+1]=i,e[t+2]=i,e[t+3]=255}Tt.putImageData(ke,0,0),F.needsUpdate=!0}const ze='"Sixtyfour", "SLNTHLN", monospace';function Ut(e,n,t,i){n.font=`${i}px ${ze}`;const d=e.split(`
`),a=[];for(const u of d){if(u.trim()===""){a.push("");continue}const s=u.split(" ");let r="";for(let l=0;l<s.length;l++){const f=s[l];if(f==="")continue;const p=r?r+" "+f:f;n.measureText(p).width>t?r?(a.push(r),r=f):(a.push(f),r=""):r=p}r&&a.push(r)}return a}let ye=null,Te=null;function S(e,n){const t=n||ie||"center";if(!(e===ye&&t===Te)){if(ye=e,Te=t,D.clearRect(0,0,q.width,q.height),e){D.save(),D.fillStyle="#ffffff",D.shadowColor="#ffffff";const i=850,d=850,a=16;let u=64,s=[],r=0,l=0;for(;u>=a;){if(r=Math.floor(u*1.35),s=Ut(e,D,i,u),l=s.length*r,l<=d){let c=!0;D.font=`${u}px ${ze}`;for(const y of s)if(D.measureText(y).width>i){c=!1;break}if(c)break}u-=2}D.font=`${u}px ${ze}`,D.shadowBlur=Math.max(2,Math.floor(u*.15));const f=40,p=q.width,v=q.height;let h,g,x;switch(t){case"top-left":h=f,g=f+r/2,x="left";break;case"top-right":h=p-f,g=f+r/2,x="right";break;case"top-center":h=p/2,g=f+r/2,x="center";break;case"bottom-left":h=f,g=v-f-l+r/2,x="left";break;case"bottom-right":h=p-f,g=v-f-l+r/2,x="right";break;case"bottom-center":h=p/2,g=v-f-l+r/2,x="center";break;default:h=p/2,g=v/2-(s.length-1)*r/2,x="center"}D.textAlign=x,D.textBaseline="middle";for(let c=0;c<s.length;c++){const y=s[c];y&&D.fillText(y,h,g+c*r)}D.restore()}se.needsUpdate=!0}}let Ye=null,w=null,qe=null,we=null,be=null,te=null;const Xe=()=>{if(!w)try{w=new(window.AudioContext||window.webkitAudioContext),console.log("[Brute Force Audio] Created new AudioContext on user interaction."),o&&Ke(o)}catch(e){console.error("[Brute Force Audio] Failed to create AudioContext:",e)}w&&w.state==="suspended"&&w.resume().then(()=>console.log("[Brute Force Audio] audioCtx resumed successfully! State:",w.state)).catch(e=>console.error("[Brute Force Audio] Failed to resume audioCtx:",e)),o&&o.dataset.shouldPlayAudio!=="false"&&(o.muted&&(o.muted=!1,console.log("[Brute Force Audio] activeVideo unmuted!")),ge(),o.paused&&o.play().then(()=>console.log("[Brute Force Audio] Forced activeVideo playback to start!")).catch(n=>console.error("[Brute Force Audio] Forced activeVideo play failed:",n)))};window.addEventListener("click",Xe),window.addEventListener("touchstart",Xe),window.addEventListener("keydown",Xe);function Ke(e){try{if(!w){w=new(window.AudioContext||window.webkitAudioContext);const n=()=>{w.state==="suspended"&&w.resume()};window.addEventListener("click",n),window.addEventListener("mousemove",n),window.addEventListener("touchstart",n),window.addEventListener("keydown",n)}qe?console.log("[Web Audio] Reusing existing MediaElementSourceNode connection."):(qe=w.createMediaElementSource(e),we=w.createBiquadFilter(),we.type="highpass",we.frequency.value=180,be=w.createBiquadFilter(),be.type="lowpass",be.frequency.value=4e3,te=w.createBiquadFilter(),te.type="peaking",te.frequency.value=1e3,te.Q.value=1.2,te.gain.value=8,qe.connect(we),we.connect(be),be.connect(te),te.connect(w.destination),console.log("[Web Audio] Filter chain connected and created successfully.")),w.state==="suspended"&&w.resume()}catch(n){console.error("Web Audio API setup failed:",n)}}function bt(e){if(!e)return null;const n=/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/,t=e.match(n);return t&&t[2].length===11?t[2]:null}async function Dt(e){const n=["https://cobalt.projectsegfau.lt","https://cobalt.api.ryder.xyz","https://api.cobalt.tools","https://api.cobalt.download","https://cobalt.moe"],t=["https://api.piped.private.coffee"],i=["https://inv.thepixora.com","https://invidious.flokinet.to","https://invidious.nerdvpn.de","https://invidious.tiekoetter.com","https://inv.nadeko.net","https://yewtu.be"],d=async l=>{const f=new AbortController,p=setTimeout(()=>f.abort(),6e3);try{const v=await fetch(l.endsWith("/")?l:l+"/",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({url:`https://www.youtube.com/watch?v=${e}`,videoQuality:"720"}),signal:f.signal});if(clearTimeout(p),!v.ok)throw new Error(`HTTP ${v.status}`);const h=await v.json();if((h.status==="stream"||h.status==="redirect"||h.status==="success")&&h.url)return console.log(`[YouTube Client] Success from Cobalt instance: ${l}`),h.url;throw new Error(`Invalid Cobalt response status: ${h.status}`)}catch(v){throw clearTimeout(p),v}},a=async l=>{const f=new AbortController,p=setTimeout(()=>f.abort(),6e3);try{const v=await fetch(`${l}/streams/${e}`,{signal:f.signal});if(clearTimeout(p),!v.ok)throw new Error(`HTTP ${v.status}`);const h=await v.json();if(!h.videoStreams||h.videoStreams.length===0)throw new Error("No videoStreams");const g=h.videoStreams.find(x=>x.format==="MPEG_4"||x.mimeType.includes("video/mp4"));if(!g||!g.url)throw new Error("No MP4 stream found");return console.log(`[YouTube Client] Success from Piped instance: ${l}`),g.url}catch(v){throw clearTimeout(p),v}},u=async l=>{const f=new AbortController,p=setTimeout(()=>f.abort(),6e3);try{const v=await fetch(`${l}/api/v1/videos/${e}`,{signal:f.signal});if(clearTimeout(p),!v.ok)throw new Error(`HTTP ${v.status}`);const h=await v.json();if(!h.formatStreams||h.formatStreams.length===0)throw new Error("No formatStreams");const g=h.formatStreams.find(c=>c.container==="mp4"||c.type.includes("video/mp4"));if(!g||!g.url)throw new Error("No MP4 stream found");let x=g.url;if(x.includes("local=true")||(x+=x.includes("?")?"&local=true":"?local=true"),x.startsWith("/"))x=l+x;else if(x.startsWith("http")){const c=new URL(x),y=new URL(l);c.host=y.host,c.protocol=y.protocol,c.searchParams.has("local")||c.searchParams.set("local","true"),x=c.toString()}return console.log(`[YouTube Client] Success from Invidious instance: ${l}`),x}catch(v){throw clearTimeout(p),v}},s=l=>new Promise((f,p)=>{let v=[],h=0;l.forEach(g=>{Promise.resolve(g).then(f).catch(x=>{v.push(x),h++,h===l.length&&p(new Error("All client instances failed: "+v.map(c=>c.message).join(", ")))})})}),r=[...n.map(d),...t.map(a),...i.map(u)];try{return await s(r)}catch(l){throw console.error("[YouTube Client] All client-side resolution attempts failed:",l),l}}async function St(e){try{const n=await fetch(Re(`/api/yt-resolve?id=${e}`));if(!n.ok)throw new Error(`Server returned HTTP ${n.status}`);const t=await n.json();if(!t.url)throw new Error("Server response missing URL");return t.url.startsWith("/api/")?Re(t.url):t.url}catch(n){return console.warn("[YouTube] Server proxy failed. Falling back to client-side Piped/Invidious racing...",n.message),await Dt(e)}}async function Je(e,n,t){let i=e;if(!e){Ye=null,T&&(T.destroy(),T=null),o&&(o.pause(),o.removeAttribute("src"),o.load()),R&&(R.dispose(),R=null);return}const d=bt(e);if(d)try{i=await St(d)}catch(s){console.error("Failed to resolve YouTube video:",s);return}if(i===Ye&&o){o.loop=n,o.muted=!t,o.dataset.shouldPlayAudio=!!t;return}Ye=i,T&&(T.destroy(),T=null);let a=!1;o||(o=document.createElement("video"),o.preload="auto",o.playsInline=!0,o.webkitPlaysInline=!0,o.crossOrigin="anonymous",a=!0),o.loop=n,o.muted=!t,o.dataset.shouldPlayAudio=!!t,o.crossOrigin="anonymous";const u=vt(i);if(u.includes(".m3u8")&&typeof Hls<"u"?Hls.isSupported()?(T=new Hls({maxBufferLength:8,maxMaxBufferLength:12,enableWorker:!0,lowLatencyMode:!0}),T.attachMedia(o),T.loadSource(u),T.on(Hls.Events.MANIFEST_PARSED,()=>{console.log("[HLS.js] Manifest loaded, playing...")}),T.on(Hls.Events.ERROR,(s,r)=>{if(r.fatal)switch(r.type){case Hls.ErrorTypes.NETWORK_ERROR:console.warn("[HLS.js] Network error, attempting recovery...",r),T.startLoad();break;case Hls.ErrorTypes.MEDIA_ERROR:console.warn("[HLS.js] Media error, attempting recovery...",r),T.recoverMediaError();break;default:console.error("[HLS.js] Unrecoverable error",r);break}})):o.canPlayType("application/vnd.apple.mpegurl")&&(o.src=u,o.load()):(o.src=u,o.load()),ge(),a)try{Ke(o)}catch(s){console.error("Audio filter setup failed:",s)}R||(R=new m.VideoTexture(o),R.colorSpace=m.SRGBColorSpace,R.minFilter=m.LinearFilter,R.generateMipmaps=!1),o.play().then(()=>{console.log("Preset video play started successfully.")}).catch(s=>{console.log("Preset video autoplay blocked. Retrying with mute...",s),o.muted=!0,o.play().then(()=>{console.log("Preset muted fallback autoplay succeeded!");const r=()=>{o.muted=!t,ge(),w&&w.state==="suspended"&&w.resume(),console.log("User interacted. Restored preset audio state."),document.removeEventListener("click",r),document.removeEventListener("keydown",r),document.removeEventListener("touchstart",r)};document.addEventListener("click",r),document.addEventListener("keydown",r),document.addEventListener("touchstart",r)}).catch(r=>{console.error("Preset even muted autoplay failed:",r)})})}function Bt(){new m.TextureLoader;const e=document.createElement("canvas");e.width=1,e.height=1;const n=new m.CanvasTexture(e);return n.colorSpace=m.SRGBColorSpace,z=null,Q=n,Ie=n,G=null,new Promise(t=>{U=t,setTimeout(()=>{U&&(U(),U=null)},1800),Oe()})}function Ct(e){const n=Math.floor(e/60),t=e%60;if(n!==He){He=n,We=[];const a=Math.max(1,ht),u=Math.max(.1,ft),s=Math.max(u,mt),r=60/a;for(let l=0;l<a;l++){const f=u+Math.random()*(s-u),p=l*r,v=Math.max(0,r-f),h=p+Math.random()*v;We.push({start:h,end:h+f})}}let i=!1;for(const a of We)if(t>=a.start&&t<=a.end){i=!0;break}return _e+=((i?1:0)-_e)*.12,Math.min(Math.max(_e,0),1)}function Mt(e,n,t){if(!e)return;e.uIsVideo&&(e.uIsVideo.value=A.mode==="video"?1:0),e.uPowerOff&&(e.uPowerOff.value=A.mode==="custom_image"&&!E?1:0),e.uScaleX&&e.uScaleY&&(e.uScaleX.value=1,e.uScaleY.value=1),e.uTextureText.value=se,typeof e.uFilterMode<"u"&&(e.uFilterMode.value=$),e.uFilterColor&&e.uFilterColor.value.set(me);const i=()=>{b?S(b):je>0?(je-=t,S(Le("283f4b3c3c"),"top-left")):S("")};if(X==="transition_in"){if(W+=t,I=!0,J(),S(""),e.uTexture.value=F,e.uChildVisibility.value=0,W>=wt){if(X="active",W=0,I=!1,ee.clearRect(0,0,j.width,j.height),G&&G.image){ee.save(),ee.filter="invert(1)";const a=720,u=a*(769/612),s=(j.width-a)/2,r=(j.height-u)/2;ee.drawImage(G.image,s,r,a,u),ee.restore()}Y.needsUpdate=!0}return}if(X==="active"){W+=t,I=!1,b?S(b,ie):W<=2?S(Le("283f4b3a3f342f2f"),"top-left"):S(""),e.uScaleX&&(e.uScaleX.value=1.936872),e.uTexture.value=Y,e.uChildVisibility.value=0,W>=Ge&&(X="transition_out",W=0,I=!0);return}if(X==="transition_out"){W+=t,I=!0,J(),S(""),e.uTexture.value=F,e.uChildVisibility.value=0,W>=wt&&(X="idle",W=0,I=!1,je=2);return}if(V==="static"){I=!1,J(),e.uTexture.value=F,e.uChildVisibility.value=0,S(b||"");return}if(V==="custom_image"&&E){I=!1,e.uTexture.value=E,e.uChildVisibility.value=0,S(b||"");return}if(A.mode==="static"){I=!1,J(),e.uTexture.value=F,S(b||""),e.uChildVisibility.value=0;return}if(A.mode==="custom_image"){I=!1,E?e.uTexture.value=E:(ee.fillStyle="#000000",ee.fillRect(0,0,j.width,j.height),Y.needsUpdate=!0,e.uTexture.value=Y),S(b||""),e.uChildVisibility.value=0;return}if(A.mode==="default"){I=!1,i(),E||z?(e.uScaleX&&(e.uScaleX.value=1.936872),e.uTexture.value=E||z,e.uTextureChild.value=Q,e.uChildVisibility.value=Ct(n)):(J(),e.uTexture.value=F,b||S("SEÑAL PENDIENTE"),e.uChildVisibility.value=0);return}if(A.mode==="video"){I=!1,R&&o&&(o.readyState>=2||o.currentTime>0)?(o.readyState>=2&&(R.needsUpdate=!0),e.uTexture.value=R):(J(),e.uTexture.value=F),S(b||""),e.uChildVisibility.value=0;return}if(A.mode==="slideshow"){const a=A.slideshow.images;if(!a||a.length===0){I=!1,J(),e.uTexture.value=F,b||S("SEÑAL PENDIENTE"),e.uChildVisibility.value=0;return}if(a.length<=1){I=!1;const u=a[0],s=st[u]||z;i(),e.uTexture.value=s,e.uChildVisibility.value=0;return}if(xe+=t,I)J(),S(""),e.uTexture.value=F,e.uChildVisibility.value=0,xe>=A.slideshow.transitionDuration&&(Ve=(Ve+1)%a.length,xe=0,I=!1);else{const u=a[Ve],s=st[u]||z;i(),e.uTexture.value=s,u===Le("4407340345130a03")?(e.uScaleX&&(e.uScaleX.value=1.936872),e.uTextureChild.value=Q,e.uChildVisibility.value=Ct(n)):e.uChildVisibility.value=0,xe>=A.slideshow.slideDuration&&(xe=0,I=!0)}}const d=e.uTexture.value;if(d&&d.image){const a=d.image;let u=!0;if(a instanceof HTMLVideoElement&&(a.readyState<2||a.paused)&&(u=!1),u)try{ut.drawImage(a,0,0,1,1);const s=ut.getImageData(0,0,1,1).data;let r=s[0]/255,l=s[1]/255,f=s[2]/255;const p=.299*r+.587*l+.114*f;if($===1)r=p*.22*1.35,l=p*1*1.35,f=p*.08*1.35;else if($===2)r=p*1*1.35,l=p*.15*1.35,f=p*.15*1.35;else if($===3)r=p*1*1.35,l=p*.82*1.35,f=0;else if($===4){const g=n*.15%1,x=new m.Color().setHSL(g,1,.5);r=p*x.r*1.5,l=p*x.g*1.5,f=p*x.b*1.5}else if($===5){const g=new m.Color(me);r=p*g.r*1.35,l=p*g.g*1.35,f=p*g.b*1.35}else r=r*.68,l=l*.73,f=f*.9;const v=.299*r+.587*l+.114*f;let h=1;v>.82&&(h=.82/v),he.setRGB(r*h,l*h,f*h)}catch{he.setHex(11196671)}else he.setHex(11196671)}else he.setHex(11196671)}function Nt(){L&&(clearTimeout(L),L=null),P=!1,o&&(o.pause(),o.src="",o.load()),k&&k.close(),E&&E.dispose(),Y.dispose(),F.dispose(),se.dispose(),R&&R.dispose()}const Ze=()=>{A.mode==="video"&&o&&o.paused&&o.play().catch(()=>{})};window.addEventListener("click",Ze),window.addEventListener("pointerdown",Ze),window.addEventListener("touchstart",Ze);/*! REJECTED FALSE ICONS (5/7) */const Et=e=>{const n=new m.Box3;let t=!1;return e.traverse(i=>{if(i.isMesh){const d=new m.Box3().setFromObject(i);t?n.union(d):(n.copy(d),t=!0)}}),n};function Ot(e,n,t,i){const d=new de.GLTFLoader;typeof MeshoptDecoder<"u"&&d.setMeshoptDecoder(MeshoptDecoder);const a=new Promise((u,s)=>{d.load("/crt-tv.glb",r=>{Ee("model",50),u(r)},r=>{let l=r.total;(!l||l===0)&&(l=4862760);const f=Math.min(r.loaded/l,1);Ee("model",f*50)},r=>{console.error("Error loading TV GLTF:",r),s(r)})});return Ee("texture1",10),Ee("texture2",10),a.then(u=>Bt().then(()=>u)).then(u=>{const s=new m.Group;e.add(s);const r=u.scene;s.add(r),r.position.set(0,0,0),r.rotation.set(0,Math.PI,0),r.scale.set(1,1,1),r.updateMatrixWorld(!0);const l=2.4,p=Et(r).getSize(new m.Vector3),v=l/p.y;r.scale.setScalar(v),r.updateMatrixWorld(!0);const h=Et(r),g=h.getCenter(new m.Vector3);r.position.x=-g.x,r.position.y=-h.min.y,r.position.z=-g.z,r.updateMatrixWorld(!0),r.traverse(M=>{M.isMesh&&(M.castShadow=!0,M.receiveShadow=!0,M.material&&(M.material.metalness=.05,M.material.roughness=.75,M.material.color&&M.material.color.multiplyScalar(1.5)))});const x=new m.PlaneGeometry(1.75,1.54,16,16),c=new m.ShaderMaterial({vertexShader:It,fragmentShader:Rt,uniforms:{uTime:{value:0},uTexture:{value:null},uTextureChild:{value:null},uTextureText:{value:null},uChildVisibility:{value:0},uMagneticCenter:{value:new m.Vector2(-10,-10)},uMagneticTime:{value:0},uMagneticIntensity:{value:0},uMagneticBuildup:{value:0},uMagneticVelocity:{value:new m.Vector2(0,0)},uFilterMode:{value:0},uFilterColor:{value:new m.Color("#ffffff")},uScaleX:{value:1},uScaleY:{value:1},uIsVideo:{value:0},uPowerOff:{value:0},uFogColor:{value:new m.Color(1185062)},uFogNear:{value:9},uFogFar:{value:25}}}),y=new m.Mesh(x,c),Se=h.max.z-g.z;y.position.set(0,1.3,Se-.08),s.add(y);const ce=new m.SpotLight(11196671,12,9,Math.PI/2.2,.95,1.1);ce.position.set(0,1.3,Se-.04);const Qe=new m.Object3D;Qe.position.set(0,0,Se+3.5),s.add(Qe),ce.target=Qe,s.add(ce);const Ce=new m.SpotLight(16733457,14,3.2,Math.PI/2.5,.9,2);Ce.position.set(0,1.3,Se-1.7);const et=new m.Object3D;et.position.set(0,1.3,Se-2.5),s.add(et),Ce.target=et,s.add(Ce);const C=new m.Vector3(0,0,12);s.position.copy(C),n.target.set(C.x,C.y+1.3,C.z),i.position.set(C.x,C.y+1.3,C.z),t.target=i;let Pe=!1,Ue=0;const tt=3.5,nt=.22;let De=0,Me=0,ue=0,ot=0,it=0,Be=0;return{tvGroup:s,crtScreen:y,crtLight:ce,internalCabinetLight:Ce,basePosition:C,update:(M,O)=>{if(c.uniforms.uTime.value=M,Be=Math.max(Be-O*5,0),ot*=Math.max(1-O*6,0),it*=Math.max(1-O*6,0),Pe){Ue=Math.min(Ue+O,tt);const _=Ue/tt;c.uniforms.uMagneticIntensity.value=Math.min(.15+_*.85+Be*.4,1.3),c.uniforms.uMagneticBuildup.value=_,c.uniforms.uMagneticTime.value+=O,c.uniforms.uMagneticVelocity.value.set(ot,it);const Z=Math.min(_*.032,.032);Z>.001?s.position.set(C.x+(Math.random()-.5)*Z,C.y+(Math.random()-.5)*Z,C.z+(Math.random()-.5)*Z):s.position.copy(C)}else if(Me>0)if(ue+=O,c.uniforms.uMagneticTime.value+=O,c.uniforms.uMagneticVelocity.value.set(0,0),ue<0){const _=(ue+nt)/nt,Z=Math.sin(_*Math.PI)*.55,ne=Math.min(De+Z,1.4);c.uniforms.uMagneticIntensity.value=ne,c.uniforms.uMagneticBuildup.value=ne,s.position.copy(C)}else{const _=Math.min(ue/Me,1),Z=1-_*_,ne=De*Z;if(ne<=.001||_>=1)c.uniforms.uMagneticIntensity.value=0,c.uniforms.uMagneticBuildup.value=0,Me=0,s.position.copy(C);else{c.uniforms.uMagneticIntensity.value=ne,c.uniforms.uMagneticBuildup.value=ne;const rt=ne*.032;s.position.set(C.x+(Math.random()-.5)*rt,C.y+(Math.random()-.5)*rt,C.z+(Math.random()-.5)*rt)}}else c.uniforms.uMagneticVelocity.value.set(0,0),I?s.position.set(C.x+(Math.random()-.5)*.012,C.y+(Math.random()-.5)*.012,C.z+(Math.random()-.5)*.012):s.position.copy(C);e.fog&&(c.uniforms.uFogColor.value.copy(e.fog.color),c.uniforms.uFogNear.value=e.fog.near,c.uniforms.uFogFar.value=e.fog.far),Mt(c.uniforms,M,O),ce.color.lerp(he,.12),ce.intensity=(1.4+Math.sin(M*35)*.18+Math.sin(M*7)*.06)*16,Ce.intensity=10+Math.sin(M*22)*.8+Math.sin(M*4)*.25,r.position.set(-g.x,-h.min.y,-g.z)},destroy:()=>{x.dispose(),c.dispose(),Nt(),e.remove(s)},startMagneticHold:M=>{Pe=!0,Ue=c.uniforms.uMagneticBuildup.value*tt,Me=0,ue=0,c.uniforms.uMagneticCenter.value.copy(M)},stopMagneticHold:()=>{Pe&&(Pe=!1,De=c.uniforms.uMagneticBuildup.value,Me=1.5+De*9,ue=-nt)},setVelocityBoost:(M,O)=>{const _=Math.sqrt(M*M+O*O);Be=Math.min(_*12,.6),ot=M*8,it=O*8}}})}window.KimerawareTV={loadTV:Ot,updateScreenManager:Mt}});
