// WebSocket Interceptor to track connection state
(function() {
    window.wsConnected = false;
    window.wsProgress = 0;
    window.overrideTvTexture = null;
    window.audioOnlyOverrideUntil = null;
    window.tvOverrideVolume = null;
    window.act2ImageTexture = null;
    window.tvVideoElement = null;
    window.audioOnlyActive = false;
    window.audioOnlyDuration = 60;

    // Static noise texture generator to display clean static at the end
    let staticCanvas = null;
    let staticCtx = null;
    let staticTexture = null;

    function updateStaticNoise() {
        if (!staticCanvas) {
            staticCanvas = document.createElement('canvas');
            staticCanvas.width = 256;
            staticCanvas.height = 256;
            staticCtx = staticCanvas.getContext('2d');
            staticTexture = new THREE.CanvasTexture(staticCanvas);
            staticTexture.minFilter = THREE.NearestFilter;
            staticTexture.magFilter = THREE.NearestFilter;
        }
        let imgData = staticCtx.createImageData(256, 256);
        let data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            let val = Math.floor(Math.random() * 255);
            data[i] = val;
            data[i+1] = val;
            data[i+2] = val;
            data[i+3] = 255;
        }
        staticCtx.putImageData(imgData, 0, 0);
        staticTexture.needsUpdate = true;
    }

    let blackTexture = null;
    function getBlackTexture() {
        if (!blackTexture) {
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, 1, 1);
            blackTexture = new THREE.CanvasTexture(canvas);
        }
        return blackTexture;
    }


    // Intercept video element creation to get direct access to its volume and progress
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName, options) {
        const el = originalCreateElement.call(document, tagName, options);
        if (tagName && tagName.toLowerCase() === 'video') {
            window.tvVideoElement = el;
            console.log('[WebSocket Interceptor] Intercepted TV video element creation');
        }
        return el;
    };
    
    // Auto-wrap KimerawareTV to intercept crtScreen texture in update loop
    let _kimerawareTV = undefined;
    Object.defineProperty(window, 'KimerawareTV', {
        get() {
            return _kimerawareTV;
        },
        set(val) {
            _kimerawareTV = val;
            if (val && val.loadTV && !val.loadTV.isWrapped) {
                console.log('[WebSocket Interceptor] Wrapping KimerawareTV.loadTV for texture override support');
                const originalLoadTV = val.loadTV;
                val.loadTV = function() {
                    return originalLoadTV.apply(this, arguments).then(tv => {
                        const material = tv.crtScreen.material;
                        if (material && material.uniforms) {
                            // Hijack uTexture via getter/setter to guarantee ZERO-leak video frames
                            const uTextureUniform = material.uniforms.uTexture;
                            if (uTextureUniform) {
                                let originalTextureVal = uTextureUniform.value;
                                Object.defineProperty(uTextureUniform, 'value', {
                                    get() {
                                        if (window.audioOnlyActive) {
                                            return window.overrideTvTexture || getBlackTexture();
                                        }
                                        return originalTextureVal;
                                    },
                                    set(val) {
                                        originalTextureVal = val;
                                    },
                                    configurable: true
                                });
                            }

                            // Hijack uIsVideo to always report 0 when audioOnly is active
                            const uIsVideoUniform = material.uniforms.uIsVideo;
                            if (uIsVideoUniform) {
                                let originalIsVideoVal = uIsVideoUniform.value;
                                Object.defineProperty(uIsVideoUniform, 'value', {
                                    get() {
                                        if (window.audioOnlyActive) {
                                            return 0;
                                        }
                                        return originalIsVideoVal;
                                    },
                                    set(val) {
                                        originalIsVideoVal = val;
                                    },
                                    configurable: true
                                });
                            }
                        }

                        const originalUpdate = tv.update;
                        tv.update = function(time, delta) {
                            // Custom ACT2 sequence control on client side:
                            if (window.audioOnlyActive) {
                                const elapsed = (window.audioOnlyStartElapsed !== undefined ? window.audioOnlyStartElapsed : 0) + 
                                                (Date.now() - (window.audioOnlyLocalStartTime || Date.now())) / 1000;
                                const duration = window.audioOnlyDuration || 60;

                                if (elapsed >= duration) {
                                    window.audioOnlyActive = false;
                                    window.overrideTvTexture = null;
                                } else {
                                    // 1. First 11 seconds (poweroff 5s + grass grow 6s): silence, show black background
                                    if (elapsed < 11.0) {
                                        if (window.tvVideoElement) window.tvVideoElement.volume = 0.0;
                                        window.overrideTvTexture = getBlackTexture();
                                    } 
                                    // 2. Second 11 to 50: show image, volume fades in from 11.0 to 13.0s (over 2 seconds)
                                    else if (elapsed >= 11.0 && elapsed < 50.0) {
                                        const targetVolume = (window.tvOverrideVolume !== null) ? window.tvOverrideVolume / 100 : 0.9;
                                        if (window.tvVideoElement) {
                                            if (elapsed < 13.0) {
                                                const t = (elapsed - 11.0) / 2.0;
                                                window.tvVideoElement.volume = t * targetVolume;
                                            } else {
                                                window.tvVideoElement.volume = targetVolume;
                                            }
                                        }
                                        window.overrideTvTexture = window.act2ImageTexture || getBlackTexture();
                                    } 
                                    // 3. Second 50 to 55: volume fades out over 5 seconds (50.0 to 55.0s)
                                    else if (elapsed >= 50.0 && elapsed < 55.0) {
                                        const targetVolume = (window.tvOverrideVolume !== null) ? window.tvOverrideVolume / 100 : 0.9;
                                        if (window.tvVideoElement) {
                                            const t = (55.0 - elapsed) / 5.0; // 1.0 down to 0.0
                                            window.tvVideoElement.volume = Math.max(0.0, t * targetVolume);
                                        }
                                        window.overrideTvTexture = window.act2ImageTexture || getBlackTexture();
                                    } 
                                    // 4. Second 55 to 60: silence, image disappears, show static (no text)
                                    else {
                                        if (window.tvVideoElement) window.tvVideoElement.volume = 0.0;
                                        updateStaticNoise();
                                        window.overrideTvTexture = staticTexture;
                                    }
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
            let isWs = false;
            let isWss = false;
            if (url.startsWith('ws://')) {
                tempUrl = url.replace('ws://', 'http://');
                isWs = true;
            } else if (url.startsWith('wss://')) {
                tempUrl = url.replace('wss://', 'https://');
                isWss = true;
            }
            
            const urlObj = new URL(tempUrl, window.location.href);
            urlObj.searchParams.set('clientId', id);
            
            // Check if testing mode is active (either path has /v2 or host is kimeraware.macrostasis.dev/v2)
            if (window.location.pathname.includes('/v2')) {
                urlObj.searchParams.set('testing', 'true');
                console.log('[WebSocket Interceptor] Staging v2 client detected. Connecting with testing=true.');
            }
            
            modifiedUrl = urlObj.toString();
            
            if (isWs) {
                modifiedUrl = modifiedUrl.replace('http://', 'ws://');
            } else if (isWss) {
                modifiedUrl = modifiedUrl.replace('https://', 'wss://');
            }
        } catch(e) {
            console.error('[WebSocket Interceptor] Failed to append clientId:', e);
        }

        console.log('[WebSocket Interceptor] Intercepted WebSocket creation to:', modifiedUrl);
        const ws = new OriginalWebSocket(modifiedUrl, protocols);
        
        ws.addEventListener('open', () => {
            console.log('[WebSocket Interceptor] WebSocket connected!');
            window.wsConnected = true;
            window.wsProgress = 100;
            if (typeof window.updateOverallProgress === 'function') {
                window.updateOverallProgress();
            }
        });

        // Decryption logic for encrypted WebSocket messages
        let Ae = null;
        async function kt() {
            if (Ae) return Ae;
            const e = "75,87,95,65,82,71",
                  n = new Uint8Array(e.split(",").map(Number)),
                  t = new TextEncoder().encode("kimeraware-ws-2025"),
                  i = await crypto.subtle.importKey("raw", n, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]),
                  d = await crypto.subtle.sign("HMAC", i, t);
            return Ae = await crypto.subtle.importKey("raw", d, {name: "AES-GCM"}, false, ["decrypt"]), Ae;
        }
        
        async function decryptMessage(e) {
            try {
                const n = Uint8Array.from(atob(e), r => r.charCodeAt(0)),
                      t = n.slice(0, 12),
                      i = n.slice(12, 28),
                      d = n.slice(28),
                      a = new Uint8Array(d.length + 16);
                a.set(d);
                a.set(i, d.length);
                const u = await kt(),
                      s = await crypto.subtle.decrypt({name: "AES-GCM", iv: t}, u, a);
                return JSON.parse(new TextDecoder().decode(s));
            } catch(err) {
                try { return JSON.parse(e); } catch { throw err; }
            }
        }

        // Helper to load image textures
        let textureLoader = null;
        function loadOverrideTexture(imgUrl, callback) {
            if (!imgUrl) return;
            if (!textureLoader) {
                textureLoader = new THREE.TextureLoader();
            }
            textureLoader.load(imgUrl, (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.minFilter = THREE.LinearFilter;
                texture.generateMipmaps = false;
                texture.needsUpdate = true;
                if (callback) {
                    callback(texture);
                } else {
                    window.overrideTvTexture = texture;
                    window.act2ImageTexture = texture;
                }
                console.log('[WebSocket Interceptor] Loaded override image texture:', imgUrl);
            }, undefined, (err) => {
                console.error('[WebSocket Interceptor] Failed to load override texture:', err);
            });
        }

        function handleAudioOnlyMessage(decrypted) {
            if (decrypted.audioOnly) {
                decrypted.mode = 'video'; // force video player to play stream
                let imgUrl = decrypted.imageUrl || decrypted.imageData || decrypted.mainImageData;
                if (!imgUrl && window.lastAppliedPreset) {
                    imgUrl = window.lastAppliedPreset.mainImageData || window.lastAppliedPreset.imageData;
                }
                if (!imgUrl) {
                    imgUrl = '/assets/padre_transparente.webp';
                }
                window.tvOverrideVolume = decrypted.videoVolume !== undefined ? decrypted.videoVolume : null;
                
                // Initialize overrideTvTexture synchronously to black to prevent any frame leak
                window.overrideTvTexture = getBlackTexture();
                window.act2ImageTexture = null;
                
                // Load the act2 image texture and store it
                loadOverrideTexture(imgUrl, (texture) => {
                    window.act2ImageTexture = texture;
                    console.log('[WebSocket Interceptor] Loaded act2 override image texture:', imgUrl);
                });

                window.audioOnlyOverrideUntil = Date.now() + (decrypted.duration || 60) * 1000;
                window.audioOnlyLocalStartTime = Date.now();
                window.audioOnlyStartElapsed = (decrypted.originalDuration || 60) - (decrypted.duration || 60);
                window.audioOnlyDuration = decrypted.duration || 60;
                window.audioOnlyActive = true;
                return true;
            } else {
                const isAudioOverrideActive = window.audioOnlyOverrideUntil && Date.now() < window.audioOnlyOverrideUntil;
                if (!isAudioOverrideActive || decrypted.type === 'trigger_video') {
                    window.overrideTvTexture = null;
                    window.audioOnlyOverrideUntil = null;
                    window.act2ImageTexture = null;
                    window.defaultAct2BackgroundTexture = null;
                    window.audioOnlyActive = false;
                }
                return false;
            }
        }

        function handleResetMessage() {
            window.overrideTvTexture = null;
            window.audioOnlyOverrideUntil = null;
            window.act2ImageTexture = null;
            window.defaultAct2BackgroundTexture = null;
            window.audioOnlyActive = false;
        }

        // Create Proxy to intercept event listeners and message handler
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
                                        if (decrypted.type === 'apply_preset') {
                                            window.lastAppliedPreset = decrypted;
                                        }
                                        modified = handleAudioOnlyMessage(decrypted);
                                    } else if (decrypted && decrypted.type === 'reset') {
                                        handleResetMessage();
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
                                    console.error('[WebSocket Interceptor] Error wrapping addEventListener message event:', e);
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
 
                if (prop === 'onmessage') {
                    return target.onmessage;
                }
 
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
                                    if (decrypted.type === 'apply_preset') {
                                        window.lastAppliedPreset = decrypted;
                                    }
                                    modified = handleAudioOnlyMessage(decrypted);
                                } else if (decrypted && decrypted.type === 'reset') {
                                    handleResetMessage();
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
                                console.error('[WebSocket Interceptor] Error wrapping onmessage:', e);
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

        // Intercept WS messages to trigger Act 1 & Act 2 sequence states in the proxy
        proxy.addEventListener('message', async (event) => {
            try {
                let data;
                const rawData = event.data;
                if (typeof rawData === 'string' && rawData.startsWith('{')) {
                    data = JSON.parse(rawData);
                } else if (typeof rawData === 'string') {
                    data = await decryptMessage(rawData);
                }
                
                if (data) {
                    // ── ACT1 detection ──────────────────────────────────────
                    if (data.type === 'apply_preset' || data.type === 'trigger_video') {
                        const isAct1 = data.presetId === 'act1' || 
                                       data.act1 === true ||
                                       (data.text && data.text.toLowerCase().includes('act1')) ||
                                       (data.videoUrl && data.videoUrl.toLowerCase().includes('act1'));
                        
                        if (isAct1) {
                            if (typeof window.setAct1 === 'function') window.setAct1(true);
                            if (typeof window.setAct2 === 'function') window.setAct2(false); // mutual exclusion
                        } else if (data.type === 'apply_preset' && data.presetId !== 'act1') {
                            if (typeof window.setAct1 === 'function') window.setAct1(false);
                        }

                        // ── ACT2 detection ──────────────────────────────────
                        const isAct2 = data.presetId === 'act2' ||
                                       data.act2 === true ||
                                       (data.text && data.text.toLowerCase().includes('act2')) ||
                                       (data.videoUrl && data.videoUrl.toLowerCase().includes('act2'));

                        if (isAct2) {
                            if (typeof window.setAct2 === 'function') {
                                const elapsed = data.elapsedSeconds || 0;
                                window.setAct2(true, elapsed);
                            }
                            if (typeof window.setAct1 === 'function') window.setAct1(false); // mutual exclusion
                        } else if (data.type === 'apply_preset' && data.presetId !== 'act2') {
                            if (typeof window.setAct2 === 'function') window.setAct2(false);
                        }

                    } else if (data.type === 'reset') {
                        if (typeof window.setAct1 === 'function') window.setAct1(false);
                        if (typeof window.setAct2 === 'function') window.setAct2(false);
                    }
                }
            } catch(e) {
                // Ignore errors
            }
        });

        return proxy;
    };
    // Copy static properties of WebSocket
    Object.getOwnPropertyNames(OriginalWebSocket).forEach(prop => {
        if (OriginalWebSocket.hasOwnProperty(prop)) {
            try {
                window.WebSocket[prop] = OriginalWebSocket[prop];
            } catch(e) {}
        }
    });
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    
    // Timeout to mark WS as loaded if connection takes too long
    setTimeout(() => {
        if (!window.wsConnected) {
            console.warn('[Loader] WebSocket connection timed out, marking as loaded to proceed...');
            window.wsProgress = 100;
            if (typeof window.updateOverallProgress === 'function') {
                window.updateOverallProgress();
            }
        }
    }, 5000);
})();
