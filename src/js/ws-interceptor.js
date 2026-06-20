// WebSocket Interceptor — KimeraWare v21-final
// Strategy: audioOnly uses a SEPARATE <audio> element completely outside TV bundle.
// TV bundle never enters video mode during audioOnly → zero texture leaks possible.
(function() {
    // ── Client-side debug logging to server ──────────────────────────────────
    function sendDebugLog(type, msg) {
        fetch('/log_debug', {
            method: 'POST',
            body: JSON.stringify({ type, msg, timestamp: Date.now(), url: location.href })
        }).catch(() => {});
    }
    const _origError = console.error;
    console.error = function(...args) {
        _origError.apply(console, args);
        sendDebugLog('ERROR', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };
    const _origWarn = console.warn;
    console.warn = function(...args) {
        _origWarn.apply(console, args);
        sendDebugLog('WARN', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };
    window.addEventListener('error', function(e) {
        sendDebugLog('UNCAUGHT', e.message + ' at ' + e.filename + ':' + e.lineno);
    });

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

    // (video override race protection removed — server now sends apply_preset before trigger_video)

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
        lockUniform(m.uniforms, 'uPowerOff', 0);
    }
    function unlockAct2Uniforms(m) {
        if (!m || !m.uniforms) return;
        ['uScaleX', 'uScaleY', 'uIsVideo', 'uChildVisibility', 'uTexture', 'uTextureText', 'uPowerOff'].forEach(k => unlockUniform(m.uniforms, k));
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


    // ── Intercept video element creation for pause/resume tracking and Sync Shield ────────────
    const _origCE = document.createElement.bind(document);
    document.createElement = function(tag, opts) {
        const el = _origCE(tag, opts);
        if (typeof tag === 'string' && tag.toLowerCase() === 'video') {
            if (!window.creatingAct3Video && !el.dataset.isAct3Video) {
                window.tvVideoElement = el;
            }

            // Block play() calls on the main video element during an active ACT
            const _origPlay = el.play;
            el.play = function() {
                if ((window.actCurrentlyActive || window.act3Active) && this === window.actPausedVideoElement) {
                    console.log('[WS Interceptor] Blocking play() call on video element during active ACT.');
                    return Promise.resolve();
                }
                return _origPlay.apply(this, arguments);
            };

            // Protect video element from out-of-bounds HLS seeking (Sync Shield)
            const _origDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
            if (_origDescriptor && _origDescriptor.set) {
                Object.defineProperty(el, 'currentTime', {
                    get: _origDescriptor.get,
                    set: function(val) {
                        const isLive = window._kwActiveVideoOverride && 
                                       (window._kwActiveVideoOverride.isLive === true || 
                                        window._kwActiveVideoOverride.live === true || 
                                        window._kwActiveVideoOverride.isLive === 'true' || 
                                        window._kwActiveVideoOverride.live === 'true' || 
                                        String(window._kwActiveVideoOverride.videoUrl).includes('wNJPvFoGalM') || 
                                        String(window._kwActiveVideoOverride.videoUrl).includes('hls-wNJPvFoGalM'));
                        const isHlsLive = isLive || 
                                          (this.src && (this.src.includes('wNJPvFoGalM') || this.src.includes('hls_live') || this.src.includes('live=1')));

                        if (isHlsLive) {
                            // BLOCK all seeks that are not initiated internally by Hls.js
                            const stack = new Error().stack || '';
                            const isFromHls = stack.includes('hls.js') || stack.includes('hls.min.js');
                            if (!isFromHls) {
                                console.log('[Sync Shield] Live Stream: swallowing manual/sync/drift seek to ' + val.toFixed(1) + 's');
                                return;
                            }

                            // For live streams, only allow seeks that fall inside the current seekable range
                            let minSeekable = 0;
                            let maxSeekable = 0;
                            try {
                                if (this.seekable && this.seekable.length > 0) {
                                    minSeekable = this.seekable.start(0);
                                    maxSeekable = this.seekable.end(this.seekable.length - 1);
                                }
                            } catch (e) {}

                            if (maxSeekable > 0) {
                                if (val < minSeekable || val > maxSeekable + 2.0) {
                                    console.log('[Sync Shield] Live Stream: swallowing out-of-bounds seek to ' + val.toFixed(1) + 's (seekable: ' + minSeekable.toFixed(1) + 's - ' + maxSeekable.toFixed(1) + 's)');
                                    return;
                                }
                            } else {
                                // If seekable range is not loaded yet, only allow initial starts (val === 0) or swallow
                                if (val > 0) {
                                    console.log('[Sync Shield] Live Stream: swallowing early seek to ' + val.toFixed(1) + 's before seekable range is populated.');
                                    return;
                                }
                            }
                        } else {
                            // VOD (video on demand): swallow seeks that are past the maximum seekable end + 2s
                            let maxSeekable = 0;
                            try {
                                if (this.seekable && this.seekable.length > 0) {
                                    maxSeekable = this.seekable.end(this.seekable.length - 1);
                                }
                            } catch (e) {}

                            if (maxSeekable > 0 && val > maxSeekable + 2.0) {
                                console.log('[Sync Shield] Swallowing out-of-bounds seek to ' + val.toFixed(1) + 's (max seekable: ' + maxSeekable.toFixed(1) + 's)');
                                return;
                            }
                        }

                        return _origDescriptor.set.call(this, val);
                    },
                    configurable: true,
                    enumerable: true
                });
            }
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
                                const tl = window.audioOnlyTimeline || {
                                    startFadeIn: 11.0,
                                    startPlateau: 13.0,
                                    startFadeOut: 50.0,
                                    startStatic: 55.0
                                };

                                if (elapsed < tl.startFadeIn) {
                                    // 0-startFadeIn: black
                                    if (ao) ao.volume = 0;
                                    tex = getBlackTex();
                                } else if (elapsed < tl.startPlateau) {
                                    // startFadeIn-startPlateau: image fades in with audio
                                    const fadeDur = tl.startPlateau - tl.startFadeIn;
                                    const progress = fadeDur > 0 ? (elapsed - tl.startFadeIn) / fadeDur : 1.0;
                                    if (ao) ao.volume = progress * tgt;
                                    tex = window.act2ImageTexture || getBlackTex();
                                } else if (elapsed < tl.startFadeOut) {
                                    // startPlateau-startFadeOut: full audio + image
                                    if (ao) ao.volume = tgt;
                                    tex = window.act2ImageTexture || getBlackTex();
                                } else if (elapsed < tl.startStatic) {
                                    // startFadeOut-startStatic: audio fades out
                                    const fadeOutDur = tl.startStatic - tl.startFadeOut;
                                    const progress = fadeOutDur > 0 ? (tl.startStatic - elapsed) / fadeOutDur : 0.0;
                                    if (ao) ao.volume = Math.max(0, progress * tgt);
                                    tex = window.act2ImageTexture || getBlackTex();
                                } else {
                                    // startStatic onwards: static noise (full screen)
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
                        } else if (_act2UniformsLocked && !window.act3Active) {
                            // Safety: if sequence stopped unexpectedly, unlock
                            const m = window._kwMat;
                            unlockAct2Uniforms(m);
                            _act2UniformsLocked = false;
                            console.log('[WS Interceptor] ACT2: uniforms unlocked (safety cleanup).');
                        }

                        // ── ACT3 TV override ─────────────────────────────────────────────────
                        // Three states driven by flags set in act3.js each frame:
                        //   act3TvBlack   → black texture on CRT (phases 0, 4, pre-fade)
                        //   act3TvStatic  → static noise on CRT  (phases 1 and 3)
                        //   act3TvTexture → canvas-blended video  (fade-in during phase 2)
                        const now = Date.now();
                        const isRestoring = !window.act3Active && _act2UniformsLocked && window.act3RestoredTime && (now - window.act3RestoredTime < 1500);

                        if ((window.act3Active || isRestoring) && !window.act2VisualSequenceActive) {
                            const m3 = window._kwMat;
                            if (m3 && m3.uniforms) {
                                let tex3;
                                if (isRestoring) {
                                    tex3 = getBlackTex();
                                } else if (window.act3TvTexture) {
                                    tex3 = window.act3TvTexture;
                                } else if (window.act3TvBlack) {
                                    tex3 = getBlackTex();
                                } else if (window.act3TvStatic) {
                                    tex3 = updateStaticNoise();
                                }
                                if (tex3) {
                                    if (!_act2UniformsLocked) {
                                        lockAct2Uniforms(m3, tex3);
                                        _act2UniformsLocked = true;
                                        console.log('[WS Interceptor] ACT3: TV uniforms locked.');
                                    } else {
                                        setLockedUniformValue('uTexture', tex3);
                                        setLockedUniformValue('uTextureText', getBlankTextTex());
                                    }

                                    // Dynamic uIsVideo: 1 during the actual video phase, 0 during static/black
                                    if (m3.uniforms.uIsVideo && m3.uniforms.uIsVideo.__kwLocked) {
                                        setLockedUniformValue('uIsVideo', (!isRestoring && window.act3TvTexture) ? 1 : 0);
                                    }

                                    // Dynamic uPowerOff: 1 during black/restoring phases, 0 during static/video
                                    if (m3.uniforms.uPowerOff && m3.uniforms.uPowerOff.__kwLocked) {
                                        setLockedUniformValue('uPowerOff', (isRestoring || window.act3TvBlack) ? 1 : 0);
                                    }

                                    m3.needsUpdate = true;
                                }
                            }

                            // Dynamic TV light intensities for PowerOff visual sync
                            if (isRestoring || window.act3TvBlack) {
                                if (window.tvCrtLight) window.tvCrtLight.intensity = 0;
                                if (window.tvBezelLight) window.tvBezelLight.intensity = 0;
                            } else {
                                if (window.tvBezelLight) window.tvBezelLight.intensity = 4.5 * 1.5;
                            }
                        } else if (!window.act3Active && _act2UniformsLocked && !window.act2VisualSequenceActive) {
                            const m3 = window._kwMat;
                            unlockAct2Uniforms(m3);
                            _act2UniformsLocked = false;
                            if (m3 && m3.uniforms) {
                                if (m3.uniforms.uTexture)         m3.uniforms.uTexture.value         = window._kwOrigTex;
                                if (m3.uniforms.uTextureText)     m3.uniforms.uTextureText.value     = window._kwOrigTextTex;
                                if (m3.uniforms.uChildVisibility) m3.uniforms.uChildVisibility.value = window._kwOrigChildVis;
                                if (m3.uniforms.uScaleX)          m3.uniforms.uScaleX.value          = 1;
                                if (m3.uniforms.uScaleY)          m3.uniforms.uScaleY.value          = 1;
                                if (m3.uniforms.uIsVideo)         m3.uniforms.uIsVideo.value         = window._kwOrigIsVid;
                                if (m3.uniforms.uPowerOff)         m3.uniforms.uPowerOff.value         = 0;
                                m3.needsUpdate = true;
                            }
                            if (window.tvBezelLight) window.tvBezelLight.intensity = 4.5 * 1.5;
                            console.log('[WS Interceptor] ACT3: TV uniforms restored.');
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
        let wsEventChain = Promise.resolve();
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

        async function getDecryptedEventData(event) {
            if (event.__decryptedData !== undefined) {
                return event.__decryptedData;
            }
            try {
                const dec = await decrypt(event.data);
                event.__decryptedData = dec;
                if (dec) {
                    const { block } = processMsg(dec);
                    event.__blocked = block;
                } else {
                    event.__blocked = false;
                }
            } catch(e) {
                event.__decryptedData = null;
                event.__blocked = false;
                console.error('[WS Interceptor] Decryption failed:', e);
            }
            return event.__decryptedData;
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

        // ── Canvas-based image preprocessor (clamp dark pixels to true black) ──
        function processImageAndClamp(imgUrl, threshold, cb) {
            if (!imgUrl) { cb && cb(null); return; }
            const resolvedUrl = _resolveAssetUrl(imgUrl);
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = function() {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);

                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const data = imgData.data;
                    const len = data.length;

                    for (let i = 0; i < len; i += 4) {
                        if (data[i] < threshold && data[i+1] < threshold && data[i+2] < threshold) {
                            data[i]   = 0;
                            data[i+1] = 0;
                            data[i+2] = 0;
                        }
                    }
                    ctx.putImageData(imgData, 0, 0);

                    const tex = new THREE.CanvasTexture(canvas);
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.minFilter = THREE.LinearFilter;
                    tex.generateMipmaps = false;
                    tex.needsUpdate = true;
                    console.log('[WS Interceptor] Clamped texture ready (threshold=' + threshold + ')');
                    cb && cb(tex);
                } catch(e) {
                    console.error('[WS Interceptor] Canvas clamp failed, fallback to normal:', e);
                    loadTex(imgUrl, cb);
                }
            };
            img.onerror = function(e) {
                console.error('[WS Interceptor] Image load fail for clamping:', resolvedUrl, e);
                cb && cb(null);
            };
            img.src = resolvedUrl;
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
                window.audioOnlyTimeline       = dec.timeline || {
                    startFadeIn: 11.0,
                    startPlateau: 13.0,
                    startFadeOut: 50.0,
                    startStatic: 55.0
                };

                // Start separate audio player
                _startAudioPlayer(dec.videoUrl || '', volPct, startElapsed);

                // Preload ACT2 image
                window.act2ClampThreshold = dec.clampThreshold != null ? parseInt(dec.clampThreshold) : 8;
                const imgUrl = dec.imageUrl || dec.imageData || dec.mainImageData;
                window.lastAct2ImageUrl = imgUrl || null;
                if (imgUrl && !window.act2ImageTexture) {
                    const threshold = window.act2ClampThreshold || 0;
                    if (threshold > 0) {
                        processImageAndClamp(imgUrl, threshold, tex => {
                            window.act2ImageTexture = tex;
                            console.log('[WS Interceptor] ACT2 image preloaded (clamped).');
                        });
                    } else {
                        loadTex(imgUrl, tex => {
                            window.act2ImageTexture = tex;
                            console.log('[WS Interceptor] ACT2 image preloaded.');
                        });
                    }
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
                window.act2ClampThreshold        = 0;
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
                const threshold = window.act2ClampThreshold || 0;
                if (threshold > 0) {
                    processImageAndClamp(imgUrl, threshold, tex => {
                        window.act2ImageTexture = tex;
                        console.log('[WS Interceptor] ACT2 image loaded (late, clamped).');
                    });
                } else {
                    loadTex(imgUrl, tex => {
                        window.act2ImageTexture = tex;
                        console.log('[WS Interceptor] ACT2 image loaded (late load).');
                    });
                }
            }
            console.log('[WS Interceptor] ACT2 visual sequence ACTIVE. Image ready:', !!window.act2ImageTexture);
        }

        function isLiveStream(d) {
            if (!d) return false;
            const url = String(d.videoUrl || '');
            const isYtLive = url.includes('wNJPvFoGalM');
            return d.isLive === true ||
                   d.live === true ||
                   d.isLive === 'true' ||
                   d.live === 'true' ||
                   isYtLive ||
                   url.includes('.m3u8') ||
                   url.includes('hls_live') ||
                   url.includes('live=1');
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
                    
                    if (isLiveStream(dec)) {
                        dec.isLive = true;
                        dec.live = true;
                        dec.originalDuration = Infinity;
                        dec.duration = Infinity;
                        dec.startTime = Date.now();
                        modified = true;
                        console.log('[WS Interceptor] Live stream trigger detected: forcing infinite duration and current startTime.');
                    }
                    
                    // Store active override for reloading on resume
                    window._kwActiveVideoOverride = JSON.parse(JSON.stringify(dec));
                    // Detect YouTube Short → activate portrait pillarbox
                    const newIsShort = dec.isShort === true || dec.isShort === 'true' ||
                        !!(dec.videoUrl && dec.videoUrl.match(/\/shorts\/[a-zA-Z0-9_-]{11}/));
                    if (newIsShort !== window.shortVideoActive) {
                        window.shortVideoActive = newIsShort;
                        console.log(`[WS Interceptor] Short portrait mode: ${newIsShort ? 'ON (uScaleX=' + window.shortScaleX + ')' : 'OFF'}`);
                    }

                    // Server now sends apply_preset BEFORE trigger_video for non-audioOnly,
                    // so the bundle runs Te() first (storing preset in V), then starts the video.
                    // No interception needed here — the ordering fix on the server prevents the race.
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

            } else if (dec.type === 'video_sync') {
                if (window._kwActiveVideoOverride && isLiveStream(window._kwActiveVideoOverride)) {
                    block = true;
                    console.log('[WS Interceptor] Blocked video_sync message for HLS livestream to prevent drift seeks.');
                }
            } else if (dec.type === 'reset') {
                _stopAudioPlayer();
                window.audioOnlyActive          = false;
                window.act2VisualSequenceActive = false;
                window.overrideTvTexture        = null;
                window.act2ImageTexture         = null;
                window.lastAct2ImageUrl         = null;
                window.act2ClampThreshold        = 0;
                window.actCurrentlyActive       = false;
                window.actPausedVideoInfo       = null;
                window.actPausedVideoElement    = null;
                window.shortVideoActive         = false;
            }
            return { block, modified };
        }

        // ── Generic ACT pause/resume ──────────────────────────────────────────
        function onActOn(id) {
            // Allow re-entry if it's a different ACT (unlikely but safe)
            if (window.actCurrentlyActive && window.actActiveId === id) return;
            window.actCurrentlyActive = true; window.actActiveId = id;
            const v = window.tvVideoElement;
            window.actPausedVideoElement = v;
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
            window.actPausedVideoElement = null;
            const i = window.actPausedVideoInfo; window.actPausedVideoInfo = null;
            if (!i) return;
            const v = window.tvVideoElement; if (!v) return;
            // Restore volume
            try { v.volume = i.vol; } catch(e) {}
            if (i.live) {
                // Live: reload the stream cleanly at the live edge by simulated reset + trigger_video
                if (window._kwActiveVideoOverride && window._kwActiveWs) {
                    console.log(`[WS Interceptor] ACT${id}: reloading live stream at the live edge (reset + trigger_video).`);
                    
                    // 1. Send simulated reset to clear the internal Je URL cache
                    window._kwActiveWs.dispatchEvent(new MessageEvent('message', {
                        data: JSON.stringify({ type: 'reset', _simulated: true })
                    }));
                    
                    // 2. Send simulated trigger_video to reload Hls.js player
                    const triggerData = {
                        ...window._kwActiveVideoOverride,
                        startTime: Date.now(),
                        _simulated: true
                    };
                    window._kwActiveWs.dispatchEvent(new MessageEvent('message', {
                        data: JSON.stringify(triggerData)
                    }));
                } else {
                    if (v.paused) v.play().catch(()=>{});
                    console.log(`[WS Interceptor] ACT${id}: live stream resumed (no reload state).`);
                }
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
            return function(event) {
                wsEventChain = wsEventChain.then(async () => {
                    try {
                        await getDecryptedEventData(event);
                        if (event.__blocked) return;
                        listener.call(this, event);
                    } catch(e) { console.error('[WS Interceptor] Error in wrapped listener:', e); }
                });
            };
        }

        // ── Wrap the raw state machine listener to preserve ordering without blocking ──
        function wrapRaw(listener) {
            return function(event) {
                wsEventChain = wsEventChain.then(async () => {
                    try {
                        await getDecryptedEventData(event);
                        await listener(event);
                    } catch(e) { console.error('[WS Interceptor] Error in raw listener:', e); }
                });
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
        window._kwActiveWs = proxy; // Save global reference

        // ── Raw listener: ACT state machine ──────────────────────────────────
        ws.addEventListener('message', wrapRaw(async (event) => {
            try {
                const d = event.__decryptedData;
                if (!d || d._simulated) return;

                // ── Dynamic tagline updates ──
                if (d.tagline1 !== undefined && d.tagline1 !== null) {
                    const el = document.getElementById('tagline-distorsiona');
                    if (el) el.innerText = d.tagline1;
                }
                if (d.tagline2 !== undefined && d.tagline2 !== null) {
                    const el = document.getElementById('tagline-comienza');
                    if (el) el.innerText = d.tagline2;
                }

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
                        // Act3: deactivate if act2 starts
                        if (typeof window.setAct3 === 'function' && window.act3Active) window.setAct3(false);
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

                    // ── ACT3 ──────────────────────────────────────────────────────────────
                    if (pid === 'act3' || d.act3 === true) {
                        if (typeof window.setAct3 === 'function') {
                            window.setAct3(true, d.elapsedSeconds || 0, d.startTime || null);
                        }
                        // Deactivate act1 and act2
                        if (typeof window.setAct1 === 'function') window.setAct1(false);
                        else window.pendingAct1State = { active: false };
                        if (typeof window.setAct2 === 'function') window.setAct2(false);
                        else window.pendingAct2State = { active: false };
                    } else if (d.type === 'apply_preset' && pid !== 'act3') {
                        // Any non-act3 preset stops act3
                        if (typeof window.setAct3 === 'function' && window.act3Active) {
                            window.setAct3(false);
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
                    if (typeof window.setAct3 === 'function' && window.act3Active) {
                        window.setAct3(false);
                    }
                    window.lastAppliedPreset = null;
                    if (window.actCurrentlyActive) onActOff(window.actActiveId);
                }
            } catch(e) { /* ignore */ }
        }));

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
