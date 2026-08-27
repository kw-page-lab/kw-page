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

// ================= MORSE CODE ELECTRICAL TRANSMISSION: "FEED THE KIMERA" =================
// F: ..-. | E: . | E: . | D: -.. |   | T: - | H: .... | E: . |   | K: -.- | I: .. | M: -- | E: . | R: .-. | A: .-
const MORSE_CYCLE_DURATION = 13.775;
const MORSE_BLOCKS = [
    [0.000, 0.095, 1], [0.095, 0.190, 0], [0.190, 0.285, 1], [0.285, 0.380, 0], [0.380, 0.665, 1], [0.665, 0.760, 0], [0.760, 0.855, 1], // F
    [0.855, 1.140, 0], [1.140, 1.235, 1], // E
    [1.235, 1.520, 0], [1.520, 1.615, 1], // E
    [1.615, 1.900, 0], [1.900, 2.185, 1], [2.185, 2.280, 0], [2.280, 2.375, 1], [2.375, 2.470, 0], [2.470, 2.565, 1], // D
    [2.565, 3.230, 0], // [Space]
    [3.230, 3.515, 1], // T
    [3.515, 3.800, 0], [3.800, 3.895, 1], [3.895, 3.990, 0], [3.990, 4.085, 1], [4.085, 4.180, 0], [4.180, 4.275, 1], [4.275, 4.370, 0], [4.370, 4.465, 1], // H
    [4.465, 4.750, 0], [4.750, 4.845, 1], // E
    [4.845, 5.510, 0], // [Space]
    [5.510, 5.795, 1], [5.795, 5.890, 0], [5.890, 5.985, 1], [5.985, 6.080, 0], [6.080, 6.365, 1], // K
    [6.365, 6.650, 0], [6.650, 6.745, 1], [6.745, 6.840, 0], [6.840, 6.935, 1], // I
    [6.935, 7.220, 0], [7.220, 7.505, 1], [7.505, 7.600, 0], [7.600, 7.885, 1], // M
    [7.885, 8.170, 0], [8.170, 8.265, 1], // E
    [8.265, 8.550, 0], [8.550, 8.645, 1], [8.645, 8.740, 0], [8.740, 9.025, 1], [9.025, 9.120, 0], [9.120, 9.215, 1], // R
    [9.215, 9.500, 0], [9.500, 9.595, 1], [9.595, 9.690, 0], [9.690, 9.975, 1], // A
    [9.975, 13.775, 1] // Steady Rest Glow
];

function getMonolithMorseFlicker(timeSec) {
    const tCycle = timeSec % MORSE_CYCLE_DURATION;
    
    // Quick scan of active morse interval
    for (let i = 0; i < MORSE_BLOCKS.length; i++) {
        const b = MORSE_BLOCKS[i];
        if (tCycle >= b[0] && tCycle < b[1]) {
            if (b[2] === 1) {
                // Active Pulse / Rest: Strong electric glow with subtle filament snap
                const jitter = Math.sin(timeSec * 95.0) * Math.cos(timeSec * 50.0);
                return 1.15 + jitter * 0.06;
            } else {
                // Gap / Dark Drop: Strong, punchy blackout drop
                return 0.05;
            }
        }
    }
    return 1.0;
}

// Dynamically update intensity of interior lights and white letter emissive values
function updateInteriorLights() {
    const time = performance.now() * 0.001;
    const baseIntensity = params.interiorLight ? 3.5 : 0.0;
    const flicker = getMonolithMorseFlicker(time);

    let intensity = baseIntensity * flicker;
    if (typeof window.act1Factor !== 'undefined' && window.act1Factor > 0.0) {
        intensity = THREE.MathUtils.lerp(intensity, 0.0, window.act1Factor);
    }
        
    interiorLights.forEach(light => {
        light.intensity = intensity;
    });

    // Emissive intensity for white letters:
    // Base diffuse color remains 100% pure crisp white (0xffffff) at all times,
    // while the strong punchy Morse electrical glow pulses visibly!
    const baseWhiteEmissive = params.interiorLight ? 0.65 : 0.0;
    let whiteEmissive = baseWhiteEmissive * (0.08 + 0.92 * flicker);

    if (typeof window.act1Factor !== 'undefined' && window.act1Factor > 0.0) {
        const jitter = Math.sin(time * 82.0) * Math.cos(time * 47.0);
        const wave = Math.sin(time * 6.5) * Math.sin(time * 2.1);
        
        let faultFactor = 0.0;
        if (wave > 0.25) {
            faultFactor = 0.16 + jitter * 0.12;
        } else if (wave < -0.65) {
            faultFactor = 0.008;
        } else {
            faultFactor = 0.05 + Math.abs(jitter) * 0.04;
        }
        whiteEmissive = THREE.MathUtils.lerp(whiteEmissive, faultFactor, window.act1Factor);
    }
        
    if (standardWhite) standardWhite.emissiveIntensity = whiteEmissive;
    if (lambertWhite) {
        const brightnessRatio = Math.max(0.01, whiteEmissive / 0.65);
        const targetColor = new THREE.Color(0xcccccc).multiplyScalar(brightnessRatio);
        lambertWhite.emissive.copy(targetColor);
    }
}
