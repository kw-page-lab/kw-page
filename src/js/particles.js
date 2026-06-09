function createStarfield() {
    const particleCount = 1200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
        const radius = 8 + Math.random() * 27;
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);
        
        positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = radius * Math.cos(phi);

        const randColor = Math.random();
        if (randColor < 0.2) {
            colors[i * 3] = 1.0;
            colors[i * 3 + 1] = 0.1;
            colors[i * 3 + 2] = 0.1;
        } else if (randColor < 0.5) {
            colors[i * 3] = 0.9;
            colors[i * 3 + 1] = 0.95;
            colors[i * 3 + 2] = 1.0;
        } else {
            colors[i * 3] = 0.3;
            colors[i * 3 + 1] = 0.1;
            colors[i * 3 + 2] = 0.4;
        }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.10,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    });

    starField = new THREE.Points(geometry, material);
    scene.add(starField);
}
