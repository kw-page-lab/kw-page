function createClouds() {
    cloudsGroup = new THREE.Group();
    scene.add(cloudsGroup);

    // Generate a noise texture using a 128x128 canvas
    const noiseSize = 128;
    const noiseCanvas = document.createElement('canvas');
    noiseCanvas.width = noiseSize;
    noiseCanvas.height = noiseSize;
    const noiseCtx = noiseCanvas.getContext('2d');
    const noiseImgData = noiseCtx.createImageData(noiseSize, noiseSize);
    
    function hashJS(x, y) {
        let h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123;
        return h - Math.floor(h);
    }
    function smoothNoiseJS(x, y) {
        let ix = Math.floor(x);
        let iy = Math.floor(y);
        let fx = x - ix;
        let fy = y - iy;
        let ux = fx * fx * (3.0 - 2.0 * fx);
        let uy = fy * fy * (3.0 - 2.0 * fy);
        
        let a = hashJS(ix, iy);
        let b = hashJS((ix + 1) % 128, iy);
        let c = hashJS(ix, (iy + 1) % 128);
        let d = hashJS((ix + 1) % 128, (iy + 1) % 128);
        
        let mix1 = a + ux * (b - a);
        let mix2 = c + ux * (d - c);
        return mix1 + uy * (mix2 - mix1);
    }
    
    const data = noiseImgData.data;
    for (let y = 0; y < noiseSize; y++) {
        for (let x = 0; x < noiseSize; x++) {
            // Generate FBM with 2 octaves
            let val = 0;
            let amp = 0.5;
            let freq = 0.08;
            for (let oct = 0; oct < 2; oct++) {
                val += amp * smoothNoiseJS(x * freq, y * freq);
                freq *= 2.0;
                amp *= 0.5;
            }
            
            let cVal = Math.floor(val * 255);
            let idx = (y * noiseSize + x) * 4;
            data[idx] = cVal;
            data[idx + 1] = cVal;
            data[idx + 2] = cVal;
            data[idx + 3] = 255;
        }
    }
    noiseCtx.putImageData(noiseImgData, 0, 0);
    const noiseTex = new THREE.CanvasTexture(noiseCanvas);
    noiseTex.wrapS = THREE.RepeatWrapping;
    noiseTex.wrapT = THREE.RepeatWrapping;
    noiseTex.minFilter = THREE.LinearFilter;
    noiseTex.magFilter = THREE.LinearFilter;

    // Cloud shader: procedural soft FBM noise with radial alpha mask
    const cloudMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime:  { value: 0 },
            uColor: { value: new THREE.Color(0x1a2130) }, // dark slate grey
            uNoiseTex: { value: noiseTex }
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vWorld;
            void main() {
                vUv = uv;
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vWorld = wp.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uColor;
            uniform sampler2D uNoiseTex;
            varying vec2 vUv;
            varying vec3 vWorld;

            void main() {
                // Soft round billboard mask
                float dist = length(vUv - 0.5);
                float alphaMask = smoothstep(0.5, 0.18, dist);

                // Animate cloud FBM layers using the pre-computed noise texture
                vec2 p1 = vUv * 0.4 + vec2(uTime * 0.015, uTime * 0.011);
                vec2 p2 = vUv * 0.8 - vec2(uTime * 0.009, -uTime * 0.006);
                
                float n1 = texture2D(uNoiseTex, p1).r;
                float n2 = texture2D(uNoiseTex, p2).g;
                float n = (n1 + n2 * 0.5) / 1.5;
                
                float density = smoothstep(0.15, 0.65, n);

                // Blend dark slate with deep charcoal shadow at higher density (no red glow)
                vec3 col = mix(uColor, vec3(0.04, 0.06, 0.08), density * 0.4);
                
                // Soft atmospheric opacity
                float alpha = density * alphaMask * 0.55;

                gl_FragColor = vec4(col, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });

    // Create 12 large billboard planes in the far distance
    const cloudGeo = new THREE.PlaneGeometry(28, 20);
    for(let i = 0; i < 12; i++) {
        const cloud = new THREE.Mesh(cloudGeo, cloudMat);
        
        // Ring placement at a far distance (18 to 26 units) to avoid any clipping/bugs with water or TV
        const angle = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
        const dist = 18.0 + Math.random() * 8.0;
        cloud.position.set(
            Math.cos(angle) * dist,
            -1.0 + Math.random() * 6.0, 
            Math.sin(angle) * dist
        );
        
        // Rotations
        cloud.rotation.y = -angle + Math.PI / 2 + (Math.random() - 0.5) * 0.4;
        cloud.rotation.z = Math.random() * Math.PI * 2;
        
        // Animation states
        cloud.userData = {
            rotSpeed: (Math.random() - 0.5) * 0.015,
            floatSpeed: 0.15 + Math.random() * 0.15,
            floatPhase: Math.random() * 100.0,
            baseY: cloud.position.y
        };
        
        cloudsGroup.add(cloud);
        clouds.push(cloud);
    }
}

function createWaterParticles() {
    const count = 1500;
    waterParticleGeometry = new THREE.BufferGeometry();
    waterParticlePositions = new Float32Array(count * 3);
    waterParticleColors = new Float32Array(count * 3);
    waterParticleSpeeds = new Float32Array(count);
    
    window.waterParticleBaseColors = [];

    for (let i = 0; i < count; i++) {
        // Initialize positions spread along the current vector direction (expanded boundary)
        waterParticlePositions[i * 3] = (Math.random() - 0.5) * 70.0;
        waterParticlePositions[i * 3 + 1] = -2.0 + Math.random() * 18.0;
        waterParticlePositions[i * 3 + 2] = (Math.random() - 0.5) * 70.0;

        waterParticleSpeeds[i] = 0.5 + Math.random() * 1.5;

        // Alternate between dark slate and dusty mist gray (no red particles)
        const isSlate = Math.random() < 0.6;
        if (isSlate) {
            window.waterParticleBaseColors.push(new THREE.Color(0x2d3748)); // Dark slate
        } else {
            window.waterParticleBaseColors.push(new THREE.Color(0x4a5568)); // Dusty mist gray
        }
        
        const y = waterParticlePositions[i * 3 + 1];
        const ratio = Math.max(0, Math.min(1, (y - (-2.0)) / 18.0));
        const fade = 1.0 - ratio;
        const c = window.waterParticleBaseColors[i];
        waterParticleColors[i * 3] = c.r * fade;
        waterParticleColors[i * 3 + 1] = c.g * fade;
        waterParticleColors[i * 3 + 2] = c.b * fade;
    }

    waterParticleGeometry.setAttribute('position', new THREE.BufferAttribute(waterParticlePositions, 3));
    waterParticleGeometry.setAttribute('color', new THREE.BufferAttribute(waterParticleColors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.14,
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending
    });

    waterParticles = new THREE.Points(waterParticleGeometry, material);
    scene.add(waterParticles);
}
