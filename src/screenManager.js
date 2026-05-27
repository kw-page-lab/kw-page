import * as THREE from 'three';
import { setMilestone } from './loader.js';

// Fun is Infinite with Sega Enterprises (1/7)

export const CONFIG = {
  mode: 'default',

  slideshow: {
    images: [
      '/padre_transparente.webp',
    ],
    slideDuration: 12.0,
    transitionDuration: 0.45,
  },

  video: {
    url: '',
    loop: true,
    muted: true,
    autoplay: true,
  }
};

let textureLoader = null;
let defaultTexture = null;
let childTexture = null;
let eyeSigilTexture = null;

const loadedSlideTextures = {};
let activeVideo = null;
let videoTexture = null;

// Dynamic Canvas for CRT Screen image (desaturated, color graded in shader)
const canvas = document.createElement('canvas');
canvas.width = 1024;
canvas.height = 1586;
const ctx = canvas.getContext('2d');
const canvasTexture = new THREE.CanvasTexture(canvas);
canvasTexture.colorSpace = THREE.SRGBColorSpace;
canvasTexture.minFilter = THREE.LinearFilter;
canvasTexture.generateMipmaps = false;

// Dynamic Canvas for CRT Screen text overlay (un-desaturated, mapped to screen uv)
const textCanvas = document.createElement('canvas');
textCanvas.width = 1024;
textCanvas.height = 1024;
const textCtx = textCanvas.getContext('2d');
const textTexture = new THREE.CanvasTexture(textCanvas);
textTexture.colorSpace = THREE.SRGBColorSpace;
textTexture.minFilter = THREE.LinearFilter;
textTexture.generateMipmaps = false;

let currentSlideIndex = 0;
let slideTimer = 0.0;

let currentMinute = -1;
let appearances = [];
let currentVisibilityVal = 0.0;

export let inTransition = false;

// Easter egg state machine
let easterEggState = 'idle'; // 'idle', 'transition_in', 'active', 'transition_out'
let easterEggTimer = 0.0;
const EASTER_EGG_TRANSITION_DUR = 0.3; // 300ms channel change static
const EASTER_EGG_ACTIVE_DUR = 7.0; // 7 seconds total (Eye Sigil)
let postEasterEggTimer = 0.0; // Timer to display CH KW for 2 seconds after easter egg finishes

export function triggerEasterEgg() {
  if (easterEggState !== 'idle') return;
  easterEggState = 'transition_in';
  easterEggTimer = 0.0;
  inTransition = true;
}
window.triggerEasterEgg = triggerEasterEgg;

