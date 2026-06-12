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

    // YouTube Shorts portrait pillarbox
    // uScaleX > 1 = pillarboxed (content narrower than full screen)
    // For 9:16 Short on ~1.14:1 CRT screen → uScaleX ≈ 2.0 → content fills ~50% screen width, centered
    window.shortVideoActive = false;
    window.shortScaleX      = 2.0;

    // Pending states to resolve initialization race condition
    window.pendingAct1State = null;
    window.pendingAct2State = null;

    let _setAct2Val = null;
    Object.defineProperty(window, 'setAct2', {
        get() { return _setAct2Val; },
        set(fn) {
            _setAct2Val = fn;
            if (typeof fn === 'function' && window.pendingAct2State) {
                const s = window.pendingAct2State;
                window.pendingAct2State = null;
                console.log('[WS Interceptor] Executing pending setAct2:', s);
                fn(s.active, s.elapsedSeconds);
            }
        },
        configurable: true
    });

    let _setAct1Val = null;
    Object.defineProperty(window, 'setAct1', {
        get() { return _setAct1Val; },
        set(fn) {
            _setAct1Val = fn;
            if (typeof fn === 'function' && window.pendingAct1State) {
                const s = window.pendingAct1State;
                window.pendingAct1State = null;
                console.log('[WS Interceptor] Executing pending setAct1:', s);
                fn(s.active);
            }
        },
        configurable: true
    });

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
            _sCanvas.width = _sCanvas.height = 512;
            _sCanvas.height = 512;
            _sCtx = _sCanvas.getContext('2d');
            _sTex = new THREE.CanvasTexture(_sCanvas);
            _sTex.minFilter = _sTex.magFilter = THREE.NearestFilter;
        }
        const id = _sCtx.createImageData(512, 512);
        for (let i = 0; i < id.data.length; i += 4) {
            const v = Math.random() * 255 | 0;
            id.data[i] = id.data[i+1] = id.data[i+2] = v; id.data[i+3] = 255;
        }
        _sCtx.putImageData(id, 0, 0);
        _sTex.needsUpdate = true;
        return _sTex;
    }

    // ── Uniform lock helpers ──────────────────────────────────────────────────
    // The TV bundle's Lt() runs AFTER tv.update(), so it overwrites our uniforms.
    // We lock specific uniforms so no external code can change them during ACT2.
    let _lockedUniforms = {};
    function lockUniform(uniforms, key, lockedValue) {
        if (!uniforms || !(key in uniforms)) return;
        const u = uniforms[key];
        if (u.__kwLocked) return; // already locked
        const original = Object.getOwnPropertyDescriptor(u, 'value');
        u.__kwLocked = true;
        u.__kwOrigDesc = original;
        Object.defineProperty(u, 'value', {
            get() { return lockedValue; },
            set(_v) { /* blocked during ACT2 */ },
            configurable: true,
            enumerable: true
        });
        _lockedUniforms[key] = { u, lockedValue };
    }
    function setLockedUniformValue(key, newValue) {
        if (_lockedUniforms[key]) {
            _lockedUniforms[key].lockedValue = newValue;
            const u = _lockedUniforms[key].u;
            // Re-define with new locked value
            Object.defineProperty(u, 'value', {
                get() { return newValue; },
                set(_v) { /* blocked during ACT2 */ },
                configurable: true,
                enumerable: true
            });
        }
    }
    function unlockUniform(uniforms, key) {
        if (!uniforms || !(key in uniforms)) return;
        const u = uniforms[key];
        if (!u.__kwLocked) return;
        const origDesc = u.__kwOrigDesc;
        if (origDesc) {
            Object.defineProperty(u, 'value', origDesc);
        } else {
            Object.defineProperty(u, 'value', { value: 1, writable: true, configurable: true, enumerable: true });
        }
        u.__kwLocked = false;
        delete u.__kwOrigDesc;
        delete _lockedUniforms[key];
    }
    function lockAct2Uniforms(m, tex) {
        if (!m || !m.uniforms) return;
        lockUniform(m.uniforms, 'uScaleX', 1);
        lockUniform(m.uniforms, 'uScaleY', 1);
        lockUniform(m.uniforms, 'uIsVideo', 0);
        lockUniform(m.uniforms, 'uChildVisibility', 0);
        lockUniform(m.uniforms, 'uTexture', tex);
        lockUniform(m.uniforms, 'uTextureText', null);
    }
    function unlockAct2Uniforms(m) {
        if (!m || !m.uniforms) return;
        ['uScaleX', 'uScaleY', 'uIsVideo', 'uChildVisibility', 'uTexture', 'uTextureText'].forEach(k => unlockUniform(m.uniforms, k));
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

    let _blankTextTex = null;
    function getBlankTextTex() {
        if (!_blankTextTex) {
            const c = document.createElement('canvas');
            c.width = c.height = 1024;
            _blankTextTex = new THREE.CanvasTexture(c);
            _blankTextTex.colorSpace = THREE.SRGBColorSpace;
            _blankTextTex.minFilter = THREE.LinearFilter;
            _blankTextTex.generateMipmaps = false;
        }
        return _blankTextTex;
    }

    // ── ACT2 exit fade overlay ──────────────────────────────────────────────────────
    // When ACT2 ends, the TV bundle snaps background/fog/darkness to default instantly.
    // We show a CSS black overlay on top of the canvas that fades out smoothly,
    // masking the snap and revealing the clean default state softly.
    function _showAct2EndOverlay() {
        const existing = document.getElementById('kw-act2-end');
        if (existing) { existing.remove(); }
        if (!document.body) return; // guard: DOM not ready (shouldn’t happen but safe)
        const el = document.createElement('div');
        el.id = 'kw-act2-end';
        el.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
            'background:#000', 'opacity:1', 'z-index:9998', 'pointer-events:none',
            'transition:opacity 1.2s ease-in-out'
        ].join(';');
        document.body.appendChild(el);
        // Hold at black briefly, then fade out
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => { if (el.parentNode) el.remove(); }, 1300);
        }, 350);
        console.log('[WS Interceptor] ACT2 exit fade overlay shown.');
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
                        window._kwOrigTex       = mat.uniforms.uTexture      ? mat.uniforms.uTexture.value      : null;
                        window._kwOrigTextTex   = mat.uniforms.uTextureText  ? mat.uniforms.uTextureText.value  : null;
                        window._kwOrigChildVis  = mat.uniforms.uChildVisibility ? mat.uniforms.uChildVisibility.value : 0;
                        window._kwOrigIsVid     = mat.uniforms.uIsVideo      ? mat.uniforms.uIsVideo.value      : 0;
                    }

                    // ── Per-frame ACT2 visual timeline ────────────────────────
                    // Strategy: run AFTER the TV bundle's Lt() so we always win.
                    // We wrap tv.update so our code runs LAST, after the bundle
                    // has already called Lt() internally.
                    // For scale: we LOCK the uScaleX/uScaleY uniforms so even if
                    // Lt() runs after us, its write is silently swallowed.
                    let _act2UniformsLocked = false;
                    const _origUp = tv.update;
                    tv.update = function(time, delta) {
                        // Run the original update (which calls Lt() internally)
                        _origUp.call(this, time, delta);

                        // Now override AFTER Lt() has run — we always win
                        if (window.audioOnlyActive && window.act2VisualSequenceActive) {
                            const elapsed = window.audioOnlyStartElapsed +
                                (Date.now() - window.audioOnlyLocalStartTime) / 1000;
                            const dur = window.audioOnlyDuration || 60;
                            const tgt = (window.tvOverrideVolume != null ? window.tvOverrideVolume : 90) / 100;
                            const ao  = window._aoPlayerElement;
                            const m   = window._kwMat;

                            if (elapsed >= dur) {
                                // ── Sequence done: unlock + restore original uniforms ──
                                if (ao) ao.volume = 0;
                                _stopAudioPlayer();
                                if (_act2UniformsLocked) {
                                    unlockAct2Uniforms(m);
                                    _act2UniformsLocked = false;
                                }
                                if (m && m.uniforms) {
                                    if (m.uniforms.uTexture) m.uniforms.uTexture.value = window._kwOrigTex;
                                    if (m.uniforms.uTextureText) m.uniforms.uTextureText.value = window._kwOrigTextTex;
                                    if (m.uniforms.uChildVisibility) m.uniforms.uChildVisibility.value = window._kwOrigChildVis;
                                    if (m.uniforms.uScaleX) m.uniforms.uScaleX.value = 1;
                                    if (m.uniforms.uScaleY) m.uniforms.uScaleY.value = 1;
                                    if (m.uniforms.uIsVideo) m.uniforms.uIsVideo.value = window._kwOrigIsVid;
                                    m.needsUpdate = true;
                                }
                                window.audioOnlyActive          = false;
                                window.act2VisualSequenceActive = false;
                                window.overrideTvTexture        = null;
                                console.log('[WS Interceptor] ACT2 sequence complete — uniforms restored.');

                            } else if (m && m.uniforms) {
                                // ── Active: determine texture for this frame ──
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
                                    // 55-60s: static noise (full screen)
                                    if (ao) ao.volume = 0;
                                    tex = updateStaticNoise();
                                }

                                // Lock uniforms on first active frame (prevents Lt() overwrite)
                                if (!_act2UniformsLocked) {
                                    lockAct2Uniforms(m, tex);
                                    _act2UniformsLocked = true;
                                    console.log('[WS Interceptor] ACT2: uniforms locked (prevents Lt() scale override).');
                                } else {
                                    // Update locked values each frame
                                    setLockedUniformValue('uTexture', tex);
                                    setLockedUniformValue('uTextureText', getBlankTextTex());
                                }
                                m.needsUpdate = true;
                            }
                        } else if (_act2UniformsLocked) {
                            // Safety: if sequence stopped unexpectedly, unlock
                            const m = window._kwMat;
                            unlockAct2Uniforms(m);
                            _act2UniformsLocked = false;
                            console.log('[WS Interceptor] ACT2: uniforms unlocked (safety cleanup).');
                        }

                        // ── Short video portrait pillarbox ─────────────────────────────────
                        // If a YouTube Short (9:16) is active and we're NOT in an ACT2 sequence,
                        // apply uScaleX > 1 so the video appears in a centered portrait column.
                        // The TV bundle does NOT touch uScaleX in video mode, so one write per
                        // frame is enough to maintain it.
                        if (window.shortVideoActive &&
                            !window.act2VisualSequenceActive &&
                            !window.audioOnlyActive) {
                            const m = window._kwMat;
                            if (m && m.uniforms) {
                                if (m.uniforms.uScaleX && !m.uniforms.uScaleX.__kwLocked)
                                    m.uniforms.uScaleX.value = window.shortScaleX;
                                if (m.uniforms.uScaleY && !m.uniforms.uScaleY.__kwLocked)
                                    m.uniforms.uScaleY.value = 1;
                                m.needsUpdate = true;
                            }
                        } else if (!window.shortVideoActive &&
                                   !window.act2VisualSequenceActive &&
                                   !window.audioOnlyActive &&
                                   !_act2UniformsLocked) {
                            // Normal mode: ensure scale is 1 if it was left at Short scale
                            const m = window._kwMat;
                            if (m && m.uniforms && m.uniforms.uScaleX &&
                                !m.uniforms.uScaleX.__kwLocked &&
                                m.uniforms.uScaleX.value === window.shortScaleX) {
                                m.uniforms.uScaleX.value = 1;
                                m.uniforms.uScaleY.value = 1;
                                m.needsUpdate = true;
                            }
                        }
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
                if ((typeof crypto === 'undefined' || !crypto.subtle) && typeof window !== 'undefined' && typeof window.decryptWsMessageFallback === 'function') {
                    return window.decryptWsMessageFallback(raw);
                }
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

                // CRITICAL FIX: If act2 preset is already active (e.g. late connection), activate the visual sequence immediately!
                if (window.lastAppliedPreset && window.lastAppliedPreset.presetId === 'act2') {
                    activateAct2Visual(imgUrl || window.lastAppliedPreset.mainImageData);
                }

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

                // BLOCK audioOnly trigger_video — TV bundle must NOT enter video mode
                if (dec.type === 'trigger_video' && (dec.audioOnly === true || dec.audioOnly === 'true')) {
                    handleAudioOnly(dec);
                    block = true;
                    console.log('[WS Interceptor] Blocked audioOnly trigger_video from TV bundle.');
                } else if (dec.type === 'trigger_video') {
                    handleAudioOnly(dec);
                    // Detect YouTube Short → activate portrait pillarbox
                    const newIsShort = dec.isShort === true || dec.isShort === 'true' ||
                        !!(dec.videoUrl && dec.videoUrl.match(/\/shorts\/[a-zA-Z0-9_-]{11}/));
                    if (newIsShort !== window.shortVideoActive) {
                        window.shortVideoActive = newIsShort;
                        console.log(`[WS Interceptor] Short portrait mode: ${newIsShort ? 'ON (uScaleX=' + window.shortScaleX + ')' : 'OFF'}`);
                    }
                }

                // Let apply_preset reach the TV bundle. ACT presets must update the TV
                // state so the CRT material and ACT visuals stay in sync; only the
                // audioOnly trigger_video is blocked to prevent VideoTexture creation.

                // SEÑAL PENDIENTE defense: if act2 preset arrives and we're not yet in
                // audioOnly mode (race condition: override hasn't arrived yet), immediately
                // force a black texture so the TV bundle never renders SEÑAL PENDIENTE.
                // The correct visual state will activate when audioOnly override arrives next.
                if (dec.type === 'apply_preset' && dec.presetId === 'act2' && !window.audioOnlyActive) {
                    window.overrideTvTexture = getBlackTex();
                    console.log('[WS Interceptor] ACT2 preset arrived before audioOnly — forcing black texture (anti-SEÑAL-PENDIENTE).');
                }

                // ACT2 EXIT detection: when a non-act2, non-black_screen preset arrives
                // while act2 was running (even in a background tab), force-clean all state
                // immediately. This handles the case where the rAF was paused (tab in
                // background) and the cleanup timeline never ran.
                if (dec.type === 'apply_preset' &&
                    dec.presetId !== 'act2' &&
                    dec.presetId !== 'black_screen' &&
                    (window.act2VisualSequenceActive || window.audioOnlyActive)) {
                    _stopAudioPlayer();
                    window.audioOnlyActive          = false;
                    window.act2VisualSequenceActive = false;
                    window.overrideTvTexture        = null;
                    window.act2ImageTexture         = null;
                    window.lastAct2ImageUrl         = null;
                    // Show smooth fade overlay to mask the instant preset-change snap
                    _showAct2EndOverlay();
                    console.log('[WS Interceptor] ACT2 exit: forced state cleanup + fade overlay (tab may have been backgrounded).');
                }
            } else if (dec.type === 'reset') {
                _stopAudioPlayer();
                window.audioOnlyActive          = false;
                window.act2VisualSequenceActive = false;
                window.overrideTvTexture        = null;
                window.act2ImageTexture         = null;
                window.lastAct2ImageUrl         = null;
                window.actCurrentlyActive       = false;
                window.actPausedVideoInfo       = null;
                window.shortVideoActive         = false; // clear Short portrait mode on reset
            }
            return { block, modified };
        }

        // ── Generic ACT pause/resume ──────────────────────────────────────────
        function onActOn(id) {
            // Allow re-entry if it's a different ACT (unlikely but safe)
            if (window.actCurrentlyActive && window.actActiveId === id) return;
            window.actCurrentlyActive = true; window.actActiveId = id;
            const v = window.tvVideoElement;
            // Capture video state: track even if paused (auto-play may have been blocked)
            if (v && v.src) {
                const live = !isFinite(v.duration) || v.duration === Infinity || v.duration === 0;
                const ct = (v.readyState >= 1 && isFinite(v.currentTime)) ? v.currentTime : 0;
                window.actPausedVideoInfo = { url: v.src, t: ct, live, at: Date.now(), vol: v.volume };
                if (!v.paused) {
                    try { v.pause(); } catch(e) {}
                    console.log(`[WS Interceptor] ACT${id}: paused video at ${ct.toFixed(1)}s (live=${live})`);
                } else {
                    console.log(`[WS Interceptor] ACT${id}: video already paused at ${ct.toFixed(1)}s (saved state)`);
                }
            }
        }
        function onActOff(id) {
            // Accept any id if actCurrentlyActive — handles stale id mismatches
            if (!window.actCurrentlyActive) return;
            window.actCurrentlyActive = false; window.actActiveId = null;
            const i = window.actPausedVideoInfo; window.actPausedVideoInfo = null;
            if (!i) return;
            const v = window.tvVideoElement; if (!v) return;
            // Restore volume
            try { v.volume = i.vol; } catch(e) {}
            if (i.live) {
                // Live: sync to live edge
                try {
                    if (v.seekable && v.seekable.length > 0) {
                        const edge = v.seekable.end(v.seekable.length - 1);
                        if (isFinite(edge) && edge > 0) v.currentTime = Math.max(0, edge - 1.5);
                    }
                } catch(e) {}
                if (v.paused) v.play().catch(()=>{});
                console.log(`[WS Interceptor] ACT${id}: live stream resynced to live edge.`);
            } else {
                // VOD: resume at exact captured timestamp
                try {
                    const resumeAt = Math.min(isFinite(v.duration) && v.duration > 0 ? v.duration - 0.5 : Infinity, i.t);
                    v.currentTime = resumeAt;
                } catch(e) {}
                if (v.paused) v.play().catch(()=>{});
                console.log(`[WS Interceptor] ACT${id}: VOD resumed at ${i.t.toFixed(1)}s.`);
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
                        if (typeof window.setAct1 === 'function') {
                            window.setAct1(true);
                        } else {
                            window.pendingAct1State = { active: true };
                        }
                        if (typeof window.setAct2 === 'function') {
                            window.setAct2(false);
                        } else {
                            window.pendingAct2State = { active: false };
                        }
                    } else if (d.type === 'apply_preset' && pid !== 'act1') {
                        if (typeof window.setAct1 === 'function') {
                            window.setAct1(false);
                        } else {
                            window.pendingAct1State = { active: false };
                        }
                    }

                    if (pid === 'act2' || d.act2 === true) {
                        if (typeof window.setAct2 === 'function') {
                            window.setAct2(true, d.elapsedSeconds || 0);
                        } else {
                            window.pendingAct2State = { active: true, elapsedSeconds: d.elapsedSeconds || 0 };
                        }
                        if (typeof window.setAct1 === 'function') {
                            window.setAct1(false);
                        } else {
                            window.pendingAct1State = { active: false };
                        }
                        // Activate visual sequence if audioOnly is already running
                        if (window.audioOnlyActive && !window.act2VisualSequenceActive) {
                            activateAct2Visual(d.mainImageData || window.lastAct2ImageUrl);
                        }
                    } else if (d.type === 'apply_preset' && pid !== 'act2') {
                        if (typeof window.setAct2 === 'function') {
                            window.setAct2(false);
                        } else {
                            window.pendingAct2State = { active: false };
                        }
                    }

                } else if (d.type === 'reset') {
                    if (typeof window.setAct1 === 'function') {
                        window.setAct1(false);
                    } else {
                        window.pendingAct1State = { active: false };
                    }
                    if (typeof window.setAct2 === 'function') {
                        window.setAct2(false);
                    } else {
                        window.pendingAct2State = { active: false };
                    }
                    window.lastAppliedPreset = null;
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
