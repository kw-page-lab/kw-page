// ═══════════════════════════════════════════════════════════════════
//  ACT 2 — Grass Growth Scene + Fireflies
//  Triggered by Shift+A hotkey (or window.setAct2(true) via WS)
//  Grass grows from below water level — white/gray palette.
//  Fireflies blink and drift above the surface.
// ═══════════════════════════════════════════════════════════════════

window.act2Factor       = 0.0;
window.act2Target       = 0.0;
window.act2GrassState   = 'idle';   // 'idle', 'growing', 'plateau', 'shrinking'
window.act2GrassAge     = 0.0;      // 0 → 1 progress of growth
window.act2PlateauTimer = 0.0;

const ACT2_GRASS_COUNT    = 5000;
const ACT2_SPREAD         = 38;     // world-space half-size of field
const ACT2_WATER_Y        = -2.0;   // must match floor.js liquidFloorReal.position.y
const ACT2_GRASS_TARGET_Y = ACT2_WATER_Y + 0.05; // blade roots just above water
const ACT2_GROW_DURATION  = 6.0;   // seconds for full growth
const ACT2_BLADE_H        = 1.4;   // blade height in local space

let act2GrassMesh      = null;
let act2FirefliesMesh  = null;
let act2FireflyData    = [];
let act2Initialized    = false;
let act2LastGrowTime   = null;

// ─── Public API ──────────────────────────────────────────────────────────────

window.setAct2 = function(active, elapsedSeconds = 0) {
    if (active) {
        window.act2Target = 1.0;
        document.body.classList.add('act2-active');
        if (!act2Initialized) _act2Init();
        
        window.act2GrassState = 'growing';
        if (elapsedSeconds > 0) {
            window.act2GrassAge = Math.min(1.0, elapsedSeconds / ACT2_GROW_DURATION);
            window.act2Factor = Math.min(1.0, elapsedSeconds / 1.8); // 1.8s environment lerp speed
            if (window.act2GrassAge >= 1.0) {
                window.act2GrassState = 'plateau';
            }
        } else {
            if (window.act2GrassAge <= 0.001) {
                window.act2GrassAge = 0.0;
            }
        }
        act2LastGrowTime = performance.now();

        if (act2GrassMesh)     act2GrassMesh.visible     = true;
        if (act2FirefliesMesh) act2FirefliesMesh.visible  = true;
    } else {
        if (window.act2GrassState !== 'idle') {
            window.act2GrassState = 'shrinking';
            act2LastGrowTime = performance.now();
            window.act2Target = 0.0;
            document.body.classList.remove('act2-active');
        } else {
            window.act2Target = 0.0;
            document.body.classList.remove('act2-active');
            if (act2GrassMesh)     act2GrassMesh.visible     = false;
            if (act2FirefliesMesh) act2FirefliesMesh.visible  = false;
        }
    }
    console.log(`[Act 2] State set to: ${active} (elapsed: ${elapsedSeconds}s, target: ${window.act2Target}, state: ${window.act2GrassState})`);
};

// ─── Init ─────────────────────────────────────────────────────────────────────

function _act2Init() {
    if (act2Initialized) return;
    // scene is declared with `let` in config.js — typeof is never 'undefined',
    // but the value can be null/falsy before initScene() runs.
    if (!scene) {
        console.warn('[Act 2] scene not ready yet, retrying in 500ms...');
        setTimeout(_act2Init, 500);
        return;
    }
    act2Initialized = true;
    console.log('[Act 2] Initializing grass + fireflies on scene:', scene.uuid);
    _act2CreateGrass();
    _act2CreateFireflies();
}

// ─── Grass ───────────────────────────────────────────────────────────────────