function drawNoiseOnCanvas() {
  const imgData = ctx.createImageData(canvas.width, canvas.height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const val = Math.floor(Math.random() * 255);
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
    data[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  canvasTexture.needsUpdate = true;
}

function updateTextTexture(text) {
  textCtx.clearRect(0, 0, textCanvas.width, textCanvas.height);
  if (text) {
    textCtx.save();
    textCtx.fillStyle = '#ffffff'; // White mask for shader-based green coloring
    textCtx.font = '64px "Sixtyfour", monospace';
    textCtx.textBaseline = 'top';
    textCtx.textAlign = 'left';
    textCtx.shadowColor = '#ffffff';
    textCtx.shadowBlur = 10;
    textCtx.fillText(text, 80, 80); // Inset from top-left (maps to screen uv)
    textCtx.restore();
  }
  textTexture.needsUpdate = true;
}

export function loadScreenAssets(loaderText1, loaderText2) {
  textureLoader = new THREE.TextureLoader();
  const promises = [];

  defaultTexture = loaderText1;
  childTexture = loaderText2;

  // Load the Eye Sigil texture for the easter egg
  promises.push(
    new Promise((resolve) => {
      textureLoader.load(
        '/Eye_Sigil.png',
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          eyeSigilTexture = tex;
          resolve(tex);
        },
        undefined,
        () => {
          console.error('Failed to load Eye Sigil texture');
          resolve(null);
        }
      );
    })
  );

  if (CONFIG.mode === 'slideshow') {
    CONFIG.slideshow.images.forEach((src) => {
      if (src === '/padre_transparente.webp') {
        loadedSlideTextures[src] = defaultTexture;
        return;
      }
      promises.push(
        new Promise((resolve) => {
          textureLoader.load(
            src,
            (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.minFilter = THREE.LinearFilter;
              tex.generateMipmaps = false;
              loadedSlideTextures[src] = tex;
              resolve(tex);
            },
            undefined,
            () => {
              console.error(`Failed to load slide: ${src}`);
              resolve(null);
            }
          );
        })
      );
    });
  }

  if (CONFIG.mode === 'video' && CONFIG.video.url) {
    promises.push(
      new Promise((resolve) => {
        activeVideo = document.createElement('video');
        activeVideo.src = CONFIG.video.url;
        activeVideo.crossOrigin = 'anonymous';
        activeVideo.loop = CONFIG.video.loop;
        activeVideo.muted = CONFIG.video.muted;
        activeVideo.playsInline = true;

        activeVideo.onloadeddata = () => {
          videoTexture = new THREE.VideoTexture(activeVideo);
          videoTexture.colorSpace = THREE.SRGBColorSpace;
          videoTexture.minFilter = THREE.LinearFilter;
          videoTexture.generateMipmaps = false;
          resolve(videoTexture);
        };
        activeVideo.onerror = () => {
          console.error(`Failed to load video: ${CONFIG.video.url}`);
          resolve(null);
        };

        if (CONFIG.video.autoplay) {
          activeVideo.autoplay = true;
          activeVideo.play().catch(() => {});
        }
      })
    );
  }

  return Promise.all(promises);
}

function updateChildVisibility(elapsedTime) {
  const minute = Math.floor(elapsedTime / 60);
  const secondInMinute = elapsedTime % 60;

  if (minute !== currentMinute) {
    currentMinute = minute;
    const dur1 = 2.0 + Math.random() * 2.0;
    const dur2 = 2.0 + Math.random() * 2.0;
    const dur3 = 10.0 - dur1 - dur2;
    
    const start1 = Math.random() * (15 - dur1);
    const start2 = 18 + Math.random() * (17 - dur2);
    const start3 = 38 + Math.random() * (14 - dur3);

    appearances = [
      { start: start1, end: start1 + dur1 },
      { start: start2, end: start2 + dur2 },
      { start: start3, end: start3 + dur3 }
    ];
  }

  let visible = false;
  for (const app of appearances) {
    if (secondInMinute >= app.start && secondInMinute <= app.end) {
      visible = true;
      break;
    }
  }

  const targetVal = visible ? 1.0 : 0.0;
  currentVisibilityVal += (targetVal - currentVisibilityVal) * 0.12;
  return Math.min(Math.max(currentVisibilityVal, 0.0), 1.0);
}

export function updateScreenManager(uniforms, elapsedTime, deltaTime) {
  if (!uniforms) return;

  if (CONFIG.mode === 'video' && activeVideo && activeVideo.paused) {
    activeVideo.play().catch(() => {});
  }

  // Always link the text texture to its uniform slot
  uniforms.uTextureText.value = textTexture;

  // Handle Easter Egg State Machine
  if (easterEggState === 'transition_in') {
    easterEggTimer += deltaTime;
    inTransition = true;
    
    drawNoiseOnCanvas();
    updateTextTexture('');
    uniforms.uTexture.value = canvasTexture;
    uniforms.uChildVisibility.value = 0.0;

    if (easterEggTimer >= EASTER_EGG_TRANSITION_DUR) {
      easterEggState = 'active';
      easterEggTimer = 0.0;
      inTransition = false;
    }
    return;
  }
  
  if (easterEggState === 'active') {
    easterEggTimer += deltaTime;
    inTransition = false;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw Eye Sigil
    if (eyeSigilTexture && eyeSigilTexture.image) {
      ctx.save();
      ctx.filter = 'invert(1)'; // Invert black lines to white so they are bright and visible on dark background
      const w = 720;
      const h = w * (769 / 612);
      const x = (canvas.width - w) / 2;
      const y = (canvas.height - h) / 2;
      ctx.drawImage(eyeSigilTexture.image, x, y, w, h);
      ctx.restore();
    }
    
    // Draw green text in top-left: CH MTCDX for first 2 seconds, then hide text for the remaining 5 seconds
    if (easterEggTimer <= 2.0) {
      updateTextTexture('CH MTCDX');
    } else {
      updateTextTexture('');
    }

    canvasTexture.needsUpdate = true;
    uniforms.uTexture.value = canvasTexture;
    uniforms.uChildVisibility.value = 0.0;

    if (easterEggTimer >= EASTER_EGG_ACTIVE_DUR) {
      easterEggState = 'transition_out';
      easterEggTimer = 0.0;
      inTransition = true;
    }
    return;
  }

  if (easterEggState === 'transition_out') {
    easterEggTimer += deltaTime;
    inTransition = true;

    drawNoiseOnCanvas();
    updateTextTexture('');
    uniforms.uTexture.value = canvasTexture;
    uniforms.uChildVisibility.value = 0.0;

    if (easterEggTimer >= EASTER_EGG_TRANSITION_DUR) {
      easterEggState = 'idle';
      easterEggTimer = 0.0;
      inTransition = false;
      // Start the 2-second CH KW timer upon returning to default state
      postEasterEggTimer = 2.0;
    }
    return;
  }

  if (CONFIG.mode === 'default') {
    inTransition = false;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (defaultTexture && defaultTexture.image) {
      ctx.drawImage(defaultTexture.image, 0, 0, canvas.width, canvas.height);
    }

    // Only draw CH KW if the post-easter egg timer is active
    if (postEasterEggTimer > 0.0) {
      postEasterEggTimer -= deltaTime;
      updateTextTexture('CH KW');
    } else {
      updateTextTexture('');
    }
    
    canvasTexture.needsUpdate = true;
    uniforms.uTexture.value = canvasTexture;
    uniforms.uTextureChild.value = childTexture;
    uniforms.uChildVisibility.value = updateChildVisibility(elapsedTime);
    return;
  }

  if (CONFIG.mode === 'video') {
    inTransition = false;
    if (videoTexture) {
      uniforms.uTexture.value = videoTexture;
    }
    updateTextTexture('');
    uniforms.uChildVisibility.value = 0.0;
    return;
  }

  if (CONFIG.mode === 'slideshow') {
    const images = CONFIG.slideshow.images;
    if (images.length <= 1) {
      inTransition = false;
      const singleSlideUrl = images[0] || '/padre_transparente.webp';
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const slideTex = loadedSlideTextures[singleSlideUrl] || defaultTexture;
      if (slideTex && slideTex.image) {
        ctx.drawImage(slideTex.image, 0, 0, canvas.width, canvas.height);
      }

      // Only draw CH KW if the post-easter egg timer is active
      if (postEasterEggTimer > 0.0) {
        postEasterEggTimer -= deltaTime;
        updateTextTexture('CH KW');
      } else {
        updateTextTexture('');
      }

      canvasTexture.needsUpdate = true;
      uniforms.uTexture.value = canvasTexture;

      if (singleSlideUrl.includes('padre_transparente')) {
        uniforms.uTextureChild.value = childTexture;
        uniforms.uChildVisibility.value = updateChildVisibility(elapsedTime);
      } else {
        uniforms.uChildVisibility.value = 0.0;
      }
      return;
    }

    slideTimer += deltaTime;
    if (inTransition) {
      drawNoiseOnCanvas();
      updateTextTexture('');
      uniforms.uTexture.value = canvasTexture;
      uniforms.uChildVisibility.value = 0.0;

      if (slideTimer >= CONFIG.slideshow.transitionDuration) {
        currentSlideIndex = (currentSlideIndex + 1) % images.length;
        slideTimer = 0.0;
        inTransition = false;
      }
    } else {
      const currentSlideUrl = images[currentSlideIndex];
      const slideTex = loadedSlideTextures[currentSlideUrl] || defaultTexture;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (slideTex && slideTex.image) {
        ctx.drawImage(slideTex.image, 0, 0, canvas.width, canvas.height);
      }

      // Only draw CH KW if the post-easter egg timer is active
      if (postEasterEggTimer > 0.0) {
        postEasterEggTimer -= deltaTime;
        updateTextTexture('CH KW');
      } else {
        updateTextTexture('');
      }

      canvasTexture.needsUpdate = true;
      uniforms.uTexture.value = canvasTexture;

      if (currentSlideUrl.includes('padre_transparente')) {
        uniforms.uTextureChild.value = childTexture;
        uniforms.uChildVisibility.value = updateChildVisibility(elapsedTime);
      } else {
        uniforms.uChildVisibility.value = 0.0;
      }

      if (slideTimer >= CONFIG.slideshow.slideDuration) {
        slideTimer = 0.0;
        inTransition = true;
      }
    }
  }
}

export function destroyScreenManager() {
  if (activeVideo) {
    activeVideo.pause();
    activeVideo.src = "";
    activeVideo.load();
  }
  canvasTexture.dispose();
  textTexture.dispose();
  if (videoTexture) videoTexture.dispose();
}

// KIng Yellow (7/7)
