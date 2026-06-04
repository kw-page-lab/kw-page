function createClouds() {
    cloudsGroup = new THREE.Group();
    scene.add(cloudsGroup);

    // Cloud shader: procedural soft FBM noise with radial alpha mask
    const cloudMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime:  { value: 0 },
            uColor: { value: new THREE.Color(0x1a2130) }, // dark slate grey
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
            varying vec2 vUv;
            varying vec3 vWorld;

            vec2 hash2(vec2 p){
                p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));
                return -1.0+2.0*fract(sin(p)*43758.5453123);
            }
            float noise(vec2 p){
                vec2 i=floor(p),f=fract(p);
                vec2 u=f*f*(3.0-2.0*f);
                return mix(mix(dot(hash2(i),f),dot(hash2(i+vec2(1,0)),f-vec2(1,0)),u.x),
                           mix(dot(hash2(i+vec2(0,1)),f-vec2(0,1)),dot(hash2(i+vec2(1,1)),f-vec2(1,1)),u.x),u.y);
            }
            float fbm(vec2 p){
                float v=0.0,a=0.5;
                for(int i=0;i<2;i++){v+=a*noise(p);p*=2.0;a*=0.5;}
                return v;
            }

            void main() {
                // Soft round billboard mask
                float dist = length(vUv - 0.5);
                float alphaMask = smoothstep(0.5, 0.18, dist);

                // Animate cloud FBM layers
                vec2 p1 = vUv * 3.2 + vec2(uTime * 0.025, uTime * 0.018);
                
                float n = fbm(p1);
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
    const count = 4000;
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
