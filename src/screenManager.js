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

const loadedSlideTextures = {};
let activeVideo = null;
let videoTexture = null;

const noiseCanvas = document.createElement('canvas');
noiseCanvas.width = 128;
noiseCanvas.height = 128;
const noiseCtx = noiseCanvas.getContext('2d');
const noiseTexture = new THREE.CanvasTexture(noiseCanvas);
noiseTexture.colorSpace = THREE.SRGBColorSpace;
noiseTexture.minFilter = THREE.LinearFilter;
noiseTexture.generateMipmaps = false;

let currentSlideIndex = 0;
let slideTimer = 0.0;

let currentMinute = -1;
let appearances = [];
let currentVisibilityVal = 0.0;

export let inTransition = false;

export function loadScreenAssets(loaderText1, loaderText2) {
  textureLoader = new THREE.TextureLoader();
  const promises = [];

  defaultTexture = loaderText1;
  childTexture = loaderText2;

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

  if (CONFIG.mode === 'default') {
    inTransition = false;
    uniforms.uTexture.value = defaultTexture;
    uniforms.uTextureChild.value = childTexture;
    uniforms.uChildVisibility.value = updateChildVisibility(elapsedTime);
    return;
  }

  if (CONFIG.mode === 'video') {
    inTransition = false;
    if (videoTexture) {
      uniforms.uTexture.value = videoTexture;
    }
    uniforms.uChildVisibility.value = 0.0;
    return;
  }

  if (CONFIG.mode === 'slideshow') {
    const images = CONFIG.slideshow.images;
    if (images.length <= 1) {
      inTransition = false;
      const singleSlideUrl = images[0] || '/padre_transparente.webp';
      uniforms.uTexture.value = loadedSlideTextures[singleSlideUrl] || defaultTexture;
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
      if (noiseCtx) {
        const imgData = noiseCtx.createImageData(noiseCanvas.width, noiseCanvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const val = Math.floor(Math.random() * 255);
          data[i] = val;
          data[i + 1] = val;
          data[i + 2] = val;
          data[i + 3] = 255;
        }
        noiseCtx.putImageData(imgData, 0, 0);
        noiseTexture.needsUpdate = true;
      }

      uniforms.uTexture.value = noiseTexture;
      uniforms.uChildVisibility.value = 0.0;

      if (slideTimer >= CONFIG.slideshow.transitionDuration) {
        currentSlideIndex = (currentSlideIndex + 1) % images.length;
        slideTimer = 0.0;
        inTransition = false;
      }
    } else {
      const currentSlideUrl = images[currentSlideIndex];
      uniforms.uTexture.value = loadedSlideTextures[currentSlideUrl] || defaultTexture;

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
  noiseTexture.dispose();
  if (videoTexture) videoTexture.dispose();
}
// KIng Yellow (7/7)
