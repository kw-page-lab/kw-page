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
    const intensity = params.interiorLight ? 3.5 : 0.0;
    interiorLights.forEach(light => {
        light.intensity = intensity;
    });

    // Adjust emissive intensity for white letters to glow when interior lights are on
    const whiteEmissive = params.interiorLight ? 0.65 : 0.0;
    if (standardWhite) standardWhite.emissiveIntensity = whiteEmissive;
    if (lambertWhite) {
        lambertWhite.emissive.setHex(params.interiorLight ? 0xcccccc : 0x000000);
    }
}
