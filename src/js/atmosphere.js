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

    // Mist shader material (separate from cloudMat to control opacity with act1Factor)
    const mistMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime:  { value: 0 },
            uColor: { value: new THREE.Color(0x020304) }, // deep dark charcoal grey
            uNoiseTex: { value: noiseTex },
            uOpacityFactor: { value: 0.0 } // 0.0 initially, controlled by act1Factor
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uColor;
            uniform sampler2D uNoiseTex;
            uniform float uOpacityFactor;
            varying vec2 vUv;

            void main() {
                float dist = length(vUv - 0.5);
                float alphaMask = smoothstep(0.5, 0.15, dist);

                vec2 p1 = vUv * 0.35 + vec2(uTime * 0.015, uTime * 0.01);
                vec2 p2 = vUv * 0.7 - vec2(uTime * 0.01, -uTime * 0.007);
                
                float n1 = texture2D(uNoiseTex, p1).r;
                float n2 = texture2D(uNoiseTex, p2).g;
                float n = (n1 + n2 * 0.5) / 1.5;
                
                float density = smoothstep(0.08, 0.65, n);
                
                // Deep black/greyish mist color
                vec3 col = mix(uColor, vec3(0.0, 0.0, 0.01), density * 0.45);
                
                // Scale opacity with uOpacityFactor (use NormalBlending to darken the background)
                float alpha = density * alphaMask * 0.85 * uOpacityFactor;

                gl_FragColor = vec4(col, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending, // Obscures and darkens background elements
        side: THREE.DoubleSide
    });
    window.act1MistMaterial = mistMat;

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

    // Create 10 close-up traversing mist planes for Act 1
    window.act1MistPlanes = [];
    const mistGeo = new THREE.PlaneGeometry(24, 18);
    for (let i = 0; i < 10; i++) {
        const mist = new THREE.Mesh(mistGeo, mistMat);
        // Distribute Y across the entire vertical height from water (Y=-2) to top of monolith (Y=18)
        const baseY = -2.0 + (i / 9) * 20.0; // Spaced evenly from -2.0 to 18.0
        
        // Distribute Z between -2.0 (behind TV/monolith center) and 3.5 (in front of them, but far enough from camera)
        const baseZ = -2.0 + Math.random() * 5.5;
        
        // Bidirectional drift direction
        const direction = Math.random() < 0.5 ? 1.0 : -1.0;
        
        mist.position.set(
            (Math.random() - 0.5) * 24.0,
            baseY,
            baseZ
        );
        
        mist.userData = {
            speedX: (0.22 + Math.random() * 0.28) * direction, // drift speed and direction
            floatSpeed: 0.3 + Math.random() * 0.3,
            floatPhase: Math.random() * Math.PI * 2,
            baseY: baseY,
            baseZ: baseZ,
            currentRot: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.012
        };
        
        cloudsGroup.add(mist);
        window.act1MistPlanes.push(mist);
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