function _act2CreateGrass() {
    // Thin plane, 8 vertical segments for smooth wind curve
    const bladeGeo = new THREE.PlaneGeometry(0.07, ACT2_BLADE_H, 1, 8);
    bladeGeo.translate(0, ACT2_BLADE_H * 0.5, 0); // pivot at base

    const grassMat = new THREE.ShaderMaterial({
        vertexShader: `
            // ── Per-instance attributes ──────────────────────────────────
            attribute float phase;   // wind phase offset
            attribute float amp;     // wind amplitude multiplier
            attribute float hue;     // brightness variation seed

            // ── Uniforms ─────────────────────────────────────────────────
            uniform float time;
            uniform float windStr;
            uniform float growProgress; // 0 = flat, 1 = full height

            // ── Varyings ─────────────────────────────────────────────────
            varying float vH;     // 0 (base) → 1 (tip)
            varying float vHue;
            varying vec3 vWorld;   // world space position for fog

            void main() {
                vHue = hue;

                float bladeH = ${ACT2_BLADE_H.toFixed(2)};

                // Scale blade height by grow progress
                vec3 pos = position;
                pos.y *= growProgress;

                // Height ratio after scaling (avoid divide by zero)
                vH = (bladeH > 0.001) ? clamp(pos.y / bladeH, 0.0, 1.0) : 0.0;

                // Wind sway — squared falloff so base stays grounded
                float hp2 = vH * vH;
                pos.x += sin(time * 1.4 + phase) * windStr * hp2 * amp;
                pos.z += cos(time * 1.1 + phase * 0.7) * windStr * 0.28 * hp2 * amp;

                // KEY FIX: apply the per-instance world transform.
                // Three.js ShaderMaterial does NOT auto-apply instanceMatrix —
                // modelViewMatrix only contains the mesh-level transform.
                vec4 worldPos = instanceMatrix * vec4(pos, 1.0);
                vWorld        = worldPos.xyz;
                gl_Position   = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            varying float vH;
            varying float vHue;
            varying vec3 vWorld;

            uniform vec3 uFogColor;
            uniform float uFogNear;
            uniform float uFogFar;

            void main() {
                // White/gray palette: dark gray at base → bright white at tip
                float brightness = mix(0.16 + vHue * 0.10, 0.92 + vHue * 0.06, vH);
                vec3 col = vec3(brightness);
                // Very subtle cool-white tint at tips
                col.b += vH * 0.04;

                // Depth Fog calculation
                float depth = length(cameraPosition - vWorld);
                float fogFactor = clamp((depth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
                col = mix(col, uFogColor, fogFactor);

                gl_FragColor = vec4(col, 1.0);
            }
        `,
        uniforms: {
            time:         { value: 0.0 },
            windStr:      { value: 0.18 },
            growProgress: { value: 0.0 },
            uFogColor:    { value: new THREE.Color(0x010204) },
            uFogNear:     { value: 11.0 },
            uFogFar:      { value: 30.0 }
        },
        side:        THREE.DoubleSide,
        transparent: false
    });

    act2GrassMesh = new THREE.InstancedMesh(bladeGeo, grassMat, ACT2_GRASS_COUNT);
    act2GrassMesh.visible       = false;
    act2GrassMesh.frustumCulled = false; // base-geo bbox would cull it at origin

    const phases = new Float32Array(ACT2_GRASS_COUNT);
    const amps   = new Float32Array(ACT2_GRASS_COUNT);
    const hues   = new Float32Array(ACT2_GRASS_COUNT);
    const dummy  = new THREE.Object3D();

    for (let i = 0; i < ACT2_GRASS_COUNT; i++) {
        const r     = Math.sqrt(Math.random()) * ACT2_SPREAD;
        const theta = Math.random() * Math.PI * 2;
        dummy.position.set(
            Math.cos(theta) * r,
            ACT2_GRASS_TARGET_Y,
            Math.sin(theta) * r
        );
        dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
        dummy.scale.setScalar(0.7 + Math.random() * 0.6);
        dummy.updateMatrix();
        act2GrassMesh.setMatrixAt(i, dummy.matrix);

        phases[i] = Math.random() * Math.PI * 2;
        amps[i]   = 0.5 + Math.random() * 0.5;
        hues[i]   = Math.random();
    }
    act2GrassMesh.instanceMatrix.needsUpdate = true;

    bladeGeo.setAttribute('phase', new THREE.InstancedBufferAttribute(phases, 1));
    bladeGeo.setAttribute('amp',   new THREE.InstancedBufferAttribute(amps,   1));
    bladeGeo.setAttribute('hue',   new THREE.InstancedBufferAttribute(hues,   1));

    scene.add(act2GrassMesh);
    window.act2GrassMesh = act2GrassMesh;
    console.log('[Act 2] Grass field created —', ACT2_GRASS_COUNT, 'blades at y =', ACT2_GRASS_TARGET_Y);
}

// ─── Fireflies ────────────────────────────────────────────────────────────────

function _act2CreateFireflies() {
    const COUNT     = 70;
    const geo       = new THREE.BufferGeometry();
    const positions = new Float32Array(COUNT * 3);

    act2FireflyData = [];
    for (let i = 0; i < COUNT; i++) {
        const r     = Math.sqrt(Math.random()) * 16;
        const theta = Math.random() * Math.PI * 2;
        const x     = Math.cos(theta) * r;
        const z     = Math.sin(theta) * r;
        const y     = ACT2_WATER_Y + 0.3 + Math.random() * 2.5;

        positions[i * 3]     = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        act2FireflyData.push({
            baseX: x, baseY: y, baseZ: z,
            phase:      Math.random() * Math.PI * 2,
            driftX:     (Math.random() - 0.5) * 0.6,
            driftZ:     (Math.random() - 0.5) * 0.6,
            blinkPhase: Math.random() * Math.PI * 2,
            blinkSpeed: 0.8 + Math.random() * 1.4,
        });
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
        color:           0xeeffcc,  // brighter yellow-green-white
        size:            0.28,
        transparent:     true,
        opacity:         0.0,       // driven by act2Factor
        sizeAttenuation: true,
        depthWrite:      false,
        blending:        THREE.AdditiveBlending
    });

    act2FirefliesMesh = new THREE.Points(geo, mat);
    act2FirefliesMesh.visible = false;
    scene.add(act2FirefliesMesh);
    window.act2FirefliesMesh = act2FirefliesMesh;
    console.log('[Act 2] Fireflies created —', COUNT, 'particles');
}

