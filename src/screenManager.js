import * as THREE from 'three';

function dec(hex) {
  const key = import.meta.env.VITE_XOR_KEY_STRING || 'kw';
  let res = '';
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    const keyChar = key.charCodeAt((i / 2) % key.length);
    res += String.fromCharCode(byte ^ keyChar);
  }
  return res;
}

// loadEncryptedAsset removed — all assets are now served via WebSocket/API from the admin panel.

export const CONFIG = {
  mode: 'default',

  slideshow: {
    images: [],
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

// WebSockets real-time events state
let ws = null;
let wsTexture = null;
let wsText = '';
let wsMode = 'idle'; // 'idle', 'static', 'custom_image', 'disconnected'
let wsFilterMode = 0; // 0=default, 1=green, 2=red, 3=yellow, 4=rainbow, 5=custom
let wsFilterColor = '#ffffff';
let wsTextPosition = 'center'; // center|top-left|top-right|top-center|bottom-left|bottom-right|bottom-center
let wsConnected = false;
let wsEverConnected = false;   // true once first connection established
let connectionGraceTimer = 8.0; // Grace period before showing 404 (mobile restart needs ~5s)
let wsReconnectDelay = 1000;   // Exponential backoff for mobile reconnects

export const crtAverageColor = new THREE.Color(0xaad8ff);

// Hidden 1x1 canvas for real-time ambient color reflection analysis
const analyserCanvas = document.createElement('canvas');
analyserCanvas.width = 1;
analyserCanvas.height = 1;
const analyserCtx = analyserCanvas.getContext('2d', { willReadFrequently: true });

let isImmediateVideoActive = false;
let videoOverrideTimeout = null;
let lastAppliedPreset = null;
let preloadingVideo = null;
let videoRequestId = 0;
let videoSyncData = null; // { startTime, originalDuration } for continuous self-correction
let videoSelfSyncInterval = null; // local interval to keep currentTime accurate

let originalChildTexture = null;
let childMinDuration = 3.0;
let childMaxDuration = 5.0;
let childFrequency = 5;

let initialLoadResolver = null;

const getWsUrl = () => {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'ws://localhost:8088';
  }
  return 'wss://kimeraware.macrostasis.dev/ws';
};

const getApiUrl = (path) => {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return path;
  }
  return `https://kimeraware.macrostasis.dev${path}`;
};

const getAssetUrl = (path) => {
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return path;
  }
  // If running on macrostasis.dev domain, relative path is perfectly fine
  if (hostname.includes('macrostasis.dev')) {
    return path;
  }
  // Otherwise (e.g. running on kimeraware.com served from GitHub Pages),
  // load the assets absolutely from the macrostasis.dev VPS (CORS enabled in Nginx)
  return `https://kimeraware.macrostasis.dev${path}`;
};

const ensureProxiedUrl = (url) => {
  if (!url) return url;
  let finalUrl = url;
  
  // Normalize any absolute or relative URLs containing /assets/ to be served from the proper VPS domain.
  // This completely bypasses cross-origin CORS blocks (e.g. kimeraware.macrostasis.dev assets requested from kimeraware.com).
  if (url.includes('/assets/')) {
    const pathPart = url.substring(url.indexOf('/assets/'));
    finalUrl = getAssetUrl(pathPart);
  }
  
  if (finalUrl.startsWith('http://') || finalUrl.startsWith('https://')) {
    if (!finalUrl.includes('/api/yt-proxy')) {
      const hostname = window.location.hostname;
      let shouldProxy = true;
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        try {
          const urlObj = new URL(url);
          if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
            shouldProxy = false;
          }
        } catch (e) {}
      }
      
      // Do not proxy if it's already a CORS-friendly public proxy/instance, contains local=true, or is a local asset
      if (
        finalUrl.includes('local=true') || 
        finalUrl.includes('/assets/') ||
        finalUrl.includes('assets/') ||
        finalUrl.includes('piped') || 
        finalUrl.includes('cobalt') || 
        finalUrl.includes('invidious') || 
        finalUrl.includes('yewtu.be') || 
        finalUrl.includes('nadeko.net')
      ) {
        shouldProxy = false;
      }
      
      if (shouldProxy) {
        finalUrl = getApiUrl(`/api/yt-proxy?url=${encodeURIComponent(finalUrl)}`);
      }
    }
  }
  
  // Add a unique cache buster to bypass Chrome's silent Web Audio CORS caching bug
  finalUrl += (finalUrl.includes('?') ? '&' : '?') + 't_cb=' + Date.now();
  return finalUrl;
};

function loadTextureFromBase64(base64Data) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = (err) => {
      reject(err);
    };
    
    // Normalize relative /assets/ URLs for cross-domain loading compatibility
    let srcUrl = base64Data;
    if (base64Data && base64Data.includes('/assets/')) {
      const pathPart = base64Data.substring(base64Data.indexOf('/assets/'));
      srcUrl = getAssetUrl(pathPart);
    }
    img.src = srcUrl;
  });
}

async function applyPresetInternal(data) {
  CONFIG.mode = data.mode || 'default';
  wsText = data.text || '';
  wsTextPosition = data.textPosition || 'center';
  // Invalidate text cache so new position takes effect
  lastText = null;
  lastTextPosition = null;
  childMinDuration = data.minDuration || 3.0;
  childMaxDuration = data.maxDuration || 5.0;
  childFrequency = data.frequencyPerMinute || 5;
  currentMinute = -1; // Force recalculation of timing

  const FILTER_MODE_MAP = {
    'default': 0,
    'green': 1,
    'red': 2,
    'yellow': 3,
    'rainbow': 4,
    'custom': 5
  };
  const fMode = data.filterMode || 'default';
  wsFilterMode = FILTER_MODE_MAP[fMode] !== undefined ? FILTER_MODE_MAP[fMode] : 0;
  wsFilterColor = data.filterColor || '#ffffff';

  // Extract Video options and load dynamically
  const videoUrl = data.videoUrl || '';
  const videoLoop = typeof data.videoLoop !== 'undefined' ? data.videoLoop : true;
  const videoAudio = typeof data.videoAudio !== 'undefined' ? data.videoAudio : true;

  if (CONFIG.mode === 'video') {
    updateVideoSource(videoUrl, videoLoop, videoAudio);
  } else {
    updateVideoSource(null, false, false);
  }

  // Load custom images if sent
  if (data.mainImageData) {
    const oldTex = wsTexture;
    wsTexture = await loadTextureFromBase64(data.mainImageData);
    if (CONFIG.mode === 'custom_image') {
      wsMode = 'custom_image';
    } else {
      wsMode = 'idle';
    }
    if (oldTex) {
      oldTex.dispose();
    }
  } else {
    wsMode = 'idle';
    if (wsTexture) {
      wsTexture.dispose();
    }
    wsTexture = null;
  }

  if (data.childImageData) {
    const oldTex = childTexture;
    childTexture = await loadTextureFromBase64(data.childImageData);
    if (oldTex && oldTex !== defaultTexture && oldTex !== originalChildTexture) {
      oldTex.dispose();
    }
  } else {
    childTexture = originalChildTexture || defaultTexture;
  }
}

