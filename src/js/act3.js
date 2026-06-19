// ═══════════════════════════════════════════════════════════════════
//  ACT 3 — The Transmission  (r3)
//  Full broadcasting sync: latecomers jump to current elapsed time.
//  Video starts muted (autoplay safe), unmutes during fade-in.
//  Black-screen phases use TV CRT (black_screen-style black texture).
//  Audio plays throughout the full 90-s sequence (static + text).
//  Texts get ~70% of sequence time; statics get ~30%.
//  After 120 s the server is asked to reset to 'default'.
// ═══════════════════════════════════════════════════════════════════

// ── Globals read by environment.js / lights.js ───────────────────
window.act3Active         = false;
window.act3Elapsed        = 0.0;
window.act3Factor         = 0.0;
window.act3Target         = 0.0;
window.act3MorseIntensity = 0.0;

// ── Globals read by ws-interceptor.js tv.update wrapper ──────────
window.act3TvTexture = null;   // canvas VideoTexture (fade-in)
window.act3TvBlack   = false;  // show black on TV CRT
window.act3TvStatic  = false;  // show static noise on TV CRT

// ── Timeline ─────────────────────────────────────────────────────
const ACT3_BLACK_1_END  = 5;    // 0–5 s
const ACT3_STATIC_1_END = 10;   // 5–10 s
const ACT3_SEQUENCE_END = 100;  // 10–100 s  (90-s main sequence)
const ACT3_STATIC_2_END = 110;  // 100–110 s
const ACT3_BLACK_2_END  = 120;  // 110–120 s

// ── Assets ───────────────────────────────────────────────────────
const ACT3_AUDIO_URL = '/assets/act3_audio.mp3';
const ACT3_VIDEO_URL = '/assets/act3_video.mp4';

function _resolveAssetUrl(url) {
    if (!url) return url;
    if (url.startsWith('/assets/')) {
        const h = location.hostname;
        if (h !== 'localhost' && !h.includes('127.0.0.1') && !h.includes('macrostasis.dev')) {
            return 'https://kimeraware.macrostasis.dev' + url;
        }
    }
    return url;
}

// ── Morse ────────────────────────────────────────────────────────
const M_DOT = 0.20, M_DASH = 0.60, M_ELEM_GAP = 0.20, M_LETTER_GAP = 0.60, M_WORD_GAP = 2.00;
const MORSE_CODE = { K:[M_DASH,M_DOT,M_DASH], I:[M_DOT,M_DOT], M:[M_DASH,M_DASH],
    E:[M_DOT], R:[M_DOT,M_DASH,M_DOT], A:[M_DOT,M_DASH], W:[M_DOT,M_DASH,M_DASH] };
const KIMERAWARE_LETTERS = ['K','I','M','E','R','A','W','A','R','E'];
const MORSE_REPS = 3;

// ── TV fade config ────────────────────────────────────────────────
const ACT3_TV_FADE_START = ACT3_STATIC_1_END + 10;    // t = 20 s
const ACT3_TV_FADE_DUR   = 15.0;
const ACT3_TV_FADE_END   = ACT3_TV_FADE_START + ACT3_TV_FADE_DUR; // t = 35 s

// ── Module state ─────────────────────────────────────────────────
let _morseEvents  = null;
let _sequence     = null;
let _audioEl      = null;
let _videoEl      = null;
let _blendCanvas  = null;
let _blendCtx     = null;
let _blendTex     = null;
let _tvStarted    = false;
let _tvOpacity    = 0.0;
let _prevTextIdx  = -1;
let _act3AutoResetTimer = null;

// ═══════════════════════════════════════════════════════════════════
//  MORSE TIMELINE (absolute act3 times)
// ═══════════════════════════════════════════════════════════════════
function _buildMorse() {
    const events = [];
    let t = ACT3_STATIC_1_END;
    for (let rep = 0; rep < MORSE_REPS; rep++) {
        for (let li = 0; li < KIMERAWARE_LETTERS.length; li++) {
            const elems = MORSE_CODE[KIMERAWARE_LETTERS[li]];
            for (let ei = 0; ei < elems.length; ei++) {
                events.push({ start: t, end: t + elems[ei], on: true });
                t += elems[ei];
                if (ei < elems.length - 1) { events.push({ start:t, end:t+M_ELEM_GAP, on:false }); t += M_ELEM_GAP; }
            }
            if (li < KIMERAWARE_LETTERS.length - 1) { events.push({ start:t, end:t+M_LETTER_GAP, on:false }); t += M_LETTER_GAP; }
        }
        if (rep < MORSE_REPS - 1) { events.push({ start:t, end:t+M_WORD_GAP, on:false }); t += M_WORD_GAP; }
    }
    events.push({ start: t, end: Infinity, on: false });
    return events;
}