// ─── Per-frame update (called from animate.js) ───────────────────────────────

window.updateAct2 = function(nowSec, deltaTime) {
    // ── Smooth factor lerp ──
    const a2SpeedGrow = 1.0 / 1.8;
    const a2SpeedFadeOut = 1.0 / 8.0;
    if (window.act2Factor < window.act2Target) {
        window.act2Factor = Math.min(window.act2Target, window.act2Factor + deltaTime * a2SpeedGrow);
    } else if (window.act2Factor > window.act2Target) {
        window.act2Factor = Math.max(window.act2Target, window.act2Factor - deltaTime * a2SpeedFadeOut);
    }

    // ── Grass state machine update ──
    const ACT2_PLATEAU_DURATION = 8.0; // stay full height for 8 seconds
    const ACT2_SHRINK_DURATION  = 3.5; // shrink back down in 3.5 seconds

    if (window.act2GrassState !== 'idle') {
        const now = performance.now();
        const elapsed = (act2LastGrowTime !== null) ? (now - act2LastGrowTime) * 0.001 : 0;
        act2LastGrowTime = now;

        if (window.act2GrassState === 'growing') {
            window.act2GrassAge = Math.min(1.0, window.act2GrassAge + elapsed / ACT2_GROW_DURATION);
            if (window.act2GrassAge >= 1.0) {
                window.act2GrassState = 'plateau';
                window.act2PlateauTimer = 0.0;
            }
        } else if (window.act2GrassState === 'plateau') {
            // Stay in plateau phase indefinitely until setAct2(false) is called via WS/externally
        } else if (window.act2GrassState === 'shrinking') {
            window.act2GrassAge = Math.max(0.0, window.act2GrassAge - elapsed / ACT2_SHRINK_DURATION);
            if (window.act2GrassAge <= 0.0) {
                window.act2GrassState = 'idle';
            }
        }
    }

    // Hide meshes only when fully idle and factor is completely 0
    if (window.act2GrassState === 'idle' && window.act2Factor <= 0.001) {
        if (act2GrassMesh)     act2GrassMesh.visible     = false;
        if (act2FirefliesMesh) act2FirefliesMesh.visible  = false;
        return;
    }

    // Ensure meshes are visible when updating if not idle
    if (act2GrassMesh)     act2GrassMesh.visible     = true;
    if (act2FirefliesMesh) act2FirefliesMesh.visible  = true;

    // ── Grass shader uniform update ──
    if (act2GrassMesh && act2GrassMesh.material && act2GrassMesh.material.uniforms) {
        const u = act2GrassMesh.material.uniforms;
        u.time.value         = nowSec;
        u.growProgress.value = window.act2GrassAge;
    }

    // ── Firefly drift + blink ──
    if (act2FirefliesMesh && act2FireflyData.length > 0) {
        act2FirefliesMesh.material.opacity = window.act2Factor * 0.9;
        const pos = act2FirefliesMesh.geometry.attributes.position;

        for (let i = 0; i < act2FireflyData.length; i++) {
            const f = act2FireflyData[i];
            const t = nowSec * 0.25 + f.phase;
            pos.setX(i, f.baseX + Math.cos(t) * f.driftX * 3.5);
            pos.setY(i, f.baseY + Math.sin(nowSec * 0.3 + f.phase) * 0.4);
            pos.setZ(i, f.baseZ + Math.sin(t) * f.driftZ * 3.5);
        }
        pos.needsUpdate = true;

        // Global size flicker for a breathing "blink" feel
        const blink = 0.28 + 0.15 * Math.abs(Math.sin(nowSec * 1.6 + 0.3));
        act2FirefliesMesh.material.size = blink;
    }
};

// ─── Shift+A hotkey ──────────────────────────────────────────────────────────

window.addEventListener('keydown', function(e) {
    if (e.shiftKey && e.code === 'KeyA') {
        const next = !document.body.classList.contains('act2-active');
        console.log(`[Act 2] Shift+A — toggling ACT2: ${next}`);
        window.setAct2(next);
    }
});