// ── Video sync helpers ────────────────────────────────────────────────────────
// Calculates the expected currentTime from absolute startTime and corrects
// the video if the drift is larger than the tolerance threshold (0.3 s).
function applyVideoSync(startTime, originalDuration) {
  if (!activeVideo || activeVideo.paused || !startTime) return;
  
  let expectedTime = (Date.now() - startTime) / 1000;
  const maxTime = originalDuration || Infinity;
  if (expectedTime < 0 || expectedTime >= maxTime) return;
  
  // Wrap expectedTime around the video's actual duration if it is looping to prevent infinite bounce/seek loops
  if (activeVideo.duration && activeVideo.loop) {
    expectedTime = expectedTime % activeVideo.duration;
  }
  
  const drift = Math.abs(activeVideo.currentTime - expectedTime);
  if (drift > 0.5) {
    console.log(`[Sync] Drift detected: ${drift.toFixed(2)}s — correcting to ${expectedTime.toFixed(2)}s`);
    activeVideo.currentTime = expectedTime;
  }
}

// Starts a local 2-second interval that self-corrects playback using
// the last known videoSyncData even if the WS heartbeat is slow/missing.
function startVideoSelfSync() {
  if (videoSelfSyncInterval) clearInterval(videoSelfSyncInterval);
  videoSelfSyncInterval = setInterval(() => {
    if (!isImmediateVideoActive || !videoSyncData) {
      stopVideoSelfSync();
      return;
    }
    applyVideoSync(videoSyncData.startTime, videoSyncData.originalDuration);
  }, 2000);
}

function stopVideoSelfSync() {
  if (videoSelfSyncInterval) {
    clearInterval(videoSelfSyncInterval);
    videoSelfSyncInterval = null;
  }
}

// ── AES-256-GCM WebSocket Cipher ───────────────────────────────────────
// Key is derived at runtime via HMAC-SHA256 using the existing XOR key bytes
// as secret material. The raw AES key is NEVER stored; only held in CryptoKey.
let _wsCryptoKey = null;

async function getWsCryptoKey() {
  if (_wsCryptoKey) return _wsCryptoKey;
  // Pull key bytes from env — these are the XOR bytes already in the bundle
  const keyStr = import.meta.env.VITE_XOR_KEY_BYTES || '75,87,95,65,82,71';
  const keyBytes = new Uint8Array(keyStr.split(',').map(Number));
  // Salt ties derived key to this specific application context
  const salt = new TextEncoder().encode('kimeraware-ws-2025');
  // Import raw bytes as HMAC-SHA256 key material
  const hmacKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  // Derive 32 bytes of AES key material
  const derived = await crypto.subtle.sign('HMAC', hmacKey, salt);
  // Import derived bytes as AES-256-GCM key
  _wsCryptoKey = await crypto.subtle.importKey(
    'raw', derived, { name: 'AES-GCM' }, false, ['decrypt']
  );
  return _wsCryptoKey;
}

