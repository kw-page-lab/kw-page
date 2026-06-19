// Create point lights residing in the interior of the monolith (inside cuboidGroup)
function createInteriorLights() {
    if (!cuboidGroup) return;

    // Remove any existing interior lights first
    interiorLights.forEach(light => cuboidGroup.remove(light));
    interiorLights = [];

    // Add three point lights inside the monolith along its vertical axis
    // This shines light outwards through the gaps of the letters/blocks
    const intensity = params.interiorLight ? 3.5 : 0.0;
    const distance = 8.0;

    const light1 = new THREE.PointLight(0xffffff, intensity, distance);
    light1.position.set(0, 1.3, 0);
    cuboidGroup.add(light1);
    interiorLights.push(light1);

    const light2 = new THREE.PointLight(0xffffff, intensity, distance);
    light2.position.set(0, 0, 0);
    cuboidGroup.add(light2);
    interiorLights.push(light2);

    const light3 = new THREE.PointLight(0xffffff, intensity, distance);
    light3.position.set(0, -1.3, 0);
    cuboidGroup.add(light3);
    interiorLights.push(light3);
}

// Dynamically update intensity of interior lights and white letter emissive values
function updateInteriorLights() {
    const baseIntensity = params.interiorLight ? 3.5 : 0.0;
    let intensity = baseIntensity;
    if (typeof window.act3Factor !== 'undefined' && window.act3Factor > 0.0) {
        // ACT3: interior lights fully off — only Morse letter flashes break the dark
        intensity = THREE.MathUtils.lerp(baseIntensity, 0.0, window.act3Factor);
    } else if (typeof window.act1Factor !== 'undefined' && window.act1Factor > 0.0) {
        // ACT1: lights go fully off
        intensity = THREE.MathUtils.lerp(baseIntensity, 0.0, window.act1Factor);
    } else if (typeof window.act2Factor !== 'undefined' && window.act2Factor > 0.0) {
        // ACT2: lights dim to ~30% of normal (eerie residual glow)
        intensity = THREE.MathUtils.lerp(baseIntensity, baseIntensity * 0.3, window.act2Factor);
    }
        
    interiorLights.forEach(light => {
        light.intensity = intensity;
    });

    // Adjust emissive intensity for white letters to glow when interior lights are on
    const baseWhiteEmissive = params.interiorLight ? 0.65 : 0.0;
    
    let whiteEmissive = baseWhiteEmissive;
    if (typeof window.act3Factor !== 'undefined' && window.act3Factor > 0.0) {
        // ACT3: white letters driven ONLY by Morse code intensity (0 = off, high = on)
        // Lerp from normal to zero as act3 fades in, then morse overrides
        const morseIntensity = window.act3MorseIntensity || 0.0;
        whiteEmissive = THREE.MathUtils.lerp(baseWhiteEmissive, morseIntensity, window.act3Factor);
    } else if (typeof window.act1Factor !== 'undefined' && window.act1Factor > 0.0) {
        const time = performance.now() * 0.001;
        
        // High frequency electrical jitter
        const jitter = Math.sin(time * 82.0) * Math.cos(time * 47.0);
        
        // Low frequency power fluctuation
        const wave = Math.sin(time * 6.5) * Math.sin(time * 2.1);
        
        let faultFactor = 0.0;
        if (wave > 0.25) {
            // Active sparking phase (turning on but in a glitchy, unstable way)
            faultFactor = 0.16 + jitter * 0.12; // ranges from 0.04 to 0.28
        } else if (wave < -0.65) {
            // Sudden short power drop/blackout
            faultFactor = 0.008;
        } else {
            // Humming low power glow
            faultFactor = 0.05 + Math.abs(jitter) * 0.04; // ranges from 0.05 to 0.09
        }
        
        // Interpolate the flickering effect with the transition factor
        whiteEmissive = THREE.MathUtils.lerp(baseWhiteEmissive, faultFactor, window.act1Factor);
    }
        
    if (standardWhite) standardWhite.emissiveIntensity = whiteEmissive;
    if (lambertWhite) {
        if (typeof window.act3Factor !== 'undefined' && window.act3Factor > 0.0) {
            // ACT3: directly match standardWhite (no flicker — clean Morse blink)
            const morseVal = window.act3MorseIntensity || 0.0;
            const blended = THREE.MathUtils.lerp(
                params.interiorLight ? 0xcccccc : 0x000000,
                morseVal > 0.1 ? 0xffffff : 0x000000,
                window.act3Factor
            );
            lambertWhite.emissive.setHex(blended);
        } else if (typeof window.act1Factor !== 'undefined' && window.act1Factor > 0.0) {
            // Scale emissive color based on the current flicker ratio relative to base intensity
            const brightnessRatio = Math.max(0.01, whiteEmissive / 0.65);
            const targetColor = new THREE.Color(0xcccccc).multiplyScalar(brightnessRatio);
            
            const baseColor = new THREE.Color(params.interiorLight ? 0xcccccc : 0x000000);
            baseColor.lerp(targetColor, window.act1Factor);
            lambertWhite.emissive.copy(baseColor);
        } else {
            lambertWhite.emissive.setHex(params.interiorLight ? 0xcccccc : 0x000000);
        }
    }
}
