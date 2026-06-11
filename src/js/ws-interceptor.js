// WebSocket Interceptor — KimeraWare v21-final
// Strategy: audioOnly uses a SEPARATE <audio> element completely outside TV bundle.
// TV bundle never enters video mode during audioOnly → zero texture leaks possible.
(function() {
    window.wsConnected = false;
    window.wsProgress  = 0;

    // ── Global state ──────────────────────────────────────────────────────────
    window.overrideTvTexture        = null;   // THREE.Texture to force on CRT screen
    window.audioOnlyActive          = false;  // audioOnly is running
    window.audioOnlyDuration        = 60;
    window.audioOnlyStartElapsed    = 0;
    window.audioOnlyLocalStartTime  = 0;
    window.tvOverrideVolume         = null;   // 0-100
    window.act2VisualSequenceActive = false;
    window.act2ImageTexture         = null;
    window.lastAct2ImageUrl         = null;

    // Generic ACT pause/resume
    window.actCurrentlyActive = false;
    window.actActiveId        = null;
    window.actPausedVideoInfo = null;

    // ── Separate audio-only player ────────────────────────────────────────────
    // Completely independent of the TV bundle. TV bundle stays in preset mode.
    let _aoHls   = null;
    let _aoVideo = null;

    function _resolveAssetUrl(url) {
        if (!url) return url;
        // Assets live on kimeraware.macrostasis.dev, not on GitHub Pages (kimeraware.com)
        if (url.startsWith('/assets/') || url.startsWith('/hls-')) {
            const h = location.hostname;
            if (h !== 'localhost' && !h.includes('127.0.0.1') && !h.includes('macrostasis.dev')) {
                return 'https://kimeraware.macrostasis.dev' + url;
            }
        }
        return url;
    }

    function _startAudioPlayer(videoUrl, volPct, startElapsed) {
        _stopAudioPlayer();
        const resolvedUrl = _resolveAssetUrl(videoUrl);
        const vid = document.createElement('audio'); // audio element, not video
        vid.crossOrigin = 'anonymous';
        vid.volume = Math.max(0, Math.min(1, (volPct != null ? volPct : 90) / 100));
        // Store reference so tv.update can control fade in/out
        _aoVideo = vid;
        window._aoPlayerElement = vid;

        const tryPlay = () => {
            if (startElapsed > 0 && isFinite(vid.duration) && vid.duration > 0) {
                vid.currentTime = Math.min(vid.duration - 1, startElapsed);
            }
            vid.play().catch(err => {
                console.warn('[AudioOnly] Autoplay blocked:', err.message, '— will retry on interaction');
                const retry = () => { vid.play().catch(() => {}); };
                document.addEventListener('click',     retry, { once: true });
                document.addEventListener('touchstart', retry, { once: true });
            });
        };

        if (resolvedUrl && resolvedUrl.includes('.m3u8') && typeof Hls !== 'undefined' && Hls.isSupported()) {
            _aoHls = new Hls({ enableWorker: false, debug: false });
            _aoHls.loadSource(resolvedUrl);
            _aoHls.attachMedia(vid);
            _aoHls.on(Hls.Events.MANIFEST_PARSED, tryPlay);
            _aoHls.on(Hls.Events.ERROR, (e, d) => {
                if (d.fatal) console.error('[AudioOnly HLS]', d.type, d.details);
            });
        } else if (resolvedUrl) {
            vid.src = resolvedUrl;
            vid.addEventListener('canplay', tryPlay, { once: true });
            vid.load();
        }
        console.log('[AudioOnly] Audio player started:', resolvedUrl, '(original:', videoUrl + ')', 'vol:', volPct + '%');

    }

    function _stopAudioPlayer() {
        if (_aoHls)  { try { _aoHls.destroy(); } catch(e){} _aoHls = null; }
        if (_aoVideo) {
            try { _aoVideo.pause(); _aoVideo.src = ''; } catch(e){}
            _aoVideo = null;
        }
        window._aoPlayerElement = null;
    }

    // ── Static noise texture ─────────────────────────────────────────────────
    let _sCanvas = null, _sCtx = null, _sTex = null;
    function updateStaticNoise() {
        if (!_sCanvas) {
            _sCanvas = document.createElement('canvas');
            _sCanvas.width = _sCanvas.height = 256;
            _sCtx = _sCanvas.getContext('2d');
            _sTex = new THREE.CanvasTexture(_sCanvas);
            _sTex.minFilter = _sTex.magFilter = THREE.NearestFilter;
        }
        const id = _sCtx.createImageData(256, 256);
        for (let i = 0; i < id.data.length; i += 4) {
            const v = Math.random() * 255 | 0;
            id.data[i] = id.data[i+1] = id.data[i+2] = v; id.data[i+3] = 255;
        }
        _sCtx.putImageData(id, 0, 0);
        _sTex.needsUpdate = true;
        return _sTex;
    }

    let _blackTex = null;
    function getBlackTex() {
        if (!_blackTex) {
            const c = document.createElement('canvas'); c.width = c.height = 1;
            c.getContext('2d').fillStyle = '#000'; c.getContext('2d').fillRect(0,0,1,1);
            _blackTex = new THREE.CanvasTexture(c);
        }
        return _blackTex;
    }

    // ── Intercept video element creation for pause/resume tracking ────────────
    const _origCE = document.createElement.bind(document);
    document.createElement = function(tag, opts) {
        const el = _origCE(tag, opts);
        if (typeof tag === 'string' && tag.toLowerCase() === 'video') {
            window.tvVideoElement = el;
        }
        return el;
    };

    // ── KimerawareTV.loadTV wrapper ───────────────────────────────────────────
    // Purpose: install uTexture getter so ACT2 can override what shows on the CRT.
    // Note: when audioOnly is active, TV bundle is in PRESET mode (not video mode)
    // so there is no video texture to leak. overrideTvTexture is only set during
    // act2VisualSequenceActive (t=11s→60s phase).
    let _kwTV;
    Object.defineProperty(window, 'KimerawareTV', {
        get() { return _kwTV; },
        set(val) {
            _kwTV = val;
            if (!val || !val.loadTV || val.loadTV.isWrapped) return;
            const _origLoad = val.loadTV;
            val.loadTV = function() {
                return _origLoad.apply(this, arguments).then(tv => {
                    const mat = tv && tv.crtScreen && tv.crtScreen.material;
                    if (mat && mat.uniforms) {

                        // Store references to uniforms — we write directly each frame
                        // instead of using getters (getters can be bypassed by THREE.js caching)
                        window._kwMat       = mat;
                        window._kwOrigTex   = mat.uniforms.uTexture  ? mat.uniforms.uTexture.value  : null;
                        window._kwOrigIsVid = mat.uniforms.uIsVideo  ? mat.uniforms.uIsVideo.value  : 0;
                    }

                    // ── Per-frame ACT2 visual timeline ────────────────────────
                    // We write DIRECTLY to mat.uniforms each frame — no getters.
                    // This guarantees THREE.js always uses our texture, bypassing
                    // any internal caching in WebGLTextures/WebGLUniforms.
                    const _origUp = tv.update;
                    tv.update = function(time, delta) {
                        if (window.audioOnlyActive && window.act2VisualSequenceActive) {
                            const elapsed = window.audioOnlyStartElapsed +
                                (Date.now() - window.audioOnlyLocalStartTime) / 1000;
                            const dur = window.audioOnlyDuration || 60;
                            const tgt = (window.tvOverrideVolume != null ? window.tvOverrideVolume : 90) / 100;
                            const ao  = window._aoPlayerElement;
                            const m   = window._kwMat;

                            if (elapsed >= dur) {
                                // ── Sequence done: restore original uniforms ──
                                if (ao) ao.volume = 0;
                                _stopAudioPlayer();
                                if (m && m.uniforms) {
                                    if (m.uniforms.uTexture)  m.uniforms.uTexture.value  = window._kwOrigTex;
                                    if (m.uniforms.uIsVideo)  m.uniforms.uIsVideo.value  = window._kwOrigIsVid;
                                    m.needsUpdate = true;
                                }
                                window.audioOnlyActive          = false;
                                window.act2VisualSequenceActive = false;
                                window.overrideTvTexture        = null;
                                console.log('[WS Interceptor] ACT2 sequence complete — uniforms restored.');

                            } else if (m && m.uniforms) {
                                // ── Active: write override texture directly ───
                                let tex;
                                if (elapsed < 11.0) {
                                    // 0-11s: black
                                    if (ao) ao.volume = 0;
                                    tex = getBlackTex();
                                } else if (elapsed < 13.0) {
                                    // 11-13s: image fades in with audio
                                    if (ao) ao.volume = ((elapsed - 11.0) / 2.0) * tgt;
                                    tex = window.act2ImageTexture || getBlackTex();
                                } else if (elapsed < 50.0) {
                                    // 13-50s: full audio + image
                                    if (ao) ao.volume = tgt;
                                    tex = window.act2ImageTexture || getBlackTex();
                                } else if (elapsed < 55.0) {
                                    // 50-55s: audio fades out
                                    if (ao) ao.volume = Math.max(0, ((55.0 - elapsed) / 5.0) * tgt);
                                    tex = window.act2ImageTexture || getBlackTex();
                                } else {
                                    // 55-60s: static noise
                                    if (ao) ao.volume = 0;
                                    tex = updateStaticNoise();
                                }

                                if (m.uniforms.uTexture && m.uniforms.uTexture.value !== tex) {
                                    m.uniforms.uTexture.value = tex;
                                    m.needsUpdate = true;
                                }
                                if (m.uniforms.uIsVideo && m.uniforms.uIsVideo.value !== 0) {
                                    m.uniforms.uIsVideo.value = 0;
                                    m.needsUpdate = true;
                                }
                            }
                        }
                        _origUp.call(this, time, delta);
                    };
                    return tv;
                });
            };
            val.loadTV.isWrapped = true;
            console.log('[WS Interceptor] KimerawareTV.loadTV wrapped.');
        },
        configurable: true
    });

    // ── WebSocket interception ────────────────────────────────────────────────
    const _OrigWS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        // Append clientId
        let modUrl = url;
        try {
            let id = localStorage.getItem('kimeraware_client_id');
            if (!id) {
                id = 'client_' + Math.random().toString(36).slice(2) + '_' + Date.now();
                localStorage.setItem('kimeraware_client_id', id);
            }
            const isWs = url.startsWith('ws://'), isWss = url.startsWith('wss://');
            let tmp = url.replace(/^wss?:\/\//, isWss ? 'https://' : 'http://');
            const u = new URL(tmp, location.href);
            u.searchParams.set('clientId', id);
            if (location.pathname.includes('/v2')) u.searchParams.set('testing', 'true');
            modUrl = u.toString().replace(/^https?:\/\//, isWss ? 'wss://' : isWs ? 'ws://' : 'wss://');
        } catch(e) { console.error('[WS] clientId error:', e); }

        const ws = new _OrigWS(modUrl, protocols);
        ws.addEventListener('open', () => {
            window.wsConnected = true; window.wsProgress = 100;
            if (typeof window.updateOverallProgress === 'function') window.updateOverallProgress();
        });

        // ── AES-GCM decrypt ───────────────────────────────────────────────────
        let _ck = null;
        async function _getKey() {
            if (_ck) return _ck;
            const seed   = new Uint8Array("75,87,95,65,82,71".split(',').map(Number));
            const salt   = new TextEncoder().encode('kimeraware-ws-2025');
            const hmac   = await crypto.subtle.importKey('raw', seed, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
            const digest = await crypto.subtle.sign('HMAC', hmac, salt);
            return _ck = await crypto.subtle.importKey('raw', digest, {name:'AES-GCM'}, false, ['decrypt']);
        }
        async function decrypt(raw) {
            try {
                const b   = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
                const iv  = b.slice(0,12), tag = b.slice(12,28), ct = b.slice(28);
                const buf = new Uint8Array(ct.length + 16);
                buf.set(ct); buf.set(tag, ct.length);
                const pt  = await crypto.subtle.decrypt({name:'AES-GCM',iv}, await _getKey(), buf);
                return JSON.parse(new TextDecoder().decode(pt));
            } catch { try { return JSON.parse(raw); } catch(e) { throw e; } }
        }

        // ── Texture loader ────────────────────────────────────────────────────
        let _tl = null;
        function loadTex(imgUrl, cb) {
            if (!imgUrl) { cb && cb(null); return; }
            let url = imgUrl;
            if (imgUrl.startsWith('/assets/')) {
                const h = location.hostname;
                if (h !== 'localhost' && !h.includes('127.0.0.1') && !h.includes('macrostasis.dev')) {
                    url = 'https://kimeraware.macrostasis.dev' + imgUrl;
                }
            }
            if (!_tl) _tl = new THREE.TextureLoader();
            _tl.setCrossOrigin('anonymous');
            _tl.load(url, tex => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.minFilter  = THREE.LinearFilter;
                tex.generateMipmaps = false;
                tex.needsUpdate = true;
                console.log('[WS Interceptor] Texture ready:', url);
                cb && cb(tex);
            }, undefined, e => { console.error('[WS Interceptor] Texture fail:', url, e); cb && cb(null); });
        }

        // ── handleAudioOnly ───────────────────────────────────────────────────
        // When audioOnly=true:
        //   1. BLOCK the trigger_video from reaching TV bundle
        //      (TV bundle stays in preset mode — no video mode, no VideoTexture, no leaks)
        //   2. Start a separate <audio> element with the HLS/video URL
        //   3. Preload the ACT2 image texture for later use
        //
        // When audioOnly=false (normal video or any clear): stop audio player, clear state.
        function handleAudioOnly(dec) {
            const isAO = dec.audioOnly === true || dec.audioOnly === 'true';
            if (isAO) {
                const volPct = dec.videoVolume != null ? dec.videoVolume : 90;
                const dur    = parseFloat(dec.duration) || 60;
                const origDur = parseFloat(dec.originalDuration) || dur;
                const startElapsed = origDur - dur;

                window.tvOverrideVolume        = volPct;
                window.audioOnlyLocalStartTime = Date.now();
                window.audioOnlyStartElapsed   = startElapsed;
                window.audioOnlyDuration       = dur;
                window.audioOnlyActive         = true;
                window.act2VisualSequenceActive = false; // visual activates when act2 preset arrives

                // Start separate audio player
                _startAudioPlayer(dec.videoUrl || '', volPct, startElapsed);

                // Preload ACT2 image
                const imgUrl = dec.imageUrl || dec.imageData || dec.mainImageData;
                window.lastAct2ImageUrl = imgUrl || null;
                if (imgUrl && !window.act2ImageTexture) {
                    loadTex(imgUrl, tex => {
                        window.act2ImageTexture = tex;
                        console.log('[WS Interceptor] ACT2 image preloaded.');
                    });
                }

                console.log('[WS Interceptor] audioOnly ON — blocking TV bundle, starting audio player. dur:', dur, 'img:', imgUrl);
                // Return false so wrapListener sends the ORIGINAL event — but we BLOCK it in processMsg
                return false;
            } else {
                // Normal video or clear: stop audio player, restore full TV bundle control
                _stopAudioPlayer();
                window.audioOnlyActive          = false;
                window.act2VisualSequenceActive = false;
                window.overrideTvTexture        = null;
                window.act2ImageTexture         = null;
                window.lastAct2ImageUrl         = null;
                return false;
            }
        }

        // ── activateAct2Visual ────────────────────────────────────────────────
        // Called when presetId=act2 arrives AND audioOnly is active.
        // Starts the per-frame timeline that controls overrideTvTexture.
        function activateAct2Visual(imgUrl) {
            if (!window.audioOnlyActive) {
                console.warn('[WS Interceptor] activateAct2Visual: audioOnly not active, skip');
                return;
            }
            window.act2VisualSequenceActive = true;
            window.overrideTvTexture = getBlackTex(); // default: black until t=11s

            // Use preloaded texture if ready; load if not
            if (window.act2ImageTexture) {
                console.log('[WS Interceptor] ACT2 image already preloaded ✓');
            } else if (imgUrl) {
                loadTex(imgUrl, tex => {
                    window.act2ImageTexture = tex;
                    console.log('[WS Interceptor] ACT2 image loaded (late load).');
                });
            }
            console.log('[WS Interceptor] ACT2 visual sequence ACTIVE. Image ready:', !!window.act2ImageTexture);
        }

        // ── processMsg ───────────────────────────────────────────────────────
        // Returns { block: bool, modified: bool }
        function processMsg(dec) {
            let block = false, modified = false;
            if (!dec) return { block, modified };

            if (dec.type === 'trigger_video' || dec.type === 'apply_preset') {
                if (dec.type === 'apply_preset') window.lastAppliedPreset = dec;

                handleAudioOnly(dec);

                // BLOCK audioOnly trigger_video — TV bundle must NOT enter video mode
                if (dec.type === 'trigger_video' && (dec.audioOnly === true || dec.audioOnly === 'true')) {
                    block = true;
                    console.log('[WS Interceptor] Blocked audioOnly trigger_video from TV bundle.');
                }

                // BLOCK apply_preset while audioOnly is active (would reset video player / disrupt state)
                if (dec.type === 'apply_preset' && window.audioOnlyActive) {
                    block = true;
                    console.log('[WS Interceptor] Blocked apply_preset (audioOnly active):', dec.presetId);
                }
            } else if (dec.type === 'reset') {
                _stopAudioPlayer();
                window.audioOnlyActive          = false;
                window.act2VisualSequenceActive = false;
                window.overrideTvTexture        = null;
                window.act2ImageTexture         = null;
                window.actCurrentlyActive       = false;
                window.actPausedVideoInfo       = null;
            }
            return { block, modified };
        }

        // ── Generic ACT pause/resume ──────────────────────────────────────────
        function onActOn(id) {
            if (window.actCurrentlyActive) return;
            window.actCurrentlyActive = true; window.actActiveId = id;
            const v = window.tvVideoElement;
            if (v && v.src && !v.paused) {
                const live = !isFinite(v.duration) || v.duration === Infinity;
                window.actPausedVideoInfo = { url: v.src, t: v.currentTime, live, at: Date.now(), vol: v.volume };
                console.log(`[WS Interceptor] ACT${id}: paused video at ${v.currentTime.toFixed(1)}s`);
            }
        }
        function onActOff(id) {
            if (!window.actCurrentlyActive || window.actActiveId !== id) return;
            window.actCurrentlyActive = false; window.actActiveId = null;
            const i = window.actPausedVideoInfo; window.actPausedVideoInfo = null;
            if (!i) return;
            const v = window.tvVideoElement; if (!v) return;
            v.volume = i.vol;
            if (i.live) { if (v.paused) v.play().catch(()=>{}); }
            else {
                const dt = (Date.now() - i.at) / 1000;
                v.currentTime = Math.min(isFinite(v.duration) ? v.duration - 0.5 : Infinity, i.t + dt);
                if (v.paused) v.play().catch(()=>{});
                console.log(`[WS Interceptor] ACT${id}: resumed at ${v.currentTime.toFixed(1)}s`);
            }
        }

        // ── Wrap a listener ───────────────────────────────────────────────────
        function wrap(listener) {
            return async function(event) {
                try {
                    const dec = await decrypt(event.data);
                    const { block } = processMsg(dec);
                    if (block) return;
                } catch(e) { console.error('[WS Interceptor]', e); }
                return listener.call(this, event);
            };
        }

        // ── Proxy ─────────────────────────────────────────────────────────────
        const proxy = new Proxy(ws, {
            get(t, p) {
                if (p === 'addEventListener') {
                    return (type, fn, opts) => {
                        if (type === 'message') {
                            const w = wrap(fn);
                            if (!t._wl) t._wl = new Map();
                            t._wl.set(fn, w);
                            return t.addEventListener(type, w, opts);
                        }
                        return t.addEventListener(type, fn, opts);
                    };
                }
                if (p === 'removeEventListener') {
                    return (type, fn, opts) => {
                        if (type === 'message' && t._wl?.has(fn)) {
                            const w = t._wl.get(fn); t._wl.delete(fn);
                            return t.removeEventListener(type, w, opts);
                        }
                        return t.removeEventListener(type, fn, opts);
                    };
                }
                if (p === 'onmessage') return t.onmessage;
                const v = t[p]; return typeof v === 'function' ? v.bind(t) : v;
            },
            set(t, p, v) {
                if (p === 'onmessage' && v) { t[p] = wrap(v); return true; }
                t[p] = v; return true;
            }
        });

        // ── Raw listener: ACT state machine ──────────────────────────────────
        ws.addEventListener('message', async (event) => {
            try {
                let d;
                if (typeof event.data === 'string' && event.data.startsWith('{'))
                    d = JSON.parse(event.data);
                else d = await decrypt(event.data);
                if (!d) return;

                if (d.type === 'apply_preset' || d.type === 'trigger_video') {
                    const pid = d.presetId || '';
                    const m = pid.match(/^act(\d+)$/i);
                    if (m) onActOn(parseInt(m[1]));
                    else if (d.type === 'apply_preset' && window.actCurrentlyActive) onActOff(window.actActiveId);

                    if (pid === 'act1' || d.act1 === true) {
                        if (typeof window.setAct1 === 'function') window.setAct1(true);
                        if (typeof window.setAct2 === 'function') window.setAct2(false);
                    } else if (d.type === 'apply_preset' && pid !== 'act1') {
                        if (typeof window.setAct1 === 'function') window.setAct1(false);
                    }

                    if (pid === 'act2' || d.act2 === true) {
                        if (typeof window.setAct2 === 'function') window.setAct2(true, d.elapsedSeconds || 0);
                        if (typeof window.setAct1 === 'function') window.setAct1(false);
                        // Activate visual sequence if audioOnly is already running
                        if (window.audioOnlyActive && !window.act2VisualSequenceActive) {
                            activateAct2Visual(d.mainImageData || window.lastAct2ImageUrl);
                        }
                    } else if (d.type === 'apply_preset' && pid !== 'act2') {
                        if (typeof window.setAct2 === 'function') window.setAct2(false);
                    }

                } else if (d.type === 'reset') {
                    if (typeof window.setAct1 === 'function') window.setAct1(false);
                    if (typeof window.setAct2 === 'function') window.setAct2(false);
                    if (window.actCurrentlyActive) onActOff(window.actActiveId);
                }
            } catch(e) { /* ignore */ }
        });

        return proxy;
    };

    Object.getOwnPropertyNames(_OrigWS).forEach(p => {
        try { window.WebSocket[p] = _OrigWS[p]; } catch(e) {}
    });
    window.WebSocket.prototype = _OrigWS.prototype;

    setTimeout(() => {
        if (!window.wsConnected) {
            window.wsProgress = 100;
            if (typeof window.updateOverallProgress === 'function') window.updateOverallProgress();
        }
    }, 5000);
})();