async function decryptWsMessage(raw) {
  try {
    // Wire format: base64( iv[12] || tag[16] || ciphertext[N] )
    const combined = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    const iv         = combined.slice(0, 12);
    const tag        = combined.slice(12, 28);
    const ciphertext = combined.slice(28);
    // SubtleCrypto AES-GCM expects ciphertext immediately followed by authTag
    const ciphertextWithTag = new Uint8Array(ciphertext.length + 16);
    ciphertextWithTag.set(ciphertext);
    ciphertextWithTag.set(tag, ciphertext.length);
    const key = await getWsCryptoKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, ciphertextWithTag
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (err) {
    // Fallback: try plain JSON for backwards compat or unencrypted debug messages
    try { return JSON.parse(raw); } catch { throw err; }
  }
}

function initWebSocket() {
  const url = getWsUrl();
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('Connected to KimeraWare Event Server');
    wsConnected = true;
    wsEverConnected = true;
    wsReconnectDelay = 1000; // Reset backoff on successful connection
    connectionGraceTimer = 0.0;
  };

  ws.onmessage = async (event) => {
    try {
      const data = await decryptWsMessage(event.data);
      console.log('WS Event received:', data.type);
      await handleWsMessageInternal(data);
    } catch (err) {
      console.error('Error handling WS event:', err);
    } finally {
      if (initialLoadResolver) {
        initialLoadResolver();
        initialLoadResolver = null;
      }
    }
  };

  async function handleWsMessageInternal(data) {
    // Invalidate text cache on any incoming websocket event to ensure fresh redraw of texts
    lastText = null;
    lastTextPosition = null;

    if (data.type === 'apply_preset') {
      lastAppliedPreset = data;
      if (data.textPosition) wsTextPosition = data.textPosition;
      if (isImmediateVideoActive) {
        console.log('Immediate video is active. Storing preset for later restoration.');
        return;
      }
      await applyPresetInternal(data);
    }

      if (data.type === 'trigger_video') {
        console.log('WS Event received: trigger_video', data);
        
        if (!isImmediateVideoActive) {
          if (!lastAppliedPreset) {
            lastAppliedPreset = {
              type: 'apply_preset',
              presetId: 'default',
              mode: 'default',
              text: '',
              filterMode: 'default',
              filterColor: '#ffffff',
              videoUrl: '',
              videoLoop: true,
              videoAudio: true,
              minDuration: 2.0,
              maxDuration: 4.0,
              frequencyPerMinute: 3,
              mainImageData: null,
              childImageData: null
            };
          }
        }

        // ── Expiry and elapsed time ───────────────────────────────────────────
        // originalDuration = full video duration as originally requested.
        // data.duration    = time remaining for reconnecting clients, full duration for new ones.
        // startTime        = absolute server timestamp (source of truth for sync).
        const originalDuration = parseFloat(data.originalDuration) || parseFloat(data.duration) || 30;
        const duration = parseFloat(data.duration) || 30;

        // Always derive elapsed from startTime when available (most accurate).
        let elapsedAtReceive = 0;
        if (data.startTime) {
          elapsedAtReceive = Math.max(0, (Date.now() - data.startTime) / 1000);
        } else {
          // Fallback: infer from the gap between originalDuration and remaining duration.
          elapsedAtReceive = Math.max(0, originalDuration - duration);
        }

        // Check if the video window has already fully expired.
        if (elapsedAtReceive >= originalDuration) {
          console.log(`Video override already expired (${elapsedAtReceive.toFixed(1)}s / ${originalDuration}s). Skipping.`);
          return;
        }

        const isFreshTrigger = (Date.now() - data.startTime) < 5000;

        // Measure time spent resolving the YouTube stream URL
        const messageReceivedTime = performance.now();

        // Bypassed: directly load the video without showing "SINTONIZANDO..." static screen

        // Increment Request ID to discard old requests
        const currentReqId = ++videoRequestId;

        let targetUrl = data.videoUrl || '';
        const ytId = getYouTubeId(targetUrl);
        if (ytId) {
          console.log('Resolving general YouTube ID for immediate video:', ytId);
          try {
            targetUrl = await resolveYouTubeStreamUrl(ytId);
          } catch (err) {
            console.error('Failed to resolve stream for immediate video:', err);
            // Revert static override on error
            wsMode = 'idle';
            wsText = '';
            return;
          }
        }

        // Discard if a newer request was sent during async resolution
        if (currentReqId !== videoRequestId) {
          console.log('Immediate video trigger superseded by a newer request.');
          return;
        }

        // Clean up previous video playback
        if (activeVideo) {
          activeVideo.pause();
          activeVideo.removeAttribute('src');
          activeVideo.load();
        }

        let isNewVideo = false;
        if (!activeVideo) {
          activeVideo = document.createElement('video');
          activeVideo.preload = 'auto';
          activeVideo.playsInline = true;
          activeVideo.webkitPlaysInline = true;
          activeVideo.crossOrigin = 'anonymous'; // Set crossOrigin to anonymous for WebGL texture upload compatibility
          isNewVideo = true;
        }

        activeVideo.loop = typeof data.videoLoop !== 'undefined' ? data.videoLoop : true;
        activeVideo.muted = typeof data.videoAudio !== 'undefined' ? !data.videoAudio : true;
        activeVideo.dataset.shouldPlayAudio = typeof data.videoAudio !== 'undefined' ? !!data.videoAudio : true;

        // Sync playback: seek as soon as we know where we are in the stream.
        // Mobile (iOS/Android) may not fire loadedmetadata reliably before canplay,
        // so we listen to both and apply the seek on whichever fires first.
        let seekApplied = false;
        const setSeekTime = () => {
          if (seekApplied) return;
          seekApplied = true;
          
          if (!isFreshTrigger) {
            const timeSpent = (performance.now() - messageReceivedTime) / 1000;
            // Always recalculate from startTime at the moment of seek for maximum accuracy.
            const nowElapsed = data.startTime
              ? Math.max(0, (Date.now() - data.startTime) / 1000)
              : elapsedAtReceive + timeSpent;
            if (nowElapsed > 0 && nowElapsed < originalDuration) {
              console.log(`[Seek] Jumping to ${nowElapsed.toFixed(2)}s (load delay: ${timeSpent.toFixed(2)}s)`);
              activeVideo.currentTime = nowElapsed;
            }
          }
        };
        activeVideo.addEventListener('loadedmetadata', setSeekTime, { once: true });
        activeVideo.addEventListener('canplay', setSeekTime, { once: true });

        activeVideo.crossOrigin = 'anonymous';
        activeVideo.src = ensureProxiedUrl(targetUrl);
        activeVideo.load();

        // If loop is disabled, exit override immediately when the video finishes playing
        if (!activeVideo.loop) {
          activeVideo.addEventListener('ended', async () => {
            console.log('Immediate video ended naturally. Reverting to active preset locally.');
            isImmediateVideoActive = false;
            if (videoOverrideTimeout) {
              clearTimeout(videoOverrideTimeout);
              videoOverrideTimeout = null;
            }
            if (lastAppliedPreset) {
              await applyPresetInternal(lastAppliedPreset);
            }
          });
        }

        if (isNewVideo) {
          try {
            setupAudioFilters(activeVideo);
          } catch (err) {
            console.error('Audio filter setup failed:', err);
          }
        }

        if (!videoTexture) {
          videoTexture = new THREE.VideoTexture(activeVideo);
          videoTexture.colorSpace = THREE.SRGBColorSpace;
          videoTexture.minFilter = THREE.LinearFilter;
          videoTexture.generateMipmaps = false;
        }

        // Start playback and sync logic when the video actually starts rendering
        const startPlaybackSync = () => {
          // Clear static override and activate video mode
          wsMode = 'idle';
          isImmediateVideoActive = true;
          CONFIG.mode = 'video';
          wsText = data.text || '';
          wsTextPosition = data.textPosition || 'center';

          if (videoOverrideTimeout) {
            clearTimeout(videoOverrideTimeout);
          }

          let remainingDuration;
          if (isFreshTrigger) {
            remainingDuration = originalDuration;
            // Send playback confirmation back to the server to synchronize the countdown faithfully
            if (ws && ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({
                  type: 'video_playing',
                  videoUrl: data.videoUrl || targetUrl,
                  originalDuration: originalDuration
                }));
                console.log('[WebSocket] Sent video_playing confirmation to server.');
              } catch (e) {
                console.error('[WebSocket] Failed to send video_playing confirmation:', e);
              }
            }
          } else if (data.startTime) {
            remainingDuration = Math.max(0.1, originalDuration - (Date.now() - data.startTime) / 1000);
          } else {
            remainingDuration = Math.max(0.1, originalDuration - elapsedAtReceive);
          }

          // Store sync data for continuous self-correction (only for non-fresh or late joiners)
          if (!isFreshTrigger) {
            videoSyncData = { startTime: data.startTime, originalDuration };
            startVideoSelfSync();
          }

          videoOverrideTimeout = setTimeout(() => {
            console.log('Immediate video override duration expired. Reverting to active preset.');
            isImmediateVideoActive = false;
            videoOverrideTimeout = null;
            stopVideoSelfSync();
            videoSyncData = null;
            if (lastAppliedPreset) {
              applyPresetInternal(lastAppliedPreset);
            }
          }, remainingDuration * 1000);
        };

        activeVideo.addEventListener('playing', startPlaybackSync, { once: true });

        activeVideo.play()
          .then(() => {
            console.log('Immediate video play started successfully.');
          })
          .catch((err) => {
            console.log('Immediate video autoplay blocked. Retrying with mute...', err);
            activeVideo.muted = true;
            activeVideo.play()
              .then(() => {
                console.log('Muted fallback autoplay succeeded! Click to unmute listener added.');
                const unmuteOnInteraction = () => {
                  activeVideo.muted = typeof data.videoAudio !== 'undefined' ? !data.videoAudio : false;
                  if (audioCtx && audioCtx.state === 'suspended') {
                    audioCtx.resume();
                  }
                  console.log('User interacted. Restored original audio state.');
                  document.removeEventListener('click', unmuteOnInteraction);
                  document.removeEventListener('keydown', unmuteOnInteraction);
                  document.removeEventListener('touchstart', unmuteOnInteraction);
                };
                document.addEventListener('click', unmuteOnInteraction);
                document.addEventListener('keydown', unmuteOnInteraction);
                document.addEventListener('touchstart', unmuteOnInteraction);
              })
              .catch((muteErr) => {
                console.error('Even muted autoplay failed:', muteErr);
                // Auto-trigger playback sync so the sintonizando static screen unlocks on blocker
                startPlaybackSync();
              });
          });
      }

      // ── Continuous sync heartbeat from server ─────────────────────────────────
      if (data.type === 'video_sync') {
        if (activeVideo && isImmediateVideoActive && data.startTime) {
          applyVideoSync(data.startTime, data.originalDuration);
        }
      }

      if (data.type === 'trigger_static') {
        wsMode = 'static';
        const duration = data.duration || 1.0;
        setTimeout(() => {
          wsMode = 'idle';
        }, duration * 1000);
      }

      if (data.type === 'image') {
        if (data.imageData) {
          const oldTex = wsTexture;
          wsTexture = await loadTextureFromBase64(data.imageData);
          wsMode = 'custom_image';
          if (oldTex) {
            oldTex.dispose();
          }
        }
      }

      if (data.type === 'text') {
        wsText = data.text || '';
        if (data.textPosition) wsTextPosition = data.textPosition;
        // Force redraw by invalidating cache
        lastText = null;
        lastTextPosition = null;
      }

      if (data.type === 'filter') {
        const FILTER_MODE_MAP = {
          'default': 0,
          'green': 1,
          'red': 2,
          'yellow': 3,
          'rainbow': 4,
          'custom': 5
        };
        const fMode = data.filterMode || 'default';
        wsFilterMode = FILTER_MODE_MAP[fMode] !== undefined ? FILTER_MODE_MAP[fMode] : 0;
        wsFilterColor = data.filterColor || '#ffffff';
      }

      if (data.type === 'reset') {
        isImmediateVideoActive = false;
        if (videoOverrideTimeout) {
          clearTimeout(videoOverrideTimeout);
          videoOverrideTimeout = null;
        }
        stopVideoSelfSync();
        videoSyncData = null;
        wsMode = 'idle';
        wsText = '';
        wsFilterMode = 0;
        wsFilterColor = '#ffffff';
        updateVideoSource(null, false, false);
        if (wsTexture) {
          wsTexture.dispose();
        }
        wsTexture = null;
        childTexture = originalChildTexture || defaultTexture;

        if (lastAppliedPreset) {
          console.log('Reset received. Restoring last applied preset:', lastAppliedPreset);
          await applyPresetInternal(lastAppliedPreset);
        }
      }

      if (data.type === 'trigger_easter_egg') {
        isImmediateVideoActive = false;
        if (videoOverrideTimeout) {
          clearTimeout(videoOverrideTimeout);
          videoOverrideTimeout = null;
        }
        // Easter egg now fully driven from admin: accepts optional overrides
        if (data.imageData) {
          // Load custom eye sigil from server asset
          loadTextureFromBase64(data.imageData).then(tex => {
            if (eyeSigilTexture) eyeSigilTexture.dispose();
            eyeSigilTexture = tex;
            triggerEasterEgg(data);
          }).catch(() => triggerEasterEgg(data));
        } else {
          triggerEasterEgg(data);
        }
      }
    }

  ws.onclose = () => {
    console.log(`WS connection closed. Reconnecting in ${wsReconnectDelay}ms...`);
    wsConnected = false;
    if (initialLoadResolver) {
      initialLoadResolver();
      initialLoadResolver = null;
    }
    setTimeout(() => {
      initWebSocket();
      // Cap backoff at 4s for fast recovery on mobile networks
      wsReconnectDelay = Math.min(wsReconnectDelay * 2, 4000);
    }, wsReconnectDelay);
  };

  ws.onerror = (err) => {
    console.error('WS error:', err);
    wsConnected = false;
    if (initialLoadResolver) {
      initialLoadResolver();
      initialLoadResolver = null;
    }
  };
}

