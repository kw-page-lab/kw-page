// WebSocket Interceptor — KimeraWare
// Handles: audioOnly mode, ACT pause/resume, uTexture override for special sequences
(function() {
    window.wsConnected = false;
    window.wsProgress = 0;

    // ── audioOnly mode state ─────────────────────────────────────────────────
    // When audioOnly is active, the TV screen shows whatever the current
    // preset renders (images, default mode, etc.) while the video plays silently.
    // overrideTvTexture is ONLY set by ACT sequences that need a specific visual.
    window.overrideTvTexture = null;
    window.audioOnlyActive = false;
    window.audioOnlyDuration = 60;
    window.audioOnlyStartElapsed = 0;
    window.audioOnlyLocalStartTime = 0;
    window.audioOnlyOverrideUntil = null;
    window.tvOverrideVolume = null;
    window.tvVideoElement = null;

    // ── ACT pause/resume state ──────────────────────────────────────────────
    // Generic system: any ACT (1, 2, N) can pause the active video and resume it.
    window.actPausedVideoInfo = null; // { url, currentTime, isLive, startTime, duration }
    window.actCurrentlyActive = false; // true if any ACT is running

    // Static noise texture (reused across frames)
    let staticCanvas = null, staticCtx = null, staticTexture = null;
    function updateStaticNoise() {
        if (!staticCanvas) {
            staticCanvas = document.createElement('canvas');
            staticCanvas.width = 256; staticCanvas.height = 256;
            staticCtx = staticCanvas.getContext('2d');
            staticTexture = new THREE.CanvasTexture(staticCanvas);
            staticTexture.minFilter = THREE.NearestFilter;
            staticTexture.magFilter = THREE.NearestFilter;
        }
        const imgData = staticCtx.createImageData(256, 256);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
            const v = Math.floor(Math.random() * 255);
            d[i] = v; d[i+1] = v; d[i+2] = v; d[i+3] = 255;
        }
        staticCtx.putImageData(imgData, 0, 0);
        staticTexture.needsUpdate = true;
    }

    let blackTexture = null;
    function getBlackTexture() {
        if (!blackTexture) {
            const c = document.createElement('canvas');
            c.width = 1; c.height = 1;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, 1, 1);
            blackTexture = new THREE.CanvasTexture(c);
        }
        return blackTexture;
    }

    // ── Intercept video element creation ───────────────────────────────────
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName, options) {
        const el = originalCreateElement.call(document, tagName, options);
        if (tagName && tagName.toLowerCase() === 'video') {
            window.tvVideoElement = el;
            console.log('[WS Interceptor] Captured TV video element');
        }
        return el;
    };

    // ── Wrap KimerawareTV.loadTV ────────────────────────────────────────────
    let _kimerawareTV = undefined;
    Object.defineProperty(window, 'KimerawareTV', {
        get() { return _kimerawareTV; },
        set(val) {
            _kimerawareTV = val;
            if (val && val.loadTV && !val.loadTV.isWrapped) {
                console.log('[WS Interceptor] Wrapping KimerawareTV.loadTV');
                const originalLoadTV = val.loadTV;
                val.loadTV = function() {
                    return originalLoadTV.apply(this, arguments).then(tv => {
                        const material = tv.crtScreen.material;
                        if (material && material.uniforms) {

                            // ── uTexture override ──────────────────────────
                            // ONLY override when:
                            // 1. audioOnly is active AND overrideTvTexture is set (ACT2 uses it)
                            // 2. overrideTvTexture is explicitly set (static noise, black handoff)
                            // Normal videos (audioOnly=false): overrideTvTexture is null → pass-through
                            const uTextureUniform = material.uniforms.uTexture;
                            if (uTextureUniform) {
                                let originalTextureVal = uTextureUniform.value;
                                Object.defineProperty(uTextureUniform, 'value', {
                                    get() {
                                        // Only hijack if there is an explicit override texture set
                                        if (window.overrideTvTexture) {
                                            return window.overrideTvTexture;
                                        }
                                        return originalTextureVal;
                                    },
                                    set(val) { originalTextureVal = val; },
                                    configurable: true
                                });
                            }

                            // ── uIsVideo override ──────────────────────────
                            // When audioOnly is active, tell the shader there is no video
                            // so it won't try to render the video texture (which is muted/invisible)
                            const uIsVideoUniform = material.uniforms.uIsVideo;
                            if (uIsVideoUniform) {
                                let origIsVideoVal = uIsVideoUniform.value;
                                Object.defineProperty(uIsVideoUniform, 'value', {
                                    get() {
                                        if (window.audioOnlyActive) return 0;
                                        return origIsVideoVal;
                                    },
                                    set(val) { origIsVideoVal = val; },
                                    configurable: true
                                });
                            }
                        }

                        // ── ACT2-specific update hook ──────────────────────
                        // This manages the visual timeline for ACT2 audio-only sequence.
                        // ACT2 uses overrideTvTexture to control what the screen shows.
                        // Other ACTs (or plain audioOnly) do NOT set overrideTvTexture,
                        // so the normal preset visuals show through.
                        const originalUpdate = tv.update;
                        tv.update = function(time, delta) {
                            if (window.audioOnlyActive && window.act2VisualSequenceActive) {
                                // ACT2 manages its own visual sequence via overrideTvTexture
                                const elapsed = window.audioOnlyStartElapsed +
                                    (Date.now() - window.audioOnlyLocalStartTime) / 1000;
                                const duration = window.audioOnlyDuration || 60;

                                if (elapsed >= duration) {
                                    // Sequence done — hold black until server sends black_screen preset
                                    window.overrideTvTexture = getBlackTexture();
                                    window.audioOnlyActive = false;
                                    window.act2VisualSequenceActive = false;
                                    console.log('[WS Interceptor] ACT2 audio-only sequence ended. Holding black for preset handoff.');
                                } else if (elapsed < 11.0) {
                                    // 0-11s: silence, black screen (TV powered off + grass grow)
                                    if (window.tvVideoElement) window.tvVideoElement.volume = 0.0;
                                    window.overrideTvTexture = getBlackTexture();
                                } else if (elapsed < 50.0) {
                                    // 11-50s: show act2 image, fade audio in (11-13s)
                                    const targetVol = window.tvOverrideVolume != null
                                        ? window.tvOverrideVolume / 100 : 0.9;
                                    if (window.tvVideoElement) {
                                        if (elapsed < 13.0) {
                                            window.tvVideoElement.volume = ((elapsed - 11.0) / 2.0) * targetVol;
                                        } else {
                                            window.tvVideoElement.volume = targetVol;
                                        }
                                    }
                                    window.overrideTvTexture = window.act2ImageTexture || getBlackTexture();
                                } else if (elapsed < 55.0) {
                                    // 50-55s: fade audio out
                                    const targetVol = window.tvOverrideVolume != null
                                        ? window.tvOverrideVolume / 100 : 0.9;
                                    if (window.tvVideoElement) {
                                        window.tvVideoElement.volume = Math.max(0, ((55.0 - elapsed) / 5.0) * targetVol);
                                    }
                                    window.overrideTvTexture = window.act2ImageTexture || getBlackTexture();
                                } else {
                                    // 55-60s: silence, static noise
                                    if (window.tvVideoElement) window.tvVideoElement.volume = 0.0;
                                    updateStaticNoise();
                                    window.overrideTvTexture = staticTexture;
                                }
                            }
                            originalUpdate.call(this, time, delta);
                        };
                        return tv;
                    });
                };
                val.loadTV.isWrapped = true;
            }
        },
        configurable: true
    });

    // ── WebSocket interception ───────────────────────────────────────────────
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        let modifiedUrl = url;
        try {
            let id = localStorage.getItem('kimeraware_client_id');
            if (!id) {
                id = 'client_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
                localStorage.setItem('kimeraware_client_id', id);
            }
            let tempUrl = url;
            let isWs = false, isWss = false;
            if (url.startsWith('ws://')) { tempUrl = url.replace('ws://', 'http://'); isWs = true; }
            else if (url.startsWith('wss://')) { tempUrl = url.replace('wss://', 'https://'); isWss = true; }
            const urlObj = new URL(tempUrl, window.location.href);
            urlObj.searchParams.set('clientId', id);
            if (window.location.pathname.includes('/v2')) {
                urlObj.searchParams.set('testing', 'true');
                console.log('[WS Interceptor] v2 staging client — connecting with testing=true');
            }
            modifiedUrl = urlObj.toString();
            if (isWs) modifiedUrl = modifiedUrl.replace('http://', 'ws://');
            else if (isWss) modifiedUrl = modifiedUrl.replace('https://', 'wss://');
        } catch(e) {
            console.error('[WS Interceptor] Failed to append clientId:', e);
        }

        console.log('[WS Interceptor] Connecting to:', modifiedUrl);
        const ws = new OriginalWebSocket(modifiedUrl, protocols);

        ws.addEventListener('open', () => {
            console.log('[WS Interceptor] WebSocket connected!');
            window.wsConnected = true;
            window.wsProgress = 100;
            if (typeof window.updateOverallProgress === 'function') window.updateOverallProgress();
        });

        // ── Decryption ──────────────────────────────────────────────────────
        let Ae = null;
        async function kt() {
            if (Ae) return Ae;
            const e = "75,87,95,65,82,71",
                  n = new Uint8Array(e.split(",").map(Number)),
                  t = new TextEncoder().encode("kimeraware-ws-2025"),
                  i = await crypto.subtle.importKey("raw", n, {name:"HMAC",hash:"SHA-256"}, false, ["sign"]),
                  d = await crypto.subtle.sign("HMAC", i, t);
            return Ae = await crypto.subtle.importKey("raw", d, {name:"AES-GCM"}, false, ["decrypt"]), Ae;
        }
        async function decryptMessage(e) {
            try {
                const n = Uint8Array.from(atob(e), r => r.charCodeAt(0)),
                      t = n.slice(0,12), i = n.slice(12,28), d = n.slice(28),
                      a = new Uint8Array(d.length+16);
                a.set(d); a.set(i, d.length);
                const u = await kt(), s = await crypto.subtle.decrypt({name:"AES-GCM",iv:t}, u, a);
                return JSON.parse(new TextDecoder().decode(s));
            } catch(err) {
                try { return JSON.parse(e); } catch { throw err; }
            }
        }

        // ── Image texture loader ────────────────────────────────────────────
        let textureLoader = null;
        function loadOverrideTexture(imgUrl, callback) {
            if (!imgUrl) { if (callback) callback(null); return; }
            let resolvedUrl = imgUrl;
            if (imgUrl.startsWith('/assets/')) {
                const host = window.location.hostname;
                if (host !== 'localhost' && host !== '127.0.0.1' && !host.includes('macrostasis.dev')) {
                    resolvedUrl = 'https://kimeraware.macrostasis.dev' + imgUrl;
                }
            }
            if (!textureLoader) textureLoader = new THREE.TextureLoader();
            const isExternal = resolvedUrl.startsWith('http') && !resolvedUrl.includes(window.location.hostname);
            textureLoader.setCrossOrigin(isExternal ? 'anonymous' : undefined);
            textureLoader.load(resolvedUrl, texture => {
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.minFilter = THREE.LinearFilter;
                texture.generateMipmaps = false;
                texture.needsUpdate = true;
                console.log('[WS Interceptor] Loaded texture:', resolvedUrl);
                if (callback) callback(texture);
            }, undefined, err => {
                console.error('[WS Interceptor] Failed to load texture:', err);
                if (callback) callback(null);
            });
        }

        // ── audioOnly handler ───────────────────────────────────────────────
        // Flexible: audioOnly just means "play audio but don't show video stream".
        // The screen shows whatever the current preset renders unless overrideTvTexture is set.
        // ACT2 sets act2VisualSequenceActive=true to control the screen via overrideTvTexture.
        function handleAudioOnlyMessage(decrypted) {
            const isAudioOnly = decrypted.audioOnly === true || decrypted.audioOnly === 'true';

            if (isAudioOnly) {
                // Force the TV bundle to use 'video' mode so the audio stream plays
                decrypted.mode = 'video';

                window.tvOverrideVolume = decrypted.videoVolume !== undefined ? decrypted.videoVolume : null;
                window.audioOnlyOverrideUntil = Date.now() + (decrypted.duration || 60) * 1000;
                window.audioOnlyLocalStartTime = Date.now();
                window.audioOnlyStartElapsed = (decrypted.originalDuration || 60) - (decrypted.duration || 60);
                window.audioOnlyDuration = decrypted.duration || 60;
                window.audioOnlyActive = true;

                // Save the image URL from this audioOnly trigger for use by ACT sequences
                const imgUrl = decrypted.imageUrl || decrypted.imageData || decrypted.mainImageData;
                if (imgUrl) {
                    window.lastAct2ImageUrl = imgUrl;
                    // Preload the texture now so it's ready when the visual sequence starts
                    loadOverrideTexture(imgUrl, texture => {
                        window.act2ImageTexture = texture;
                        console.log('[WS Interceptor] audioOnly: preloaded image texture:', imgUrl);
                    });
                } else {
                    window.lastAct2ImageUrl = null;
                    window.act2ImageTexture = null;
                }

                // Clear visual override — screen shows active preset normally
                window.overrideTvTexture = null;
                window.act2VisualSequenceActive = false;

                console.log('[WS Interceptor] audioOnly activated. Duration:', decrypted.duration, 's. Image:', imgUrl || 'none');
                return true; // modified — send to TV bundle
            } else {
                // Not audioOnly: clear all audioOnly state
                window.audioOnlyActive = false;
                window.audioOnlyOverrideUntil = null;
                window.overrideTvTexture = null;
                window.act2ImageTexture = null;
                window.act2VisualSequenceActive = false;
                return false;
            }
        }

        // ── ACT2 visual sequence activator ──────────────────────────────────
        // Called by the ACT2 runner (via WS message with act2VisualMode=true or presetId=act2)
        // to activate the timed visual sequence on top of audioOnly.
        function activateAct2VisualSequence(imageUrl) {
            if (!window.audioOnlyActive) {
                console.warn('[WS Interceptor] activateAct2VisualSequence called but audioOnly is not active');
                return;
            }
            window.act2VisualSequenceActive = true;
            window.act2ImageTexture = null;
            // Start with black to prevent any frame leak
            window.overrideTvTexture = getBlackTexture();

            if (imageUrl) {
                loadOverrideTexture(imageUrl, texture => {
                    window.act2ImageTexture = texture;
                    console.log('[WS Interceptor] ACT2 image texture loaded:', imageUrl);
                });
            }
            console.log('[WS Interceptor] ACT2 visual sequence activated. Image URL:', imageUrl);
        }
        // Expose globally so event_runner_act2 can signal it via a custom WS message
        window._activateAct2Visual = activateAct2VisualSequence;

        // ── ACT pause/resume system ─────────────────────────────────────────
        // Generic: works for any ACT (1, 2, 3...)
        // When an ACT activates, we snapshot the current video state.
        // When the ACT deactivates, we resume the video from the saved position.
        function handleActActivated(actId) {
            if (window.actCurrentlyActive) return; // already paused
            window.actCurrentlyActive = true;
            window.actActiveId = actId;

            // Capture the current video state from the TV bundle's video element
            const v = window.tvVideoElement;
            if (v && v.src && !v.paused) {
                const isLive = v.duration === Infinity || !isFinite(v.duration);
                window.actPausedVideoInfo = {
                    url: v.src,
                    currentTime: v.currentTime,
                    isLive: isLive,
                    capturedAt: Date.now(),
                    volume: v.volume,
                    loop: v.loop,
                    muted: v.muted
                };
                console.log(`[WS Interceptor] ACT${actId} activated — pausing video at ${v.currentTime.toFixed(2)}s (isLive: ${isLive})`);
            } else {
                window.actPausedVideoInfo = null;
                console.log(`[WS Interceptor] ACT${actId} activated — no active video to pause`);
            }
        }

        function handleActDeactivated(actId) {
            if (!window.actCurrentlyActive || window.actActiveId !== actId) return;
            window.actCurrentlyActive = false;
            window.actActiveId = null;

            const info = window.actPausedVideoInfo;
            window.actPausedVideoInfo = null;

            if (!info || !info.url) {
                console.log(`[WS Interceptor] ACT${actId} ended — no video to resume`);
                return;
            }

            // Resume the video through the TV bundle's video element
            const v = window.tvVideoElement;
            if (!v) {
                console.warn('[WS Interceptor] Cannot resume video — no video element found');
                return;
            }

            if (info.isLive) {
                // For live streams: just ensure playback is running (seek to live edge)
                console.log(`[WS Interceptor] ACT${actId} ended — resuming live stream`);
                if (v.paused) {
                    v.play().catch(e => console.warn('[WS Interceptor] Live resume play failed:', e));
                }
                // HLS.js will automatically snap back to live edge
            } else {
                // For VODs: calculate the correct position accounting for elapsed time
                const elapsedSinceCapture = (Date.now() - info.capturedAt) / 1000;
                const resumeTime = Math.min(
                    (v.duration && isFinite(v.duration)) ? v.duration - 0.5 : Infinity,
                    info.currentTime + elapsedSinceCapture
                );
                console.log(`[WS Interceptor] ACT${actId} ended — resuming VOD at ${resumeTime.toFixed(2)}s (original: ${info.currentTime.toFixed(2)}s + ${elapsedSinceCapture.toFixed(2)}s elapsed)`);
                v.volume = info.volume;
                v.muted = info.muted;
                v.currentTime = resumeTime;
                if (v.paused) {
                    v.play().catch(e => console.warn('[WS Interceptor] VOD resume play failed:', e));
                }
            }
        }

        // ── Reset handler ───────────────────────────────────────────────────
        function handleResetMessage() {
            window.overrideTvTexture = null;
            window.audioOnlyOverrideUntil = null;
            window.act2ImageTexture = null;
            window.audioOnlyActive = false;
            window.act2VisualSequenceActive = false;
            window.actCurrentlyActive = false;
            window.actPausedVideoInfo = null;
        }

        // ── Proxy: intercept addEventListener and onmessage ─────────────────
        const proxy = new Proxy(ws, {
            get(target, prop, receiver) {
                if (prop === 'addEventListener') {
                    return function(type, listener, options) {
                        if (type === 'message') {
                            const wrappedListener = async function(event) {
                                try {
                                    const decrypted = await decryptMessage(event.data);
                                    let modified = false;

                                    if (decrypted && (decrypted.type === 'trigger_video' || decrypted.type === 'apply_preset')) {
                                        if (decrypted.type === 'apply_preset') window.lastAppliedPreset = decrypted;
                                        modified = handleAudioOnlyMessage(decrypted);
                                    } else if (decrypted && decrypted.type === 'reset') {
                                        handleResetMessage();
                                    }

                                    // Block apply_preset from reaching TV bundle while audioOnly is active.
                                    // The TV bundle would call Te() which resets the video player and cuts audio.
                                    // The raw WS listener below still processes ACT state changes independently.
                                    if (decrypted && decrypted.type === 'apply_preset' && window.audioOnlyActive) {
                                        console.log('[WS Interceptor] Blocking apply_preset from TV bundle (audioOnly active):', decrypted.presetId);
                                        return;
                                    }

                                    if (modified) {
                                        const newEvent = new MessageEvent('message', {
                                            data: JSON.stringify(decrypted),
                                            origin: event.origin,
                                            lastEventId: event.lastEventId,
                                            source: event.source,
                                            ports: event.ports
                                        });
                                        return listener.call(this, newEvent);
                                    }
                                } catch (e) {
                                    console.error('[WS Interceptor] Error in addEventListener wrapper:', e);
                                }
                                return listener.call(this, event);
                            };
                            if (!target._wrappedListeners) target._wrappedListeners = new Map();
                            target._wrappedListeners.set(listener, wrappedListener);
                            return target.addEventListener(type, wrappedListener, options);
                        }
                        return target.addEventListener(type, listener, options);
                    };
                }

                if (prop === 'removeEventListener') {
                    return function(type, listener, options) {
                        if (type === 'message' && target._wrappedListeners && target._wrappedListeners.has(listener)) {
                            const wrapped = target._wrappedListeners.get(listener);
                            target._wrappedListeners.delete(listener);
                            return target.removeEventListener(type, wrapped, options);
                        }
                        return target.removeEventListener(type, listener, options);
                    };
                }

                if (prop === 'onmessage') return target.onmessage;

                const value = target[prop];
                return typeof value === 'function' ? value.bind(target) : value;
            },
            set(target, prop, value, receiver) {
                if (prop === 'onmessage') {
                    if (value) {
                        const wrappedListener = async function(event) {
                            try {
                                const decrypted = await decryptMessage(event.data);
                                let modified = false;

                                if (decrypted && (decrypted.type === 'trigger_video' || decrypted.type === 'apply_preset')) {
                                    if (decrypted.type === 'apply_preset') window.lastAppliedPreset = decrypted;
                                    modified = handleAudioOnlyMessage(decrypted);
                                } else if (decrypted && decrypted.type === 'reset') {
                                    handleResetMessage();
                                }

                                if (decrypted && decrypted.type === 'apply_preset' && window.audioOnlyActive) {
                                    console.log('[WS Interceptor] Blocking onmessage apply_preset from TV bundle (audioOnly active):', decrypted.presetId);
                                    return;
                                }

                                if (modified) {
                                    const newEvent = new MessageEvent('message', {
                                        data: JSON.stringify(decrypted),
                                        origin: event.origin,
                                        lastEventId: event.lastEventId,
                                        source: event.source,
                                        ports: event.ports
                                    });
                                    return value.call(this, newEvent);
                                }
                            } catch (e) {
                                console.error('[WS Interceptor] Error in onmessage wrapper:', e);
                            }
                            return value.call(this, event);
                        };
                        target[prop] = wrappedListener;
                        return true;
                    }
                }
                target[prop] = value;
                return true;
            }
        });

        // ── Raw WS message listener for ACT state detection ─────────────────
        // This runs before the proxy and detects ACT activation/deactivation
        // for any act (act1, act2, actN), triggering pause/resume of active video.
        ws.addEventListener('message', async (event) => {
            try {
                let data;
                const rawData = event.data;
                if (typeof rawData === 'string' && rawData.startsWith('{')) {
                    data = JSON.parse(rawData);
                } else if (typeof rawData === 'string') {
                    data = await decryptMessage(rawData);
                }

                if (data) {
                    if (data.type === 'apply_preset' || data.type === 'trigger_video') {

                        // ── Generic ACT detection ─────────────────────────
                        // Any preset with presetId matching /^act\d+$/i (act1, act2, act3...)
                        // or explicit actN=true flag triggers the pause/resume system.
                        const presetId = data.presetId || '';
                        const actMatch = presetId.match(/^act(\d+)$/i);
                        const actNum = actMatch ? parseInt(actMatch[1]) : null;

                        if (actNum !== null) {
                            // This is an ACT preset activation
                            handleActActivated(actNum);
                        } else if (data.type === 'apply_preset' && presetId && !presetId.startsWith('act')) {
                            // Switching away from ACT preset
                            if (window.actCurrentlyActive) {
                                handleActDeactivated(window.actActiveId);
                            }
                        }

                        // ── ACT1 specific ─────────────────────────────────
                        const isAct1 = presetId === 'act1' || data.act1 === true;
                        if (isAct1) {
                            if (typeof window.setAct1 === 'function') window.setAct1(true);
                            if (typeof window.setAct2 === 'function') window.setAct2(false);
                        } else if (data.type === 'apply_preset' && presetId !== 'act1') {
                            if (typeof window.setAct1 === 'function') window.setAct1(false);
                        }

                        // ── ACT2 specific ─────────────────────────────────
                        const isAct2 = presetId === 'act2' || data.act2 === true;
                        if (isAct2) {
                            if (typeof window.setAct2 === 'function') {
                                window.setAct2(true, data.elapsedSeconds || 0);
                            }
                            if (typeof window.setAct1 === 'function') window.setAct1(false);

                            // Activate ACT2 visual sequence on top of audioOnly
                            // The imageUrl is passed via the audioOnly trigger_video's imageUrl
                            // We delay slightly to ensure audioOnly state is set first
                            if (window.audioOnlyActive) {
                                const imgUrl = data.mainImageData || window.lastAct2ImageUrl;
                                activateAct2VisualSequence(imgUrl);
                            }
                        } else if (data.type === 'apply_preset' && presetId !== 'act2') {
                            if (typeof window.setAct2 === 'function') window.setAct2(false);
                        }

                    } else if (data.type === 'reset') {
                        if (typeof window.setAct1 === 'function') window.setAct1(false);
                        if (typeof window.setAct2 === 'function') window.setAct2(false);
                        if (window.actCurrentlyActive) {
                            handleActDeactivated(window.actActiveId);
                        }
                    }
                }
            } catch(e) {
                // Ignore decode errors on this listener
            }
        });

        return proxy;
    };

    // Copy static WebSocket properties
    Object.getOwnPropertyNames(OriginalWebSocket).forEach(prop => {
        if (Object.prototype.hasOwnProperty.call(OriginalWebSocket, prop)) {
            try { window.WebSocket[prop] = OriginalWebSocket[prop]; } catch(e) {}
        }
    });
    window.WebSocket.prototype = OriginalWebSocket.prototype;

    // Safety timeout: mark WS as loaded if connection takes too long
    setTimeout(() => {
        if (!window.wsConnected) {
            console.warn('[WS Interceptor] WebSocket timed out — marking as loaded');
            window.wsProgress = 100;
            if (typeof window.updateOverallProgress === 'function') window.updateOverallProgress();
        }
    }, 5000);
})();
