// --- TIME OF DAY (ENVIRONMENT REACTION) ---
const timeKeys = [
    { hour: 0,  bg: new THREE.Color(0x050608), fogNear: 15.0, fogFar: 30.0, amb: new THREE.Color(0x050506), ambInt: 0.05, key: new THREE.Color(0x08090c), keyInt: 0.0, emissiveRed: 1.4, waterColor: new THREE.Color(0x030406), starOpacity: 0.8, cloudColor: new THREE.Color(0x06070a) },
    { hour: 6,  bg: new THREE.Color(0x2d343f), fogNear: 14.0, fogFar: 28.0, amb: new THREE.Color(0x1b1f26), ambInt: 0.35, key: new THREE.Color(0xa15215), keyInt: 0.8, emissiveRed: 0.7, waterColor: new THREE.Color(0x090c10), starOpacity: 0.0, cloudColor: new THREE.Color(0x12151c) },
    { hour: 12, bg: new THREE.Color(0x525862), fogNear: 12.0, fogFar: 24.0, amb: new THREE.Color(0x373b42), ambInt: 0.70, key: new THREE.Color(0xc5c7cb), keyInt: 2.0, emissiveRed: 0.3, waterColor: new THREE.Color(0x0a0c10), starOpacity: 0.0, cloudColor: new THREE.Color(0x24282e) },
    { hour: 18, bg: new THREE.Color(0x261919), fogNear: 14.0, fogFar: 28.0, amb: new THREE.Color(0x1a1111), ambInt: 0.45, key: new THREE.Color(0x881b1b), keyInt: 1.0, emissiveRed: 1.0, waterColor: new THREE.Color(0x0c0808), starOpacity: 0.0, cloudColor: new THREE.Color(0x140d0d) },
    { hour: 24, bg: new THREE.Color(0x050608), fogNear: 15.0, fogFar: 30.0, amb: new THREE.Color(0x050506), ambInt: 0.05, key: new THREE.Color(0x08090c), keyInt: 0.0, emissiveRed: 1.4, waterColor: new THREE.Color(0x030406), starOpacity: 0.8, cloudColor: new THREE.Color(0x06070a) }
];