// ── Mobile foreground recovery ────────────────────────────────────────────────
// When the browser tab comes back to the foreground after being backgrounded,
// setInterval is unreliable (throttled or paused). Force an immediate resync.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;

  console.log('[Visibility] Tab is visible again — checking sync...');

  // If WS is dead, reconnect immediately (skips the backoff wait).
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    console.log('[Visibility] WS was closed. Reconnecting now...');
    wsReconnectDelay = 1000; // reset backoff
    initWebSocket();
    return; // Server will send state on connect
  }

  // WS is alive: hard-correct video position immediately without waiting for next heartbeat.
  if (isImmediateVideoActive && videoSyncData && videoSyncData.startTime) {
    console.log('[Visibility] Forcing immediate video resync.');
    // Use a tight tolerance (0s) so any drift is corrected instantly on foreground.
    const expected = (Date.now() - videoSyncData.startTime) / 1000;
    if (expected >= videoSyncData.originalDuration) {
      // Video should have ended while we were in background
      console.log('[Visibility] Video expired while backgrounded. Reverting to preset.');
      isImmediateVideoActive = false;
      if (videoOverrideTimeout) {
        clearTimeout(videoOverrideTimeout);
        videoOverrideTimeout = null;
      }
      stopVideoSelfSync();
      videoSyncData = null;
      if (lastAppliedPreset) applyPresetInternal(lastAppliedPreset);
    } else if (activeVideo) {
      const drift = Math.abs(activeVideo.currentTime - expected);
      console.log(`[Visibility] Drift: ${drift.toFixed(2)}s → correcting to ${expected.toFixed(2)}s`);
      activeVideo.currentTime = expected;
      if (activeVideo.paused) activeVideo.play().catch(() => {});
    }
    // Restart self-sync interval (may have been throttled/killed while backgrounded)
    startVideoSelfSync();
  }
});

// Dynamic Canvas for CRT Screen image (desaturated, color graded in shader)
const canvas = document.createElement('canvas');
canvas.width = 1024;
canvas.height = 1586;
const ctx = canvas.getContext('2d');
const canvasTexture = new THREE.CanvasTexture(canvas);
canvasTexture.colorSpace = THREE.SRGBColorSpace;
canvasTexture.minFilter = THREE.LinearFilter;
canvasTexture.generateMipmaps = false;

// Low-resolution Dynamic Canvas for TV noise/static (reduces GPU uploads and CPU iterations by 25x)
const noiseCanvas = document.createElement('canvas');
noiseCanvas.width = 256;
noiseCanvas.height = 256;
const noiseCtx = noiseCanvas.getContext('2d');
const noiseTexture = new THREE.CanvasTexture(noiseCanvas);
noiseTexture.colorSpace = THREE.SRGBColorSpace;
noiseTexture.wrapS = THREE.RepeatWrapping;
noiseTexture.wrapT = THREE.RepeatWrapping;
noiseTexture.minFilter = THREE.NearestFilter;
noiseTexture.magFilter = THREE.NearestFilter;
noiseTexture.generateMipmaps = false;

let noiseImageData = null;

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
let EASTER_EGG_ACTIVE_DUR = 7.0; // configurable from admin
let postEasterEggTimer = 0.0;
let easterEggConfig = {}; // holds optional text/textPosition from admin

export function triggerEasterEgg(cfg) {
  if (easterEggState !== 'idle') return;
  easterEggConfig = cfg || {};
  if (typeof easterEggConfig.duration === 'number') {
    EASTER_EGG_ACTIVE_DUR = easterEggConfig.duration;
  } else {
    EASTER_EGG_ACTIVE_DUR = 7.0;
  }
  easterEggState = 'transition_in';
  easterEggTimer = 0.0;
  inTransition = true;
}

