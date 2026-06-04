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
    const ambInt = k1.ambInt + (k2.ambInt - k1.ambInt) * t;
    const keyInt = k1.keyInt + (k2.keyInt - k1.keyInt) * t;
    const emissiveRed = k1.emissiveRed + (k2.emissiveRed - k1.emissiveRed) * t;
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
    }

    // Apply to emissive red blocks (both standard and lambert)
    if (standardRed) standardRed.emissiveIntensity = emissiveRed;
    if (lambertRed) lambertRed.emissiveIntensity = emissiveRed;

    // Apply to liquid floor uniforms
    if (liquidFloorMat && liquidFloorMat.uniforms) {
        if (liquidFloorMat.uniforms.uColor) liquidFloorMat.uniforms.uColor.value.copy(waterColCached);
        if (liquidFloorMat.uniforms.uFogColor) liquidFloorMat.uniforms.uFogColor.value.copy(bgColCached);
        if (liquidFloorMat.uniforms.uFogNear) liquidFloorMat.uniforms.uFogNear.value = dynamicFogNear;
        if (liquidFloorMat.uniforms.uFogFar) liquidFloorMat.uniforms.uFogFar.value = dynamicFogFar;
    }

    // Apply to atmospheric clouds
    if (clouds.length > 0 && clouds[0].material && clouds[0].material.uniforms && clouds[0].material.uniforms.uColor) {
        clouds[0].material.uniforms.uColor.value.copy(cloudColCached);
    }

    // Apply to background particles
    if (starField && starField.material) {
        starField.material.opacity = starOpacity;
        starField.visible = (starOpacity > 0.0 && params.particles);
    }

    // Sync document root background CSS so UI panel blends nicely
    const hexColor = '#' + bgColCached.getHexString();
    document.documentElement.style.setProperty('--bg-color', hexColor);
}
