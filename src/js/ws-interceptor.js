// WebSocket Interceptor — KimeraWare
// Handles: audioOnly mode, ACT visual sequences, uTexture/uIsVideo override
(function() {
    window.wsConnected = false;
    window.wsProgress  = 0;

    // ── Core state ────────────────────────────────────────────────────────────
    window.overrideTvTexture       = null;   // THREE.Texture forced on the CRT screen
    window.audioOnlyActive         = false;  // audioOnly override is running
    window.audioOnlyEndPending     = false;  // sequence ended, waiting for TV bundle to leave video mode
    window.audioOnlyDuration       = 60;
    window.audioOnlyStartElapsed   = 0;
    window.audioOnlyLocalStartTime = 0;
    window.audioOnlyOverrideUntil  = null;
    window.tvOverrideVolume        = null;
    window.tvVideoElement          = null;

    // ── ACT2 visual sequence state ────────────────────────────────────────────
    window.act2VisualSequenceActive = false; // ACT2 timed texture timeline is running
    window.act2ImageTexture         = null;  // THREE.Texture of the ACT2 image
    window.lastAct2ImageUrl         = null;

    // ── Generic ACT pause/resume state ───────────────────────────────────────
    window.actCurrentlyActive  = false;
    window.actActiveId         = null;
    window.actPausedVideoInfo  = null;

    // ── Static noise texture ─────────────────────────────────────────────────
    let staticCanvas = null, staticCtx = null, staticTexture = null;
    function updateStaticNoise() {
        if (!staticCanvas) {
            staticCanvas = document.createElement('canvas');
            staticCanvas.width = 256; staticCanvas.height = 256;
            staticCtx    = staticCanvas.getContext('2d');
            staticTexture = new THREE.CanvasTexture(staticCanvas);
            staticTexture.minFilter = THREE.NearestFilter;
            staticTexture.magFilter = THREE.NearestFilter;
        }
        const img = staticCtx.createImageData(256, 256);
        for (let i = 0; i < img.data.length; i += 4) {
            const v = Math.floor(Math.random() * 255);
            img.data[i] = img.data[i+1] = img.data[i+2] = v;
            img.data[i+3] = 255;
        }
        staticCtx.putImageData(img, 0, 0);
        staticTexture.needsUpdate = true;
    }

    let blackTexture = null;
    function getBlackTexture() {
        if (!blackTexture) {
            const c = document.createElement('canvas');
            c.width = 1; c.height = 1;
            c.getContext('2d').fillRect(0, 0, 1, 1);
            blackTexture = new THREE.CanvasTexture(c);
        }
        return blackTexture;
    }

    // ── Intercept video element creation ─────────────────────────────────────
    const _origCreateElement = document.createElement;
    document.createElement = function(tag, opts) {
        const el = _origCreateElement.call(document, tag, opts);
        if (tag && tag.toLowerCase() === 'video') {
            window.tvVideoElement = el;
        }
        return el;
    };

    // ── KimerawareTV.loadTV wrapper ───────────────────────────────────────────
    let _kimerawareTV;
    Object.defineProperty(window, 'KimerawareTV', {
        get() { return _kimerawareTV; },
        set(val) {
            _kimerawareTV = val;
            if (val && val.loadTV && !val.loadTV.isWrapped) {
                console.log('[WS Interceptor] Wrapping KimerawareTV.loadTV');
                const _orig = val.loadTV;
                val.loadTV = function() {
                    return _orig.apply(this, arguments).then(tv => {
                        const mat = tv.crtScreen.material;
                        if (mat && mat.uniforms) {

                            // ── uTexture hijack ───────────────────────────────
                            // Priority:
                            //   1. audioOnly active OR ending  → never show video texture
                            //      → return overrideTvTexture (ACT2 image/static/black) or black
                            //   2. overrideTvTexture set (black handoff) → return it
                            //   3. normal → pass through to TV bundle
                            const uTex = mat.uniforms.uTexture;
                            if (uTex) {
                                let _origTex = uTex.value;
                                Object.defineProperty(uTex, 'value', {
                                    get() {
                                        if (window.audioOnlyActive || window.audioOnlyEndPending) {
                                            return window.overrideTvTexture || getBlackTexture();
                                        }
                                        if (window.overrideTvTexture) {
                                            return window.overrideTvTexture;
                                        }
                                        return _origTex;
                                    },
                                    set(v) { _origTex = v; },
                                    configurable: true
                                });
                            }

                            // ── uIsVideo hijack ───────────────────────────────
                            // When audioOnly active/ending: force 0 so shader skips video logic.
                            // When TV bundle sets uIsVideo=0 while audioOnlyEndPending:
                            //   it means the TV bundle has switched to non-video mode →
                            //   safe to fully clear audioOnly state (no texture leak).
                            const uIsVid = mat.uniforms.uIsVideo;
                            if (uIsVid) {
                                let _origIsVid = uIsVid.value;
                                Object.defineProperty(uIsVid, 'value', {
                                    get() {
                                        if (window.audioOnlyActive || window.audioOnlyEndPending) return 0;
                                        return _origIsVid;
                                    },
                                    set(v) {
                                        _origIsVid = v;
                                        // TV bundle confirmed non-video mode → complete the handoff
                                        if (window.audioOnlyEndPending && v === 0) {
                                            console.log('[WS Interceptor] TV bundle left video mode — clearing audioOnly state cleanly.');
                                            window.audioOnlyActive     = false;
                                            window.audioOnlyEndPending = false;
                                            window.overrideTvTexture   = null; // safe: no video leaks now
                                            window.act2VisualSequenceActive = false;
                                        }
                                    },
                                    configurable: true
                                });
                            }
                        }

                        // ── ACT2 timed visual sequence (per-frame) ────────────
                        const _origUpdate = tv.update;
                        tv.update = function(time, delta) {
                            if (window.audioOnlyActive && window.act2VisualSequenceActive) {
                                const elapsed = window.audioOnlyStartElapsed +
                                    (Date.now() - window.audioOnlyLocalStartTime) / 1000;
                                const dur = window.audioOnlyDuration || 60;

                                if (elapsed >= dur) {
                                    // ── Sequence done ──────────────────────────
                                    // Hold black, switch to "ending" mode.
                                    // We'll fully clear once TV bundle leaves video mode.
                                    if (!window.audioOnlyEndPending) {
                                        window.audioOnlyEndPending    = true;
                                        window.overrideTvTexture      = getBlackTexture();
                                        window.act2VisualSequenceActive = false;
                                        // audioOnlyActive stays true until uIsVideo=0 confirms handoff
                                        console.log('[WS Interceptor] ACT2 sequence done — holding black, waiting for TV bundle handoff.');
                                    }
                                } else if (elapsed < 11.0) {
                                    // 0-11s: TV powered off, grass growing — silence + black
                                    if (window.tvVideoElement) window.tvVideoElement.volume = 0;
                                    window.overrideTvTexture = getBlackTexture();
                                } else if (elapsed < 50.0) {
                                    // 11-50s: image visible, audio fades in (11-13s)
                                    const tgt = window.tvOverrideVolume != null
                                        ? window.tvOverrideVolume / 100 : 0.9;
                                    if (window.tvVideoElement) {
                                        window.tvVideoElement.volume =
                                            elapsed < 13.0 ? ((elapsed - 11.0) / 2.0) * tgt : tgt;
                                    }
                                    window.overrideTvTexture = window.act2ImageTexture || getBlackTexture();
                                } else if (elapsed < 55.0) {
                                    // 50-55s: audio fades out
                                    const tgt = window.tvOverrideVolume != null
                                        ? window.tvOverrideVolume / 100 : 0.9;
                                    if (window.tvVideoElement) {
                                        window.tvVideoElement.volume =
                                            Math.max(0, ((55.0 - elapsed) / 5.0) * tgt);
                                    }
                                    window.overrideTvTexture = window.act2ImageTexture || getBlackTexture();
                                } else {
                                    // 55-60s: silence + static noise
                                    if (window.tvVideoElement) window.tvVideoElement.volume = 0;
                                    updateStaticNoise();
                                    window.overrideTvTexture = staticTexture;
                                }
                            }
                            _origUpdate.call(this, time, delta);
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
    const _OrigWS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        let modifiedUrl = url;
        try {
            let id = localStorage.getItem('kimeraware_client_id');
            if (!id) {
                id = 'client_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
                localStorage.setItem('kimeraware_client_id', id);
            }
            let tmp = url, isWs = false, isWss = false;
            if (url.startsWith('ws://'))       { tmp = url.replace('ws://', 'http://');   isWs  = true; }
            else if (url.startsWith('wss://')) { tmp = url.replace('wss://', 'https://'); isWss = true; }
            const u = new URL(tmp, window.location.href);
            u.searchParams.set('clientId', id);
            if (window.location.pathname.includes('/v2')) {
                u.searchParams.set('testing', 'true');
                console.log('[WS Interceptor] v2 staging detected → testing=true');
            }
            modifiedUrl = u.toString();
            if (isWs)  modifiedUrl = modifiedUrl.replace('http://', 'ws://');
            if (isWss) modifiedUrl = modifiedUrl.replace('https://', 'wss://');
        } catch(e) { console.error('[WS Interceptor] clientId append failed:', e); }

        console.log('[WS Interceptor] Connecting:', modifiedUrl);
        const ws = new _OrigWS(modifiedUrl, protocols);

        ws.addEventListener('open', () => {
            window.wsConnected = true;
            window.wsProgress  = 100;
            if (typeof window.updateOverallProgress === 'function') window.updateOverallProgress();
            console.log('[WS Interceptor] Connected.');
        });

        // ── AES-GCM decryption ───────────────────────────────────────────────
        let _cryptoKey = null;
        async function _getKey() {
            if (_cryptoKey) return _cryptoKey;
            const seed  = new Uint8Array("75,87,95,65,82,71".split(',').map(Number));
            const salt  = new TextEncoder().encode('kimeraware-ws-2025');
            const hmac  = await crypto.subtle.importKey('raw', seed, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
            const digest = await crypto.subtle.sign('HMAC', hmac, salt);
            return _cryptoKey = await crypto.subtle.importKey('raw', digest, {name:'AES-GCM'}, false, ['decrypt']);
        }
        async function decrypt(raw) {
            try {
                const b = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
                const iv = b.slice(0,12), tag = b.slice(12,28), ct = b.slice(28);
                const buf = new Uint8Array(ct.length + 16);
                buf.set(ct); buf.set(tag, ct.length);
                const key = await _getKey();
                const pt  = await crypto.subtle.decrypt({name:'AES-GCM',iv}, key, buf);
                return JSON.parse(new TextDecoder().decode(pt));
            } catch {
                try { return JSON.parse(raw); } catch(e2) { throw e2; }
            }
        }

        // ── Texture loader ───────────────────────────────────────────────────
        let _texLoader = null;
        function loadTexture(imgUrl, cb) {
            if (!imgUrl) { cb && cb(null); return; }
            let url = imgUrl;
            if (imgUrl.startsWith('/assets/')) {
                const h = window.location.hostname;
                if (h !== 'localhost' && h !== '127.0.0.1' && !h.includes('macrostasis.dev')) {
                    url = 'https://kimeraware.macrostasis.dev' + imgUrl;
                }
            }
            if (!_texLoader) _texLoader = new THREE.TextureLoader();
            const ext = url.startsWith('http') && !url.includes(window.location.hostname);
            _texLoader.setCrossOrigin(ext ? 'anonymous' : undefined);
            _texLoader.load(url, tex => {
                tex.colorSpace    = THREE.SRGBColorSpace;
                tex.minFilter     = THREE.LinearFilter;
                tex.generateMipmaps = false;
                tex.needsUpdate   = true;
                console.log('[WS Interceptor] Texture loaded:', url);
                cb && cb(tex);
            }, undefined, err => {
                console.error('[WS Interceptor] Texture load failed:', url, err);
                cb && cb(null);
            });
        }

        // ── audioOnly handler ────────────────────────────────────────────────
        // When audioOnly=true:
        //   - Force mode='video' so TV bundle starts the video player (audio source)
        //   - Block the video texture via uTexture getter (shows black/ACT2image instead)
        //   - Preload ACT2 image if provided
        //   - audioOnlyActive=true blocks subsequent apply_preset from stopping video player
        //
        // When audioOnly=false (any normal trigger_video or apply_preset):
        //   - Clear all audioOnly state immediately
        //   - overrideTvTexture=null → video (or preset) shows normally
        function handleAudioOnly(dec) {
            const isAO = dec.audioOnly === true || dec.audioOnly === 'true';
            if (isAO) {
                dec.mode = 'video'; // TV bundle must start video player for audio

                window.tvOverrideVolume        = dec.videoVolume != null ? dec.videoVolume : null;
                window.audioOnlyOverrideUntil  = Date.now() + (dec.duration || 60) * 1000;
                window.audioOnlyLocalStartTime = Date.now();
                window.audioOnlyStartElapsed   = (dec.originalDuration || 60) - (dec.duration || 60);
                window.audioOnlyDuration       = dec.duration || 60;
                window.audioOnlyActive         = true;
                window.audioOnlyEndPending     = false;

                // Preload ACT2 image (may take 1-2s; will be ready long before t=11s)
                const imgUrl = dec.imageUrl || dec.imageData || dec.mainImageData;
                if (imgUrl) {
                    window.lastAct2ImageUrl = imgUrl;
                    // Don't clear act2ImageTexture here — if already loaded keep it
                    if (!window.act2ImageTexture) {
                        loadTexture(imgUrl, tex => { window.act2ImageTexture = tex; });
                    }
                } else {
                    window.lastAct2ImageUrl = null;
                }

                // Don't set overrideTvTexture yet — visual sequence starts when act2 preset arrives
                // act2VisualSequenceActive stays false until activateAct2Visual() is called
                console.log('[WS Interceptor] audioOnly ON. dur:', dec.duration, 'img:', imgUrl);
                return true; // modified → send to TV bundle (mode changed to video)
            } else {
                _clearAudioOnly();
                return false;
            }
        }

        function _clearAudioOnly() {
            window.audioOnlyActive          = false;
            window.audioOnlyEndPending      = false;
            window.audioOnlyOverrideUntil   = null;
            window.overrideTvTexture        = null;
            window.act2ImageTexture         = null;
            window.act2VisualSequenceActive = false;
            window.lastAct2ImageUrl         = null;
        }

        // ── ACT2 visual sequence activator ───────────────────────────────────
        // Called when presetId=act2 is received while audioOnly is active.
        // Starts the timed texture timeline (tv.update hook handles it per-frame).
        function activateAct2Visual(imgUrl) {
            if (!window.audioOnlyActive) {
                console.warn('[WS Interceptor] activateAct2Visual: audioOnly not active, ignoring');
                return;
            }
            window.act2VisualSequenceActive = true;
            // overrideTvTexture: black by default (shows during 0-11s phase)
            window.overrideTvTexture = getBlackTexture();

            // Use already-preloaded texture; only load if missing
            if (!window.act2ImageTexture && imgUrl) {
                loadTexture(imgUrl, tex => { window.act2ImageTexture = tex; });
            } else if (window.act2ImageTexture) {
                console.log('[WS Interceptor] ACT2 image texture already preloaded, reusing.');
            }
            console.log('[WS Interceptor] ACT2 visual sequence ACTIVATED. act2ImageTexture ready:', !!window.act2ImageTexture);
        }
        window._activateAct2Visual = activateAct2Visual;

        // ── Reset handler ────────────────────────────────────────────────────
        function handleReset() {
            _clearAudioOnly();
            window.actCurrentlyActive = false;
            window.actPausedVideoInfo = null;
        }

        // ── Generic ACT pause/resume ─────────────────────────────────────────
        function onActActivated(id) {
            if (window.actCurrentlyActive) return;
            window.actCurrentlyActive = true;
            window.actActiveId = id;
            const v = window.tvVideoElement;
            if (v && v.src && !v.paused) {
                const isLive = !isFinite(v.duration) || v.duration === Infinity;
                window.actPausedVideoInfo = {
                    url: v.src, currentTime: v.currentTime,
                    isLive, capturedAt: Date.now(), volume: v.volume
                };
                console.log(`[WS Interceptor] ACT${id} paused video at ${v.currentTime.toFixed(2)}s (live:${isLive})`);
            }
        }
        function onActDeactivated(id) {
            if (!window.actCurrentlyActive || window.actActiveId !== id) return;
            window.actCurrentlyActive = false;
            window.actActiveId = null;
            const info = window.actPausedVideoInfo;
            window.actPausedVideoInfo = null;
            if (!info || !info.url) return;
            const v = window.tvVideoElement;
            if (!v) return;
            if (info.isLive) {
                if (v.paused) v.play().catch(() => {});
            } else {
                const dt = (Date.now() - info.capturedAt) / 1000;
                v.volume = info.volume;
                v.currentTime = Math.min(isFinite(v.duration) ? v.duration - 0.5 : Infinity,
                                         info.currentTime + dt);
                if (v.paused) v.play().catch(() => {});
                console.log(`[WS Interceptor] ACT${id} resumed VOD at ${v.currentTime.toFixed(2)}s`);
            }
        }

        // ── Core message processing ──────────────────────────────────────────
        // Returns { dec, modified, block }
        // block=true → message should NOT reach TV bundle
        // modified=true → send dec (as JSON plain text) instead of original encrypted msg
        function processMessage(dec) {
            let modified = false, block = false;

            if (dec && (dec.type === 'trigger_video' || dec.type === 'apply_preset')) {
                if (dec.type === 'apply_preset') window.lastAppliedPreset = dec;
                modified = handleAudioOnly(dec);

                // Block apply_preset from reaching TV bundle while audioOnly is running
                // (it would reset the video player and cut audio).
                // EXCEPTION: when audioOnlyEndPending=true, we MUST let apply_preset through
                // so the TV bundle can switch away from video mode, which triggers the uIsVideo=0
                // setter that safely clears our state.
                if (dec.type === 'apply_preset' && window.audioOnlyActive && !window.audioOnlyEndPending) {
                    block = true;
                    console.log('[WS Interceptor] Blocking apply_preset (audioOnly active):', dec.presetId);
                }
            } else if (dec && dec.type === 'reset') {
                handleReset();
            }

            return { dec, modified, block };
        }

        // Wrap a raw listener (used by both addEventListener and onmessage setter)
        function wrapListener(listener) {
            return async function(event) {
                try {
                    const dec = await decrypt(event.data);
                    const { modified, block } = processMessage(dec);
                    if (block) return;
                    if (modified) {
                        return listener.call(this, new MessageEvent('message', {
                            data: JSON.stringify(dec),
                            origin: event.origin,
                            lastEventId: event.lastEventId,
                            source: event.source,
                            ports: event.ports
                        }));
                    }
                } catch(e) {
                    console.error('[WS Interceptor] Proxy message error:', e);
                }
                return listener.call(this, event);
            };
        }

        // ── Proxy ────────────────────────────────────────────────────────────
        const proxy = new Proxy(ws, {
            get(tgt, prop) {
                if (prop === 'addEventListener') {
                    return function(type, listener, opts) {
                        if (type === 'message') {
                            const wrapped = wrapListener(listener);
                            if (!tgt._wl) tgt._wl = new Map();
                            tgt._wl.set(listener, wrapped);
                            return tgt.addEventListener(type, wrapped, opts);
                        }
                        return tgt.addEventListener(type, listener, opts);
                    };
                }
                if (prop === 'removeEventListener') {
                    return function(type, listener, opts) {
                        if (type === 'message' && tgt._wl && tgt._wl.has(listener)) {
                            const w = tgt._wl.get(listener);
                            tgt._wl.delete(listener);
                            return tgt.removeEventListener(type, w, opts);
                        }
                        return tgt.removeEventListener(type, listener, opts);
                    };
                }
                if (prop === 'onmessage') return tgt.onmessage;
                const v = tgt[prop];
                return typeof v === 'function' ? v.bind(tgt) : v;
            },
            set(tgt, prop, value) {
                if (prop === 'onmessage' && value) {
                    tgt[prop] = wrapListener(value);
                    return true;
                }
                tgt[prop] = value;
                return true;
            }
        });

        // ── Raw listener: ACT state machine ─────────────────────────────────
        // Runs on every message (not blocked by proxy) to manage ACT activation,
        // ACT2 visual sequence, and generic pause/resume.
        ws.addEventListener('message', async (event) => {
            try {
                let data;
                const raw = event.data;
                if (typeof raw === 'string' && raw.startsWith('{')) data = JSON.parse(raw);
                else if (typeof raw === 'string') data = await decrypt(raw);
                if (!data) return;

                if (data.type === 'apply_preset' || data.type === 'trigger_video') {
                    const pid = data.presetId || '';

                    // Generic ACT detection: act1, act2, act3 ... actN
                    const m = pid.match(/^act(\d+)$/i);
                    if (m) {
                        onActActivated(parseInt(m[1]));
                    } else if (data.type === 'apply_preset' && pid && window.actCurrentlyActive) {
                        onActDeactivated(window.actActiveId);
                    }

                    // ACT1
                    if (pid === 'act1' || data.act1 === true) {
                        if (typeof window.setAct1 === 'function') window.setAct1(true);
                        if (typeof window.setAct2 === 'function') window.setAct2(false);
                    } else if (data.type === 'apply_preset' && pid !== 'act1') {
                        if (typeof window.setAct1 === 'function') window.setAct1(false);
                    }

                    // ACT2
                    if (pid === 'act2' || data.act2 === true) {
                        if (typeof window.setAct2 === 'function') {
                            window.setAct2(true, data.elapsedSeconds || 0);
                        }
                        if (typeof window.setAct1 === 'function') window.setAct1(false);

                        // Activate ACT2 visual sequence if audioOnly is already running
                        if (window.audioOnlyActive && !window.act2VisualSequenceActive) {
                            const imgUrl = data.mainImageData || window.lastAct2ImageUrl;
                            activateAct2Visual(imgUrl);
                        }
                    } else if (data.type === 'apply_preset' && pid !== 'act2') {
                        if (typeof window.setAct2 === 'function') window.setAct2(false);
                    }

                } else if (data.type === 'reset') {
                    if (typeof window.setAct1 === 'function') window.setAct1(false);
                    if (typeof window.setAct2 === 'function') window.setAct2(false);
                    if (window.actCurrentlyActive) onActDeactivated(window.actActiveId);
                }
            } catch(e) { /* ignore decode errors */ }
        });

        return proxy;
    };

    // Copy static WebSocket properties
    Object.getOwnPropertyNames(_OrigWS).forEach(p => {
        if (Object.prototype.hasOwnProperty.call(_OrigWS, p)) {
            try { window.WebSocket[p] = _OrigWS[p]; } catch(e) {}
        }
    });
    window.WebSocket.prototype = _OrigWS.prototype;

    // Safety: mark WS loaded if connection never opens
    setTimeout(() => {
        if (!window.wsConnected) {
            console.warn('[WS Interceptor] WS timeout — marking loaded');
            window.wsProgress = 100;
            if (typeof window.updateOverallProgress === 'function') window.updateOverallProgress();
        }
    }, 5000);
})();