// Secret button: fetches easter egg config + image from server, triggers LOCAL-ONLY.
// Only the user who presses the button sees the effect — no broadcast.
// The server always returns imageData (defaults to eye_sigil.png if not configured).
window[dec('1f0502100c1219320a041f1219320c10')] = async function() {
  try {
    const res = await fetch(getApiUrl('/api/mx-cfg'));
    if (!res.ok) { triggerEasterEgg({}); return; }
    const cfg = await res.json();
    if (cfg.imageData) {
      loadTextureFromBase64(cfg.imageData).then(tex => {
        if (eyeSigilTexture) eyeSigilTexture.dispose();
        eyeSigilTexture = tex;
        triggerEasterEgg(cfg);
      }).catch(() => triggerEasterEgg(cfg));
    } else {
      triggerEasterEgg(cfg);
    }
  } catch(e) {
    console.error('[Macrostasis]', e);
    triggerEasterEgg({});
  }
};

function drawNoiseOnCanvas() {
  if (!noiseImageData) {
    noiseImageData = noiseCtx.createImageData(noiseCanvas.width, noiseCanvas.height);
  }
  const data = noiseImageData.data;
  const len = data.length;
  for (let i = 0; i < len; i += 4) {
    const val = Math.floor(Math.random() * 255);
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
    data[i + 3] = 255;
  }
  noiseCtx.putImageData(noiseImageData, 0, 0);
  noiseTexture.needsUpdate = true;
}

const FONT_FAMILY = '"Sixtyfour", "SLNTHLN", monospace';

function getWrappedLines(text, ctx, maxWidth, fontSize) {
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  const paragraphs = text.split('\n');
  const lines = [];

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    const words = paragraph.split(' ');
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (word === '') continue;
      const testLine = currentLine ? currentLine + ' ' + word : word;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth) {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          // Force push the word since it's wider than maxWidth
          lines.push(word);
          currentLine = '';
        }
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }
  return lines;
}

let lastText = null;
let lastTextPosition = null;

// Position values: center | top-left | top-right | top-center | bottom-left | bottom-right | bottom-center
function updateTextTexture(text, position) {
  const pos = position || wsTextPosition || 'center';
  if (text === lastText && pos === lastTextPosition) return;
  lastText = text;
  lastTextPosition = pos;

  textCtx.clearRect(0, 0, textCanvas.width, textCanvas.height);
  if (text) {
    textCtx.save();
    textCtx.fillStyle = '#ffffff';
    textCtx.shadowColor = '#ffffff';

    const maxW = 850;
    const maxH = 850;
    const minFontSize = 16;
    let fontSize = 64;
    let lines = [];
    let lineHeight = 0;
    let totalHeight = 0;

    // Scale font size down until everything fits
    while (fontSize >= minFontSize) {
      lineHeight = Math.floor(fontSize * 1.35);
      lines = getWrappedLines(text, textCtx, maxW, fontSize);
      totalHeight = lines.length * lineHeight;
      if (totalHeight <= maxH) {
        let fitsWidth = true;
        textCtx.font = `${fontSize}px ${FONT_FAMILY}`;
        for (const line of lines) {
          if (textCtx.measureText(line).width > maxW) {
            fitsWidth = false;
            break;
          }
        }
        if (fitsWidth) break;
      }
      fontSize -= 2;
    }

    textCtx.font = `${fontSize}px ${FONT_FAMILY}`;
    textCtx.shadowBlur = Math.max(2, Math.floor(fontSize * 0.15));

    // ── Resolve anchor from position string ─────────────────────────────
    const PAD = 40; // px padding from edges
    const W = textCanvas.width;
    const H = textCanvas.height;
    let anchorX, anchorY, align;

    switch (pos) {
      case 'top-left':
        anchorX = PAD; anchorY = PAD + lineHeight / 2;
        align = 'left';
        break;
      case 'top-right':
        anchorX = W - PAD; anchorY = PAD + lineHeight / 2;
        align = 'right';
        break;
      case 'top-center':
        anchorX = W / 2; anchorY = PAD + lineHeight / 2;
        align = 'center';
        break;
      case 'bottom-left':
        anchorX = PAD; anchorY = H - PAD - totalHeight + lineHeight / 2;
        align = 'left';
        break;
      case 'bottom-right':
        anchorX = W - PAD; anchorY = H - PAD - totalHeight + lineHeight / 2;
        align = 'right';
        break;
      case 'bottom-center':
        anchorX = W / 2; anchorY = H - PAD - totalHeight + lineHeight / 2;
        align = 'center';
        break;
      default: // center
        anchorX = W / 2;
        anchorY = H / 2 - ((lines.length - 1) * lineHeight) / 2;
        align = 'center';
    }

    textCtx.textAlign = align;
    textCtx.textBaseline = 'middle';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line) textCtx.fillText(line, anchorX, anchorY + i * lineHeight);
    }

    textCtx.restore();
  }
  textTexture.needsUpdate = true;
}


let currentVideoUrl = null;
let audioCtx = null;
let audioSourceNode = null;
let hpFilter = null;
let lpFilter = null;
let peakFilter = null;

// Permanent global brute-force audio activator to ensure AudioContext and video elements are unmuted
const forceActivateAudio = () => {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      console.log('[Brute Force Audio] Created new AudioContext on user interaction.');
      if (activeVideo) {
        setupAudioFilters(activeVideo);
      }
    } catch (e) {
      console.error('[Brute Force Audio] Failed to create AudioContext:', e);
    }
  }

  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume()
      .then(() => console.log('[Brute Force Audio] audioCtx resumed successfully! State:', audioCtx.state))
      .catch(e => console.error('[Brute Force Audio] Failed to resume audioCtx:', e));
  }

  if (activeVideo) {
    const shouldPlayAudio = activeVideo.dataset.shouldPlayAudio !== 'false';
    if (shouldPlayAudio) {
      if (activeVideo.muted) {
        activeVideo.muted = false;
        console.log('[Brute Force Audio] activeVideo unmuted!');
      }
      if (activeVideo.volume !== 1.0) {
        activeVideo.volume = 1.0;
      }
      if (activeVideo.paused) {
        activeVideo.play()
          .then(() => console.log('[Brute Force Audio] Forced activeVideo playback to start!'))
          .catch(e => console.error('[Brute Force Audio] Forced activeVideo play failed:', e));
      }
    }
  }
};

window.addEventListener('click', forceActivateAudio);
window.addEventListener('touchstart', forceActivateAudio);
window.addEventListener('keydown', forceActivateAudio);

function setupAudioFilters(videoElement) {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const resumeAudio = () => {
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
      };
      window.addEventListener('click', resumeAudio);
      window.addEventListener('mousemove', resumeAudio);
      window.addEventListener('touchstart', resumeAudio);
      window.addEventListener('keydown', resumeAudio);
    }
    
    // Crucial: Only create the MediaElementSourceNode ONCE per unique video element
    if (!audioSourceNode) {
      audioSourceNode = audioCtx.createMediaElementSource(videoElement);
      
      hpFilter = audioCtx.createBiquadFilter();
      hpFilter.type = 'highpass';
      hpFilter.frequency.value = 180;
      
      lpFilter = audioCtx.createBiquadFilter();
      lpFilter.type = 'lowpass';
      lpFilter.frequency.value = 4000;
      
      peakFilter = audioCtx.createBiquadFilter();
      peakFilter.type = 'peaking';
      peakFilter.frequency.value = 1000;
      peakFilter.Q.value = 1.2;
      peakFilter.gain.value = 8.0;
      
      audioSourceNode.connect(hpFilter);
      hpFilter.connect(lpFilter);
      lpFilter.connect(peakFilter);
      peakFilter.connect(audioCtx.destination);
      console.log('[Web Audio] Filter chain connected and created successfully.');
    } else {
      console.log('[Web Audio] Reusing existing MediaElementSourceNode connection.');
    }
    
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } catch (err) {
    console.error('Web Audio API setup failed:', err);
  }
}