function updateEnvironmentFromTime() {
    let h = params.timeOfDay;
    if (params.autoTime) {
        const now = new Date();
        h = now.getHours() + now.getMinutes() / 60.0 + now.getSeconds() / 3600.0;
        params.timeOfDay = h;
        
        // Sync UI elements
        const timeEl = document.getElementById('timeOfDay');
        if (timeEl) timeEl.value = h.toFixed(1);
        
        const hrs = Math.floor(h);
        const mins = Math.floor((h - hrs) * 60);
        const valEl = document.getElementById('timeOfDayVal');
        if (valEl) {
            valEl.innerText = (hrs < 10 ? '0' + hrs : hrs) + ':' + (mins < 10 ? '0' + mins : mins);
        }
    }

    // Interpolate keyframes
    let k1 = timeKeys[0], k2 = timeKeys[1];
    for (let i = 0; i < timeKeys.length - 1; i++) {
        if (h >= timeKeys[i].hour && h <= timeKeys[i+1].hour) {
            k1 = timeKeys[i];
            k2 = timeKeys[i+1];
            break;
        }
    }

    const t = (h - k1.hour) / (k2.hour - k1.hour);

    // Interpolate colors using cached variables to fully prevent heap allocations
    bgColCached.copy(k1.bg).lerp(k2.bg, t);
    ambColCached.copy(k1.amb).lerp(k2.amb, t);
    keyColCached.copy(k1.key).lerp(k2.key, t);
    waterColCached.copy(k1.waterColor).lerp(k2.waterColor, t);
    cloudColCached.copy(k1.cloudColor).lerp(k2.cloudColor, t);

    // Interpolate floats
    const baseFogNear = k1.fogNear + (k2.fogNear - k1.fogNear) * t;
    const baseFogFar = k1.fogFar + (k2.fogFar - k1.fogFar) * t;
    let ambInt = k1.ambInt + (k2.ambInt - k1.ambInt) * t;
    const keyInt = k1.keyInt + (k2.keyInt - k1.keyInt) * t;
    let emissiveRed = k1.emissiveRed + (k2.emissiveRed - k1.emissiveRed) * t;
    const starOpacity = k1.starOpacity + (k2.starOpacity - k1.starOpacity) * t;

    // Zoom-dependent dynamic fog calculations
    let dynamicFogNear = baseFogNear;
    let dynamicFogFar = baseFogFar;
    if (camera && controls) {
        const cameraDist = camera.position.distanceTo(controls.target);
        const dD = cameraDist - 8.0;
        
        // Scale near distance
        dynamicFogNear = Math.max(0.5, baseFogNear + dD * 0.5);
        
        if (dD >= 0) {
            // Zooming out: interpolate baseFogFar towards 35.0 (so at max zoom out (25.0), far is 35.0).
            // This keeps the monolith visible but moody and pushes fog further in the distance.
            const tZoom = dD / 17.0; // 0.0 at D=8.0, 1.0 at D=25.0
            dynamicFogFar = baseFogFar + (35.0 - baseFogFar) * tZoom;
        } else {
            // Zooming in: scale down
            dynamicFogFar = baseFogFar + dD * 0.75;
        }
    }

    // --- ACT2 FACTOR (driven entirely by act2.js) ---
    if (typeof window.act2Factor === 'undefined') {
        window.act2Factor = 0.0;
    }

    // --- LERP ACT1 STATE OVERRIDES ---
    if (typeof window.act1Factor !== 'undefined' && window.act1Factor > 0.0) {
        // 1. Darken background and fog colors towards near pitch black
        const act1BgColor = new THREE.Color(0x010203);
        bgColCached.lerp(act1BgColor, window.act1Factor);

        // 2. Pull fog close and dense, but keep letters visible (tuned to be less aggressive)
        const targetFogNear = isTVFocused ? 7.5 : 9.5;
        const targetFogFar = isTVFocused ? 18.0 : 25.0;
        dynamicFogNear = THREE.MathUtils.lerp(dynamicFogNear, targetFogNear, window.act1Factor);
        dynamicFogFar = THREE.MathUtils.lerp(dynamicFogFar, targetFogFar, window.act1Factor);

        // 3. Ambient light goes near zero (0.01) or pure zero (0.0 when focused on TV)
        const targetAmbInt = isTVFocused ? 0.0 : 0.01;
        ambInt = THREE.MathUtils.lerp(ambInt, targetAmbInt, window.act1Factor);

        // 4. Emissive red blocks are dimmed
        const targetRedEmissive = 0.08;
        emissiveRed = THREE.MathUtils.lerp(emissiveRed, targetRedEmissive, window.act1Factor);

        // 5. Update close-up traversing mist shader opacity factor
        if (window.act1MistMaterial && window.act1MistMaterial.uniforms) {
            window.act1MistMaterial.uniforms.uOpacityFactor.value = window.act1Factor;
        }
    } else {
        // Reset mist opacity when Act 1 is inactive (Act 2 may still activate it below)
        if (window.act1MistMaterial && window.act1MistMaterial.uniforms && !(typeof window.act2Factor !== 'undefined' && window.act2Factor > 0.0)) {
            window.act1MistMaterial.uniforms.uOpacityFactor.value = 0.0;
        }
    }

    // --- LERP ACT2 STATE OVERRIDES ---
    if (typeof window.act2Factor !== 'undefined' && window.act2Factor > 0.001) {
        const f = window.act2Factor;

        // 1. Near-black background — much darker than default
        bgColCached.lerp(new THREE.Color(0x000102), f);

        // 2. Fog: very tight and dense — you can clearly see it
        dynamicFogNear = THREE.MathUtils.lerp(dynamicFogNear, 4.0,  f);
        dynamicFogFar  = THREE.MathUtils.lerp(dynamicFogFar,  15.0, f);

        // 3. Ambient almost zero — but not pitch black (eerie residual glow)
        ambInt = THREE.MathUtils.lerp(ambInt, 0.02, f);

        // 4. Red emissive blocks heavily attenuated
        emissiveRed = THREE.MathUtils.lerp(emissiveRed, 0.06, f);

        // 5. Mist shader — share act1MistMaterial
        // Use f (act2Factor) directly — only preserve act1Factor if it's higher.
        // DO NOT use Math.max(current, f): that locks the value at 1.0 as f decreases,
        // causing an instant snap to 0 when the block stops executing.
        if (window.act1MistMaterial && window.act1MistMaterial.uniforms) {
            const act1Opacity = (typeof window.act1Factor !== 'undefined') ? window.act1Factor : 0.0;
            window.act1MistMaterial.uniforms.uOpacityFactor.value = Math.max(act1Opacity, f);
        }
    }

    // Apply to scene background and fog
    if (scene) {
        if (scene.background) scene.background.copy(bgColCached);
        if (scene.fog) {
            scene.fog.color.copy(bgColCached);
            scene.fog.near = dynamicFogNear;
            scene.fog.far = dynamicFogFar;
        }
    }

    // Apply to ambient light
    if (ambientLight) {
        ambientLight.color.copy(ambColCached);
        ambientLight.intensity = ambInt;
    }

    // Apply to main key light (acting as the Sun, rising and setting in an arc)
    if (dirLight) {
        dirLight.color.copy(keyColCached);
        // Calculate sun position in sky based on hour of the day (h)
        // 6.0: Sunrise (East/Right), 12.0: Peak (Above), 18.0: Sunset (West/Left)
        const sunAngle = ((h - 6.0) / 12.0) * Math.PI; // 0 at sunrise, PI at sunset
        
        // If it's night (before 6am or after 6pm), the sun is below the horizon
        if (h < 6.0 || h > 18.0) {
            dirLight.position.set(0, -5.0, 5.0);
            dirLight.intensity = 0.0;
        } else {
            const sunX = -Math.cos(sunAngle) * 12.0; // moves left to right
            const sunY = Math.sin(sunAngle) * 8.0;   // rises and falls
            const sunZ = 6.0;                        // light slightly angled forward
            dirLight.position.set(sunX, sunY, sunZ);
            
            // Scale intensity by sun height (brightest at noon)
            const elevationFactor = Math.sin(sunAngle); // 0 at horizon, 1 at noon
            dirLight.intensity = keyInt * elevationFactor;
        }

        // Lerp key light to 0 for ACT1, and to 40% for ACT2 (semi-dim, not off)
        if (typeof window.act1Factor !== 'undefined' && window.act1Factor > 0.0) {
            dirLight.intensity = THREE.MathUtils.lerp(dirLight.intensity, 0.0, window.act1Factor);
        } else if (typeof window.act2Factor !== 'undefined' && window.act2Factor > 0.0) {
            dirLight.intensity = THREE.MathUtils.lerp(dirLight.intensity, dirLight.intensity * 0.4, window.act2Factor);
        }
    }

    // Apply to emissive red blocks (both standard and lambert)
    if (standardRed) standardRed.emissiveIntensity = emissiveRed;
    if (lambertRed) lambertRed.emissiveIntensity = emissiveRed;

    // Apply to TV spotlight — ACT1 kills it, ACT2 widens it (angle) and boosts slightly
    if (window.tvSpotlight) {
        if (typeof window.act1Factor !== 'undefined' && window.act1Factor > 0.0) {
            window.tvSpotlight.intensity = THREE.MathUtils.lerp(65.0, 0.0, window.act1Factor);
        } else if (typeof window.act2Factor !== 'undefined' && window.act2Factor > 0.0) {
            // Keep intensity but open the cone angle wider
            window.tvSpotlight.intensity = THREE.MathUtils.lerp(65.0, 90.0, window.act2Factor);
            if (window.tvSpotlight.angle !== undefined) {
                window.tvSpotlight.angle = THREE.MathUtils.lerp(
                    Math.PI / 6,        // default ~30°
                    Math.PI / 3.2,      // ACT2 wider ~56°
                    window.act2Factor
                );
            }
        } else {
            // Reset cone angle when neither act is active
            if (window.tvSpotlight.angle !== undefined) {
                window.tvSpotlight.angle = THREE.MathUtils.lerp(window.tvSpotlight.angle, Math.PI / 6, 0.05);
            }
        }
    }

    // Apply to liquid floor uniforms
    if (liquidFloorMat && liquidFloorMat.uniforms) {
        if (liquidFloorMat.uniforms.uColor) liquidFloorMat.uniforms.uColor.value.copy(waterColCached);
        if (liquidFloorMat.uniforms.uFogColor) liquidFloorMat.uniforms.uFogColor.value.copy(bgColCached);
        if (liquidFloorMat.uniforms.uFogNear) liquidFloorMat.uniforms.uFogNear.value = dynamicFogNear;
        if (liquidFloorMat.uniforms.uFogFar) liquidFloorMat.uniforms.uFogFar.value = dynamicFogFar;
    }

    // Apply to grass uniforms
    if (window.act2GrassMesh && window.act2GrassMesh.material && window.act2GrassMesh.material.uniforms) {
        const gu = window.act2GrassMesh.material.uniforms;
        if (gu.uFogColor) gu.uFogColor.value.copy(bgColCached);
        if (gu.uFogNear) gu.uFogNear.value = dynamicFogNear;
        if (gu.uFogFar) gu.uFogFar.value = dynamicFogFar;
    }

    // Apply to atmospheric clouds
    if (clouds.length > 0 && clouds[0].material && clouds[0].material.uniforms && clouds[0].material.uniforms.uColor) {
        clouds[0].material.uniforms.uColor.value.copy(cloudColCached);
    }

    // Apply to background particles
    if (starField && starField.material) {
        let currentStarOpacity = starOpacity;
        if (typeof window.act1Factor !== 'undefined' && window.act1Factor > 0.0) {
            // ACT1: fade out completely
            currentStarOpacity = THREE.MathUtils.lerp(starOpacity, 0.0, window.act1Factor);
        } else if (typeof window.act2Factor !== 'undefined' && window.act2Factor > 0.0) {
            // ACT2: reduce to ~25% of normal (sparse, eerie)
            currentStarOpacity = THREE.MathUtils.lerp(starOpacity, starOpacity * 0.25, window.act2Factor);
        }
        starField.material.opacity = currentStarOpacity;
        starField.visible = (currentStarOpacity > 0.0 && params.particles);
    }

    // Sync document root background CSS so UI panel blends nicely
    const hexColor = '#' + bgColCached.getHexString();
    document.documentElement.style.setProperty('--bg-color', hexColor);

    // Call updateInteriorLights to sync white letters and interior point lights
    if (typeof updateInteriorLights === 'function') {
        updateInteriorLights();
    }
}