// ═══════════════════════════════════════════════════════════════════
//  TEXT / STATIC SEQUENCE (seeded by startElapsed for sync)
//  Texts = 70% of 90 s, Statics = 30%.  Uses seeded PRNG so all
//  clients build the same schedule from the same startElapsed seed.
// ═══════════════════════════════════════════════════════════════════
function _seededRand(seed) {
    // Simple mulberry32 PRNG
    return function() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function _buildSequence(startEpoch) {
    // Use preset start epoch as seed so all clients get the same randomisation
    const rand = _seededRand(Math.floor((startEpoch || Date.now()) / 1000));

    const NUM_TEXTS   = window.staticTexts ? window.staticTexts.length : 6;
    const NUM_STATICS = NUM_TEXTS + 1;
    const TOTAL       = ACT3_SEQUENCE_END - ACT3_STATIC_1_END; // 90 s
    const textPool    = TOTAL * 0.70; // 63 s
    const staticPool  = TOTAL * 0.30; // 27 s

    const textDurs = [];
    let tLeft = textPool;
    for (let i = 0; i < NUM_TEXTS - 1; i++) {
        const avg = tLeft / (NUM_TEXTS - i);
        const d   = avg * (0.8 + rand() * 0.4);
        textDurs.push(d); tLeft -= d;
    }
    textDurs.push(tLeft);

    const staticDurs = [];
    let sLeft = staticPool;
    for (let i = 0; i < NUM_STATICS - 1; i++) {
        const avg = sLeft / (NUM_STATICS - i);
        const d   = avg * (0.8 + rand() * 0.4);
        staticDurs.push(d); sLeft -= d;
    }
    staticDurs.push(sLeft);

    const elements = [];
    for (let i = 0; i < NUM_STATICS; i++) {
        elements.push({ type:'static', duration: staticDurs[i] });
        if (i < NUM_TEXTS) elements.push({ type:'text', textIndex: i, duration: textDurs[i] });
    }

    let cursor = ACT3_STATIC_1_END;
    elements.forEach(el => { el.start = cursor; el.end = cursor + el.duration; cursor += el.duration; });

    console.log('[Act 3] Sequence (texts≈' + textPool.toFixed(1) + 's statics≈' + staticPool.toFixed(1) + 's)');
    return elements;
}

// ═══════════════════════════════════════════════════════════════════
//  CSS STATIC OVERLAY
// ═══════════════════════════════════════════════════════════════════
function _setStaticOverlay(on) {
    const overlay = document.getElementById('full-screen-static-overlay');
    const vid     = document.getElementById('static-video');
    if (!overlay || !vid) return;
    if (on && !overlay.classList.contains('active')) {
        overlay.classList.add('active');
        if (vid.duration) vid.currentTime = Math.random() * vid.duration;
        vid.muted = true;
        vid.play().catch(() => {});
    } else if (!on && overlay.classList.contains('active')) {
        overlay.classList.remove('active');
        vid.pause();
    }
}

// ═══════════════════════════════════════════════════════════════════
//  AUDIO (YouTube — plays entire 90-s sequence including static)
// ═══════════════════════════════════════════════════════════════════
function _initAudio(seekTo) {
    if (_audioEl) {
        if (seekTo > 0) {
            _audioEl.currentTime = Math.min(seekTo, _audioEl.duration || 9999);
        }
        return;
    }
    const a   = new Audio();
    a.src     = _resolveAssetUrl(ACT3_AUDIO_URL);
    a.preload = 'auto';
    a.volume  = 0.85;
    if (seekTo > 0) {
        a.addEventListener('canplay', () => { a.currentTime = Math.min(seekTo, a.duration); }, { once: true });
    }
    a.load();
    _audioEl = a;
}
function _playAudio() {
    if (_audioEl && _audioEl.paused) {
        _audioEl.play().catch(e => {
            console.warn('[Act 3] Audio play:', e.message);
            const retry = () => {
                if (_audioEl && _audioEl.paused) {
                    _audioEl.play()
                        .then(() => console.log('[Act 3] Audio play resumed on interaction.'))
                        .catch(() => {});
                }
            };
            document.addEventListener('click',      retry, { once: true });
            document.addEventListener('touchstart', retry, { once: true });
            document.addEventListener('keydown',    retry, { once: true });
        });
    }
}
function _stopAudio() {
    if (!_audioEl) return;
    _audioEl.pause();
    _audioEl.currentTime = 0;
}
function _setAudioVolume(vol) {
    if (_audioEl) {
        _audioEl.volume = vol;
    }
}

// ═══════════════════════════════════════════════════════════════════
//  TV VIDEO — canvas-blended texture, sRGB, starts muted for
//  autoplay safety; unmutes once fade-in begins.
// ═══════════════════════════════════════════════════════════════════
function _initTV(seekTo) {
    // Always (re-)create if not done yet
    if (_videoEl) {
        // If already created, just seek if needed
        if (seekTo > 0 && _videoEl.readyState >= 1) {
            _videoEl.currentTime = Math.min(seekTo, _videoEl.duration || 9999);
        } else if (seekTo > 0) {
            _videoEl.addEventListener('canplay', () => {
                _videoEl.currentTime = Math.min(seekTo, _videoEl.duration || 9999);
            }, { once: true });
        }
        return;
    }

    window.creatingAct3Video = true;
    const v       = document.createElement('video');
    window.creatingAct3Video = false;
    v.dataset.isAct3Video = "true";
    v.src         = _resolveAssetUrl(ACT3_VIDEO_URL);
    v.crossOrigin = 'anonymous';
    v.muted       = true;
    v.volume      = 0.0;
    v.loop        = true;   // loop the video
    v.preload     = 'auto';
    v.playsInline = true;
    if (seekTo > 0) {
        v.addEventListener('canplay', () => {
            v.currentTime = Math.min(seekTo, v.duration || 9999);
        }, { once: true });
    }
    v.load();
    _videoEl = v;

    // Kick off the play early so it buffers (muted autoplay is always allowed)
    v.play().catch(() => {});

    if (typeof THREE !== 'undefined') {
        _blendTex = new THREE.VideoTexture(v);
        _blendTex.colorSpace = THREE.SRGBColorSpace;
        _blendTex.minFilter  = THREE.LinearFilter;
        _blendTex.generateMipmaps = false;
    }
    console.log('[Act 3] TV VideoTexture created successfully.');
}

function _updateTV(t) {
    if (t < ACT3_TV_FADE_START) return;
    if (!_videoEl || !_blendTex) return;

    if (!_tvStarted) {
        _tvStarted = true;
        _videoEl.play().catch(e => console.warn('[Act 3] TV play failed:', e.message));
        console.log('[Act 3] TV video play verified.');
    }

    if (_videoEl.paused) {
        _videoEl.play().catch(() => {});
    }

    window.act3TvTexture  = _blendTex;
}

// ═══════════════════════════════════════════════════════════════════
//  MORSE INTENSITY
// ═══════════════════════════════════════════════════════════════════
function _updateMorse(t) {
    if (!_morseEvents) { window.act3MorseIntensity = 0; return; }
    for (let i = 0; i < _morseEvents.length; i++) {
        const ev = _morseEvents[i];
        if (t >= ev.start && t < ev.end) { window.act3MorseIntensity = ev.on ? 3.5 : 0.0; return; }
    }
    window.act3MorseIntensity = 0.0;
}

// ═══════════════════════════════════════════════════════════════════
//  SEQUENCE UPDATE (text/static; audio plays through both)
// ═══════════════════════════════════════════════════════════════════
function _updateSequence(t) {
    if (!_sequence) return;
    let current = null;
    for (let i = 0; i < _sequence.length; i++) {
        if (t >= _sequence[i].start && t < _sequence[i].end) { current = _sequence[i]; break; }
    }
    if (!current) return;

    const tagEl = document.getElementById('static-tagline');
    if (current.type === 'static') {
        _setStaticOverlay(true);
        if (tagEl) tagEl.classList.remove('active');
        // audio keeps playing — no pause
    } else {
        _setStaticOverlay(false);
        if (tagEl && typeof formatTaglineText === 'function') {
            const texts = window.staticTexts;
            if (texts && current.textIndex !== _prevTextIdx) {
                tagEl.innerHTML = formatTaglineText(texts[current.textIndex]);
                _prevTextIdx = current.textIndex;
            }
            if (!tagEl.classList.contains('active')) tagEl.classList.add('active');
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  AUTO-RESET SERVER → 'default' once act3 finishes
// ═══════════════════════════════════════════════════════════════════
function _scheduleAutoReset(remainingSeconds) {
    if (_act3AutoResetTimer) clearTimeout(_act3AutoResetTimer);
    const ms = Math.max(0, remainingSeconds) * 1000 + 2000; // +2s buffer
    _act3AutoResetTimer = setTimeout(() => {
        console.log('[Act 3] Auto-reset: sending default preset to server.');
        fetch('/api/presets/active', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'H4NZC0D3X1521.a' },
            body: JSON.stringify({ presetId: 'default' })
        }).catch(e => console.warn('[Act 3] Auto-reset failed:', e.message));
    }, ms);
}

// ═══════════════════════════════════════════════════════════════════
//  CLEANUP
// ═══════════════════════════════════════════════════════════════════
function _act3Cleanup() {
    _stopAudio();
    if (_videoEl) { try { _videoEl.pause(); _videoEl.src = ''; } catch(e) {} _videoEl = null; }
    _blendTex = _blendCanvas = _blendCtx = null;
    _tvOpacity = 0; _tvStarted = false;
    window.act3TvTexture = null; window.act3TvBlack = false; window.act3TvStatic = false;
    _setStaticOverlay(false);
    const tagEl = document.getElementById('static-tagline');
    if (tagEl) tagEl.classList.remove('active');
    window.act3MorseIntensity = 0;
    window.act3Factor = 0; window.act3Target = 0;
    _prevTextIdx = -1; _morseEvents = _sequence = null;
    if (_act3AutoResetTimer) { clearTimeout(_act3AutoResetTimer); _act3AutoResetTimer = null; }

    // Restore taglines
    const tl1 = document.getElementById('tagline-distorsiona');
    const tl2 = document.getElementById('tagline-comienza');
    if (tl1 && tl1._act3Backup !== undefined) {
        if (tl1.innerText === '' && tl1._act3Backup) {
            tl1.innerText = tl1._act3Backup;
        }
        delete tl1._act3Backup;
    }
    if (tl2 && tl2._act3Backup !== undefined) {
        if (tl2.innerText === '' && tl2._act3Backup) {
            tl2.innerText = tl2._act3Backup;
        }
        delete tl2._act3Backup;
    }
}

// ═══════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════
window.setAct3 = function(active, elapsedSeconds, startEpoch) {
    const elapsed = elapsedSeconds || 0;
    console.log(`[Act 3] setAct3(${active}, elapsed=${elapsed.toFixed(1)}s)`);

    if (active) {
        if (window.act3Active) {
            // Already running — just re-sync elapsed if server sent a correction
            if (elapsed > 1) {
                window.act3Elapsed = elapsed;
                window.act3StartWallTime = Date.now() - elapsed * 1000;
            }
            return;
        }
        window.act3Active  = true;
        window.act3RestoredTime = null;
        window.act3Elapsed = elapsed;
        window.act3StartWallTime = Date.now() - elapsed * 1000;
        _prevTextIdx = -1; _tvOpacity = 0; _tvStarted = false;
        
        // BROADCASTING SYNC: pre-set factor to where it should be now
        if (elapsed < ACT3_BLACK_1_END) {
            window.act3Target = 0.0;
            window.act3Factor = 0.0;
        } else if (elapsed < ACT3_STATIC_1_END) {
            window.act3Target = 1.0;
            window.act3Factor = Math.min(1.0, (elapsed - ACT3_BLACK_1_END) / 3.0);
        } else if (elapsed < ACT3_SEQUENCE_END) {
            window.act3Target = 1.0;
            window.act3Factor = 1.0;
        } else if (elapsed < ACT3_STATIC_2_END) {
            window.act3Target = 0.0;
            window.act3Factor = Math.max(0.0, 1.0 - (elapsed - ACT3_SEQUENCE_END) / 3.0);
        } else {
            window.act3Target = 0.0;
            window.act3Factor = 0.0;
        }

        document.body.classList.add('act3-active');

        // Hide dynamic taglines — act3 has its own text flow
        const tl1 = document.getElementById('tagline-distorsiona');
        const tl2 = document.getElementById('tagline-comienza');
        if (tl1) { tl1._act3Backup = tl1.innerText; tl1.innerText = ''; }
        if (tl2) { tl2._act3Backup = tl2.innerText; tl2.innerText = ''; }

        _morseEvents = _buildMorse();
        _sequence    = _buildSequence(startEpoch);

        // Determine audio seek position (audio starts at Phase 1, t = 5s)
        const audioSeek = Math.max(0, elapsed - ACT3_BLACK_1_END);
        _initAudio(audioSeek < 105 ? audioSeek : 0);

        // Pre-init TV video element immediately so it buffers early
        // Seek video to where we'd be in the sequence if fade has started
        const videoSeek = elapsed > ACT3_TV_FADE_START ? (elapsed - ACT3_TV_FADE_START) : 0;
        _initTV(videoSeek);

        if (typeof window.setAct1 === 'function') window.setAct1(false);
        if (typeof window.setAct2 === 'function') window.setAct2(false);
        if (typeof isStaticActive !== 'undefined') isStaticActive = false;

        // Schedule auto-reset when sequence should have ended
        const remaining = ACT3_BLACK_2_END - elapsed;
        if (remaining > 0) _scheduleAutoReset(remaining);

    } else {
        window.act3Active = false;
        window.act3RestoredTime = Date.now();
        document.body.classList.remove('act3-active');
        _act3Cleanup();
    }
};

// ═══════════════════════════════════════════════════════════════════
//  PER-FRAME UPDATE
// ═══════════════════════════════════════════════════════════════════
window.updateAct3 = function(nowSec, deltaTime) {
    if (!window.act3Active) return;

    if (window.act3StartWallTime) {
        window.act3Elapsed = (Date.now() - window.act3StartWallTime) / 1000;
    } else {
        window.act3Elapsed += deltaTime;
    }
    const t = window.act3Elapsed;

    // Environment factor lerp (always running)
    const ENV_SPEED = 1.0 / 3.0;
    if (window.act3Factor < window.act3Target)
        window.act3Factor = Math.min(1.0, window.act3Factor + deltaTime * ENV_SPEED);
    else if (window.act3Factor > window.act3Target)
        window.act3Factor = Math.max(0.0, window.act3Factor - deltaTime * ENV_SPEED);

    // ── Phase 0: Black on TV (0–5 s) ─────────────────────────────
    if (t < ACT3_BLACK_1_END) {
        window.act3TvBlack = true; window.act3TvStatic = false; window.act3TvTexture = null;
        _setStaticOverlay(false);
        window.act3Target = 0.0;
        window.act3MorseIntensity = 0;
        return;
    }

    // ── Phase 1: Static on TV (5–10 s) — Total Silence & Background dark/fog transition ────
    if (t < ACT3_STATIC_1_END) {
        window.act3TvBlack = false; window.act3TvStatic = true; window.act3TvTexture = null;
        _setStaticOverlay(true);
        window.act3Target = 1.0;
        window.act3MorseIntensity = 0;
        _setAudioVolume(0.0);
        _playAudio(); // plays in background (muted) to retain perfect sync
        return;
    }

    // ── Phase 2: Main sequence (10–100 s) — Audio unmuted ────────
    if (t < ACT3_SEQUENCE_END) {
        window.act3Target = 1.0;

        // TV: black until fade starts, then canvas video texture
        if (t < ACT3_TV_FADE_START) {
            window.act3TvBlack = true; window.act3TvStatic = false; window.act3TvTexture = null;
        } else {
            window.act3TvBlack = false; window.act3TvStatic = false;
            _updateTV(t);
        }

        _updateMorse(t);
        _setAudioVolume(0.85); // Restore transmission audio volume
        _playAudio();
        _updateSequence(t);
        return;
    }

    // ── Phase 3: Eternal static (100–110 s) — Total Silence & Return to default background ────
    if (t < ACT3_STATIC_2_END) {
        window.act3TvBlack = false; window.act3TvStatic = true; window.act3TvTexture = null;
        _setStaticOverlay(true);
        const tagEl = document.getElementById('static-tagline');
        if (tagEl) tagEl.classList.remove('active');
        window.act3MorseIntensity = 0;
        window.act3Target = 0.0;
        _setAudioVolume(0.0); // Muted for final static silence
        _playAudio();
        return;
    }

    // ── Phase 4: Black on TV / PowerOff (110 s+) ─────────────────
    window.act3TvBlack = true; window.act3TvStatic = false; window.act3TvTexture = null;
    _setStaticOverlay(false);
    window.act3Target = 0.0;
    window.act3MorseIntensity = 0;
    _stopAudio();
};