function getYouTubeId(url) {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

async function resolveYouTubeStreamUrlClientSide(videoId) {
  const cobaltInstances = [
    'https://cobalt.projectsegfau.lt',
    'https://cobalt.api.ryder.xyz',
    'https://api.cobalt.tools',
    'https://api.cobalt.download',
    'https://cobalt.moe'
  ];

  const pipedInstances = [
    'https://api.piped.private.coffee'
  ];

  const invidiousInstances = [
    'https://inv.thepixora.com',
    'https://invidious.flokinet.to',
    'https://invidious.nerdvpn.de',
    'https://invidious.tiekoetter.com',
    'https://inv.nadeko.net',
    'https://yewtu.be'
  ];

  const fetchCobalt = async (instance) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(instance.endsWith('/') ? instance : instance + '/', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: `https://www.youtube.com/watch?v=${videoId}`,
          videoQuality: '720'
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if ((data.status === 'stream' || data.status === 'redirect' || data.status === 'success') && data.url) {
        console.log(`[YouTube Client] Success from Cobalt instance: ${instance}`);
        return data.url;
      }
      throw new Error(`Invalid Cobalt response status: ${data.status}`);
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  };

  const fetchPiped = async (instance) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`${instance}/streams/${videoId}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.videoStreams || data.videoStreams.length === 0) throw new Error('No videoStreams');
      
      const mp4Stream = data.videoStreams.find(s => s.format === 'MPEG_4' || s.mimeType.includes('video/mp4'));
      if (!mp4Stream || !mp4Stream.url) throw new Error('No MP4 stream found');
      
      console.log(`[YouTube Client] Success from Piped instance: ${instance}`);
      return mp4Stream.url;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  };

  const fetchInvidious = async (instance) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.formatStreams || data.formatStreams.length === 0) throw new Error('No formatStreams');
      
      const mp4Stream = data.formatStreams.find(s => s.container === 'mp4' || s.type.includes('video/mp4'));
      if (!mp4Stream || !mp4Stream.url) throw new Error('No MP4 stream found');
      
      let streamUrl = mp4Stream.url;
      if (!streamUrl.includes('local=true')) {
        streamUrl += streamUrl.includes('?') ? '&local=true' : '?local=true';
      }
      if (streamUrl.startsWith('/')) {
        streamUrl = instance + streamUrl;
      } else if (streamUrl.startsWith('http')) {
        const urlObj = new URL(streamUrl);
        const instanceUrl = new URL(instance);
        urlObj.host = instanceUrl.host;
        urlObj.protocol = instanceUrl.protocol;
        if (!urlObj.searchParams.has('local')) {
          urlObj.searchParams.set('local', 'true');
        }
        streamUrl = urlObj.toString();
      }
      console.log(`[YouTube Client] Success from Invidious instance: ${instance}`);
      return streamUrl;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  };

  const promiseAny = (promises) => {
    return new Promise((resolve, reject) => {
      let errors = [];
      let completedCount = 0;
      promises.forEach(p => {
        Promise.resolve(p).then(resolve).catch(err => {
          errors.push(err);
          completedCount++;
          if (completedCount === promises.length) {
            reject(new Error('All client instances failed: ' + errors.map(e => e.message).join(', ')));
          }
        });
      });
    });
  };

  const promises = [
    ...cobaltInstances.map(fetchCobalt),
    ...pipedInstances.map(fetchPiped),
    ...invidiousInstances.map(fetchInvidious)
  ];

  try {
    return await promiseAny(promises);
  } catch (err) {
    console.error('[YouTube Client] All client-side resolution attempts failed:', err);
    throw err;
  }
}

async function resolveYouTubeStreamUrl(videoId) {
  try {
    const res = await fetch(getApiUrl(`/api/yt-resolve?id=${videoId}`));
    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.url) {
      throw new Error('Server response missing URL');
    }
    if (data.url.startsWith('/api/')) {
      return getApiUrl(data.url);
    }
    return data.url;
  } catch (err) {
    console.warn('[YouTube] Server proxy failed. Falling back to client-side Piped/Invidious racing...', err.message);
    const clientUrl = await resolveYouTubeStreamUrlClientSide(videoId);
    return clientUrl; // Return direct clientUrl, no proxy needed!
  }
}

async function updateVideoSource(url, loop, playAudio) {
  let targetUrl = url;
  if (!url) {
    currentVideoUrl = null;
    if (activeVideo) {
      activeVideo.pause();
      activeVideo.removeAttribute('src');
      activeVideo.load();
    }
    if (videoTexture) {
      videoTexture.dispose();
      videoTexture = null;
    }
    return;
  }

  const ytId = getYouTubeId(url);
  if (ytId) {
    try {
      targetUrl = await resolveYouTubeStreamUrl(ytId);
    } catch (err) {
      console.error('Failed to resolve YouTube video:', err);
      return; // Do not update source if it failed
    }
  }

  if (targetUrl === currentVideoUrl && activeVideo) {
    activeVideo.loop = loop;
    activeVideo.muted = !playAudio;
    activeVideo.dataset.shouldPlayAudio = !!playAudio;
    return;
  }

  currentVideoUrl = targetUrl;

  let isNewVideo = false;
  if (!activeVideo) {
    activeVideo = document.createElement('video');
    activeVideo.preload = 'auto';
    activeVideo.playsInline = true;
    activeVideo.webkitPlaysInline = true;
    activeVideo.crossOrigin = 'anonymous'; // Set crossOrigin to anonymous for WebGL texture upload compatibility
    isNewVideo = true;
  }

  activeVideo.loop = loop;
  activeVideo.muted = !playAudio;
  activeVideo.dataset.shouldPlayAudio = !!playAudio;

  activeVideo.crossOrigin = 'anonymous';
  activeVideo.src = ensureProxiedUrl(targetUrl);
  activeVideo.load();

  if (isNewVideo) {
    try {
      setupAudioFilters(activeVideo);
    } catch (err) {
      console.error('Audio filter setup failed:', err);
    }
  }

  if (!videoTexture) {
    videoTexture = new THREE.VideoTexture(activeVideo);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.generateMipmaps = false;
  }

  activeVideo.play()
    .then(() => {
      console.log('Preset video play started successfully.');
    })
    .catch((err) => {
      console.log('Preset video autoplay blocked. Retrying with mute...', err);
      activeVideo.muted = true;
      activeVideo.play()
        .then(() => {
          console.log('Preset muted fallback autoplay succeeded!');
          const unmuteOnInteraction = () => {
            activeVideo.muted = !playAudio;
            if (audioCtx && audioCtx.state === 'suspended') {
              audioCtx.resume();
            }
            console.log('User interacted. Restored preset audio state.');
            document.removeEventListener('click', unmuteOnInteraction);
            document.removeEventListener('keydown', unmuteOnInteraction);
            document.removeEventListener('touchstart', unmuteOnInteraction);
          };
          document.addEventListener('click', unmuteOnInteraction);
          document.addEventListener('keydown', unmuteOnInteraction);
          document.addEventListener('touchstart', unmuteOnInteraction);
        })
        .catch((muteErr) => {
          console.error('Preset even muted autoplay failed:', muteErr);
        });
    });
}

export function loadScreenAssets() {
  textureLoader = new THREE.TextureLoader();

  // All assets come from server via WebSocket — no local textures needed.
  // Create a 1x1 transparent fallback so uTextureChild is never a null sampler.
  const fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = 1; fallbackCanvas.height = 1;
  const fallbackTex = new THREE.CanvasTexture(fallbackCanvas);
  fallbackTex.colorSpace = THREE.SRGBColorSpace;

  defaultTexture = null;
  childTexture = fallbackTex;       // safe default — transparent 1x1
  originalChildTexture = fallbackTex;
  eyeSigilTexture = null;

  return new Promise((resolve) => {
    initialLoadResolver = resolve;
    const safetyTimeout = setTimeout(() => {
      if (initialLoadResolver) {
        initialLoadResolver();
        initialLoadResolver = null;
      }
    }, 1800);

    initWebSocket();
  });
}

function updateChildVisibility(elapsedTime) {
  const minute = Math.floor(elapsedTime / 60);
  const secondInMinute = elapsedTime % 60;

  if (minute !== currentMinute) {
    currentMinute = minute;
    appearances = [];

    // Avoid divisions by zero or negative timings
    const freq = Math.max(1, childFrequency);
    const minD = Math.max(0.1, childMinDuration);
    const maxD = Math.max(minD, childMaxDuration);

    // Split the 60 seconds of the minute into 'freq' equal segments to avoid overlapping
    const segmentWidth = 60.0 / freq;
    for (let i = 0; i < freq; i++) {
      const dur = minD + Math.random() * (maxD - minD);
      const segmentStart = i * segmentWidth;
      // Ensure the start allows the duration to fit inside the segment
      const maxStartOffset = Math.max(0, segmentWidth - dur);
      const start = segmentStart + Math.random() * maxStartOffset;
      appearances.push({ start, end: start + dur });
    }
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

  // Set uIsVideo uniform dynamically based on CONFIG.mode
  if (uniforms.uIsVideo) {
    uniforms.uIsVideo.value = (CONFIG.mode === 'video') ? 1.0 : 0.0;
  }

  // Set uPowerOff uniform dynamically based on whether custom_image has no texture (Power Off)
  if (uniforms.uPowerOff) {
    uniforms.uPowerOff.value = (CONFIG.mode === 'custom_image' && !wsTexture) ? 1.0 : 0.0;
  }

  // Set default scale uniforms (can be overridden by specific modes below)
  if (uniforms.uScaleX && uniforms.uScaleY) {
    uniforms.uScaleX.value = 1.0;
    uniforms.uScaleY.value = 1.0;
  }

  // Always link the text texture to its uniform slot
  uniforms.uTextureText.value = textTexture;

  // Always update color filter uniforms
  if (typeof uniforms.uFilterMode !== 'undefined') {
    uniforms.uFilterMode.value = wsFilterMode;
  }
  if (uniforms.uFilterColor) {
    uniforms.uFilterColor.value.set(wsFilterColor);
  }

  // 1. Handle WebSockets Connection Fallback & Grace Period (Bypassed to keep base visual premium and avoid loading screen)
  if (wsConnected) {
    connectionGraceTimer = 8.0;
  }

  // Helper local function to handle default text overlay rendering
  const handleOverlayText = () => {
    if (wsText) {
      updateTextTexture(wsText);
    } else if (postEasterEggTimer > 0.0) {
      postEasterEggTimer -= deltaTime;
      updateTextTexture(dec('283f4b3c3c'), 'top-left');
    } else {
      updateTextTexture('');
    }
  };

  // 2. Handle Easter Egg State Machine (Precedes static and custom image overrides)
  if (easterEggState === 'transition_in') {
    easterEggTimer += deltaTime;
    inTransition = true;
    
    drawNoiseOnCanvas();
    updateTextTexture('');
    uniforms.uTexture.value = noiseTexture;
    uniforms.uChildVisibility.value = 0.0;

    if (easterEggTimer >= EASTER_EGG_TRANSITION_DUR) {
      easterEggState = 'active';
      easterEggTimer = 0.0;
      inTransition = false;
      
      // Draw Eye Sigil once on entry to active state
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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
      canvasTexture.needsUpdate = true;
    }
    return;
  }
  
  if (easterEggState === 'active') {
    easterEggTimer += deltaTime;
    inTransition = false;

    // Text: use wsText (from admin) if set, else show 'CH MTCDX' top-left for first 2s
    if (wsText) {
      updateTextTexture(wsText, wsTextPosition);
    } else if (easterEggTimer <= 2.0) {
      // CH MTCDX always top-left, regardless of wsTextPosition
      updateTextTexture(dec('283f4b3a3f342f2f'), 'top-left');
    } else {
      updateTextTexture('');
    }

    if (uniforms.uScaleX) {
      uniforms.uScaleX.value = 1.936872;
    }
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
    uniforms.uTexture.value = noiseTexture;
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

  // 1.5. Handle WebSockets Overrides
  if (wsMode === 'static') {
    inTransition = false;
    drawNoiseOnCanvas();
    uniforms.uTexture.value = noiseTexture;
    uniforms.uChildVisibility.value = 0.0;
    
    if (wsText) {
      updateTextTexture(wsText);
    } else {
      updateTextTexture('');
    }
    return;
  }

  if (wsMode === 'custom_image' && wsTexture) {
    inTransition = false;
    uniforms.uTexture.value = wsTexture;
    uniforms.uChildVisibility.value = 0.0;

    if (wsText) {
      updateTextTexture(wsText);
    } else {
      updateTextTexture('');
    }
    return;
  }

  if (CONFIG.mode === 'static') {
    inTransition = false;
    drawNoiseOnCanvas();
    uniforms.uTexture.value = noiseTexture;
    if (wsText) {
      updateTextTexture(wsText);
    } else {
      updateTextTexture('');
    }
    uniforms.uChildVisibility.value = 0.0;
    return;
  }

  if (CONFIG.mode === 'custom_image') {
    inTransition = false;
    if (wsTexture) {
      uniforms.uTexture.value = wsTexture;
    } else {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      canvasTexture.needsUpdate = true;
      uniforms.uTexture.value = canvasTexture;
    }
    if (wsText) {
      updateTextTexture(wsText);
    } else {
      updateTextTexture('');
    }
    uniforms.uChildVisibility.value = 0.0;
    return;
  }

  if (CONFIG.mode === 'default') {
    inTransition = false;
    handleOverlayText();

    if (wsTexture || defaultTexture) {
      // Restore proper aspect ratio scaling for the padre portrait image
      if (uniforms.uScaleX) uniforms.uScaleX.value = 1.936872;
      uniforms.uTexture.value = wsTexture || defaultTexture;
      uniforms.uTextureChild.value = childTexture;
      uniforms.uChildVisibility.value = updateChildVisibility(elapsedTime);
    } else {
      // No assets from server yet — show 'SEÑAL PENDIENTE' static
      drawNoiseOnCanvas();
      uniforms.uTexture.value = noiseTexture;
      if (!wsText) updateTextTexture('SEÑAL PENDIENTE');
      uniforms.uChildVisibility.value = 0.0;
    }
    return;
  }

  if (CONFIG.mode === 'video') {
    inTransition = false;
    
    // Check if the video has loaded at least one frame.
    // If it has, even if it temporarily buffers (readyState < 2), we keep showing the last frame
    // from the videoTexture instead of flashing jarring black-and-white static noise!
    const hasActiveFrame = videoTexture && activeVideo && (activeVideo.readyState >= 2 || activeVideo.currentTime > 0);
    
    if (hasActiveFrame) {
      if (activeVideo.readyState >= 2) {
        videoTexture.needsUpdate = true;
      }
      uniforms.uTexture.value = videoTexture;
    } else {
      // Show thematic static noise while video is loading the very first frame
      drawNoiseOnCanvas();
      uniforms.uTexture.value = noiseTexture;
    }
    if (wsText) {
      updateTextTexture(wsText);
    } else {
      updateTextTexture('');
    }
    uniforms.uChildVisibility.value = 0.0;
    return;
  }

  if (CONFIG.mode === 'slideshow') {
    const images = CONFIG.slideshow.images;
    if (!images || images.length === 0) {
      // No slideshow images configured — show static
      inTransition = false;
      drawNoiseOnCanvas();
      uniforms.uTexture.value = noiseTexture;
      if (!wsText) updateTextTexture('SEÑAL PENDIENTE');
      uniforms.uChildVisibility.value = 0.0;
      return;
    }

    if (images.length <= 1) {
      inTransition = false;
      const singleSlideUrl = images[0];
      const slideTex = loadedSlideTextures[singleSlideUrl] || defaultTexture;
      
      handleOverlayText();

      uniforms.uTexture.value = slideTex;
      uniforms.uChildVisibility.value = 0.0;
      return;
    }

    slideTimer += deltaTime;
    if (inTransition) {
      drawNoiseOnCanvas();
      updateTextTexture('');
      uniforms.uTexture.value = noiseTexture;
      uniforms.uChildVisibility.value = 0.0;

      if (slideTimer >= CONFIG.slideshow.transitionDuration) {
        currentSlideIndex = (currentSlideIndex + 1) % images.length;
        slideTimer = 0.0;
        inTransition = false;
      }
    } else {
      const currentSlideUrl = images[currentSlideIndex];
      const slideTex = loadedSlideTextures[currentSlideUrl] || defaultTexture;
      
      handleOverlayText();

      uniforms.uTexture.value = slideTex;

      if (currentSlideUrl === dec('4407340345130a03')) {
        if (uniforms.uScaleX) {
          uniforms.uScaleX.value = 1.936872;
        }
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

  // Real-time Ambilight color extraction from the active screen texture
  const sourceTex = uniforms.uTexture.value;
  if (sourceTex && sourceTex.image) {
    const source = sourceTex.image;
    
    // Safety check: only draw HTML5 Video if it is playing and ready
    let canDraw = true;
    if (source instanceof HTMLVideoElement) {
      if (source.readyState < 2 || source.paused) {
        canDraw = false;
      }
    }
    
    if (canDraw) {
      try {
        analyserCtx.drawImage(source, 0, 0, 1, 1);
        const pixel = analyserCtx.getImageData(0, 0, 1, 1).data;
        let r = pixel[0] / 255;
        let g = pixel[1] / 255;
        let b = pixel[2] / 255;
        
        // Apply post-shader analytical color filters on CPU so reflection color matches screen exactly
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        if (wsFilterMode === 1) { // Green
          r = luma * 0.22 * 1.35; g = luma * 1.0 * 1.35; b = luma * 0.08 * 1.35;
        } else if (wsFilterMode === 2) { // Red
          r = luma * 1.0 * 1.35; g = luma * 0.15 * 1.35; b = luma * 0.15 * 1.35;
        } else if (wsFilterMode === 3) { // Yellow
          r = luma * 1.0 * 1.35; g = luma * 0.82 * 1.35; b = 0.0;
        } else if (wsFilterMode === 4) { // Rainbow
          const hue = (elapsedTime * 0.15) % 1.0;
          const rainbowCol = new THREE.Color().setHSL(hue, 1.0, 0.5);
          r = luma * rainbowCol.r * 1.5; g = luma * rainbowCol.g * 1.5; b = luma * rainbowCol.b * 1.5;
        } else if (wsFilterMode === 5) { // Custom Tint
          const cColor = new THREE.Color(wsFilterColor);
          r = luma * cColor.r * 1.35; g = luma * cColor.g * 1.35; b = luma * cColor.b * 1.35;
        } else {
          // Standard CRT phosphor cold-blue tinting (color weighting toward blue)
          r = r * 0.68; g = g * 0.73; b = b * 0.90;
        }
        
        // Damp and scale colors so it doesn't saturate horribly in the room, keeping it opaque/ambient
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        let scale = 1.0;
        if (brightness > 0.82) {
          scale = 0.82 / brightness; // Cap maximum screen brightness to prevent blinding/saturating
        }
        
        crtAverageColor.setRGB(r * scale, g * scale, b * scale);
      } catch (err) {
        // CORS or drawing error fallback: soft blue CRT glow
        crtAverageColor.setHex(0xaad8ff);
      }
    } else {
      crtAverageColor.setHex(0xaad8ff);
    }
  } else {
    crtAverageColor.setHex(0xaad8ff);
  }
}

export function destroyScreenManager() {
  if (videoOverrideTimeout) {
    clearTimeout(videoOverrideTimeout);
    videoOverrideTimeout = null;
  }
  isImmediateVideoActive = false;
  if (preloadingVideo) {
    preloadingVideo.pause();
    preloadingVideo.src = "";
    preloadingVideo.load();
    preloadingVideo = null;
  }
  if (activeVideo) {
    activeVideo.pause();
    activeVideo.src = "";
    activeVideo.load();
  }
  if (ws) {
    ws.close();
  }
  if (wsTexture) {
    wsTexture.dispose();
  }
  canvasTexture.dispose();
  noiseTexture.dispose();
  textTexture.dispose();
  if (videoTexture) videoTexture.dispose();
}

// Resume video play when user interacts to bypass browser autoplay policies
const resumeVideoOnGesture = () => {
  if (CONFIG.mode === 'video' && activeVideo && activeVideo.paused) {
    activeVideo.play().catch(() => {});
  }
};
window.addEventListener('click', resumeVideoOnGesture);
window.addEventListener('pointerdown', resumeVideoOnGesture);
window.addEventListener('touchstart', resumeVideoOnGesture);

/*! REJECTED FALSE ICONS (5/7) */
