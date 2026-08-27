function createLiquidFloor() {
    // Load normal map for the high-realism THREE.Water object
    const textureLoader = new THREE.TextureLoader();
    const waterNormals = textureLoader.load('https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/waternormals.jpg', function (texture) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    });

    // Use high-res geometry so vertex displacement is smooth around both monolith and TV
    const waterGeoHiRes = new THREE.PlaneGeometry(160, 160, 160, 160);

    // 1. High-realism THREE.Water
    liquidFloorReal = new THREE.Water(
        waterGeoHiRes,
        {
            textureWidth: 512,
            textureHeight: 512,
            waterNormals: waterNormals,
            sunDirection: new THREE.Vector3(0.0, 1.0, 0.0).normalize(),
            sunColor: 0x334455, // Subtle non-glaring soft specularity
            waterColor: 0x020305, // Deep void darkness
            distortionScale: 6.5,
            fog: scene.fog !== undefined
        }
    );
    liquidFloorReal.rotation.x = -Math.PI / 2;
    liquidFloorReal.position.y = -2.0;

    // Inject vertex displacement for natural flowing water currents + wakes around TV & Monolith
    liquidFloorReal.material.onBeforeCompile = (shader) => {
        shader.uniforms.uObjPos = { value: new THREE.Vector2(0.7, 11.5) };
        shader.uniforms.uObjRadius = { value: 4.2 };
        shader.uniforms.uMonolithPos = { value: new THREE.Vector2(0.0, -9.0) };
        shader.uniforms.uMonolithRadius = { value: 4.2 };
        shader.uniforms.uWaterTime = { value: 0.0 };
        
        window._waterRealShader = shader;
        
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform vec2 uObjPos;
            uniform float uObjRadius;
            uniform vec2 uMonolithPos;
            uniform float uMonolithRadius;
            uniform float uWaterTime;
            `
        );
        shader.vertexShader = shader.vertexShader.replace(
            'void main() {',
            `void main() {
            vec3 displacedPosition = position;
            vec2 worldXZ = (modelMatrix * vec4(displacedPosition, 1.0)).xz;
            
            // Multi-harmonic realistic flowing water with fluid currents
            float t = uWaterTime * 2.6;
            
            // 1. Primary sweeping ocean swell & flow
            float wave1 = sin(worldXZ.x * 0.65 - t * 2.2 + worldXZ.y * 0.3) * 0.22;
            float wave2 = cos(worldXZ.x * 1.1 + t * 2.8 - worldXZ.y * 0.6) * 0.14;
            // 2. Secondary turbulent crossing chops
            float wave3 = sin((worldXZ.x * 1.8 + worldXZ.y * 1.2) - t * 3.6) * 0.08;
            float wave4 = cos((worldXZ.x * 2.4 - worldXZ.y * 1.8) + t * 4.2) * 0.04;
            float ambientWaves = wave1 + wave2 + wave3 + wave4;

            // 3. Realistic interaction around submerged TV (at X=0.7, Z=11.5)
            vec2 deltaTV = worldXZ - uObjPos;
            float distTV = length(deltaTV);
            float falloffTV = 1.0 - smoothstep(0.0, uObjRadius, distTV);
            float tvDepression = -0.24 * falloffTV * falloffTV;
            float tvRipples = sin(distTV * 9.0 - t * 4.5) * 0.12 * falloffTV;

            // 4. Realistic interaction around partially submerged Monolith (at Z=-9.0)
            vec2 deltaMono = worldXZ - uMonolithPos;
            float distMono = length(deltaMono);
            float falloffMono = 1.0 - smoothstep(0.0, uMonolithRadius, distMono);
            float monoDepression = -0.16 * falloffMono * falloffMono;
            float monoRipples = sin(distMono * 7.5 - t * 3.8) * 0.14 * falloffMono;

            displacedPosition.z += ambientWaves + tvDepression + tvRipples + monoDepression + monoRipples;
            `
        );

        shader.vertexShader = shader.vertexShader.replace(
            /vec4\(\s*position\s*,\s*1\.0\s*\)/g,
            'vec4( displacedPosition, 1.0 )'
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            uniform vec2 uObjPos;
            uniform float uObjRadius;
            uniform vec2 uMonolithPos;
            uniform float uMonolithRadius;
            uniform float uWaterTime;
            `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            'gl_FragColor = vec4( outgoingLight, alpha );',
            `
            vec2 worldXZ = worldPosition.xz;
            float t = uWaterTime * 2.2;
            
            // Subtle foam around objects
            float distTV = length(worldXZ - uObjPos);
            float distMono = length(worldXZ - uMonolithPos);
            
            float foamTV = smoothstep(uObjRadius * 0.75, uObjRadius * 0.95, distTV) * (1.0 - smoothstep(uObjRadius * 0.95, uObjRadius * 1.35, distTV));
            float foamMono = smoothstep(uMonolithRadius * 0.75, uMonolithRadius * 0.95, distMono) * (1.0 - smoothstep(uMonolithRadius * 0.95, uMonolithRadius * 1.35, distMono));
            
            vec2 noiseUv = worldXZ * 1.8;
            float n1 = texture2D(normalSampler, noiseUv * 0.2 + vec2(-t * 0.1, t * 0.05)).r;
            float n2 = texture2D(normalSampler, noiseUv * 0.4 + vec2(-t * 0.15, -t * 0.08)).g;
            float foamNoise = smoothstep(0.42, 0.72, n1 + n2 * 0.5);
            
            float totalFoam = clamp((foamTV + foamMono) * foamNoise * 0.75, 0.0, 1.0);
            vec3 foamColor = vec3(0.85, 0.92, 0.98);
            vec3 shadedFoam = foamColor * (diffuseLight * 0.4 + vec3(0.25));
            
            vec3 finalColor = mix(outgoingLight, shadedFoam, totalFoam * 0.55);
            gl_FragColor = vec4( finalColor, alpha );
            `
        );
    };
    scene.add(liquidFloorReal);

    // 2. High-speed chrome approximation (performance mode) - kept hidden by default
    liquidFloorMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime:              { value: 0 },
            uColor:             { value: new THREE.Color(0x020305) },
            uFogColor:          { value: new THREE.Color(0x050608) },
            uFogNear:           { value: 15.0 },
            uFogFar:            { value: 30.0 },
            uSunDirection:      { value: new THREE.Vector3(0.0, 1.0, 0.0) },
            uObjPos:            { value: new THREE.Vector2(0.7, 11.5) },
            uObjRadius:         { value: 2.8 },
            uObjDepth:          { value: 0.22 }
        },
        vertexShader: `
            uniform float uTime;
            uniform vec2 uObjPos;
            uniform float uObjRadius;
            uniform float uObjDepth;
            varying vec2 vUv;
            varying vec3 vWorld;
            varying float vDisplacement;

            void main() {
                vUv = uv;
                vec4 wp = modelMatrix * vec4(position, 1.0);

                // Current flows in -X direction
                vec2 flowDir = vec2(-1.0, 0.0);
                vec2 delta = wp.xz - uObjPos;
                float dist = length(delta);
                vec2 dir = dist > 0.001 ? delta / dist : vec2(0.0);
                float falloff = 1.0 - smoothstep(0.0, uObjRadius, dist);

                // Depression where TV sits
                float depression = -uObjDepth * falloff * falloff;

                // Bow wave / Splash: water piles up and crashes against the right side and wraps around the front/back (+/-Z)
                float upstream = dot(dir, -flowDir); // 1.0 = upstream face (+X)
                // Sharper wrapping profile to concentrate wave height on the right side and fade it faster
                float flowWeight = smoothstep(-0.2, 1.0, upstream);
                
                // Make it peak sharply right at the bezel boundary (dist = uObjRadius * 0.85)
                float bowFalloff = smoothstep(uObjRadius * 0.2, uObjRadius * 0.85, dist) * (1.0 - smoothstep(uObjRadius * 0.85, uObjRadius * 1.5, dist));
                float bowWave = bowFalloff * 0.85 * flowWeight; // Much higher peak (85cm) on the right impact, wrapping at 21cm on sides (flowWeight = 0.25)
                // Rapid chaotic splash waves hitting and wrapping around the bezel:
                bowWave += sin(dist * 10.0 - uTime * 5.0) * 0.16 * bowFalloff * flowWeight;
                bowWave += cos(dist * 16.0 + uTime * 7.0) * 0.05 * bowFalloff * flowWeight;

                // V-wake: trailing waves downstream (-X)
                float downstream = dot(dir, flowDir);
                float wakeSpread = abs(dot(dir, vec2(0.0, 1.0)));
                float vAngle = smoothstep(0.2, 0.7, downstream) * smoothstep(0.0, 0.5, wakeSpread);
                float wakeFalloff = vAngle * smoothstep(uObjRadius * 0.5, uObjRadius * 1.0, dist) * (1.0 - smoothstep(uObjRadius * 1.5, uObjRadius * 4.0, dist));
                float wake = sin(dist * 10.0 - uTime * 3.5) * 0.005 * wakeFalloff;
                wake += sin(dist * 16.0 - uTime * 5.5) * 0.001 * wakeFalloff;

                // Turbulence: chaotic chop close to the object
                float turbZone = falloff * falloff;
                float turb = sin(delta.x * 15.0 + uTime * 6.0) * cos(delta.y * 12.0 - uTime * 4.5) * 0.015 * turbZone;
                turb += sin(delta.x * 22.0 - uTime * 8.0) * sin(delta.y * 18.0 + uTime * 5.0) * 0.005 * turbZone;

                // Concentric ripples: reduced on the downstream (left) side to make it calmer
                float ripple = sin(dist * 6.0 - uTime * 3.0) * 0.02 * falloff * (1.0 - downstream * 0.6);

                float totalDisp = depression + bowWave + wake + turb + ripple;
                wp.y += totalDisp;
                vDisplacement = totalDisp;

                vWorld = wp.xyz;
                gl_Position = projectionMatrix * viewMatrix * wp;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uColor;
            uniform vec3 uFogColor;
            uniform float uFogNear;
            uniform float uFogFar;
            uniform vec3 uSunDirection;
            uniform vec2 uObjPos;
            uniform float uObjRadius;
            varying vec2 vUv;
            varying vec3 vWorld;
            varying float vDisplacement;

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

            void main() {
                vec3 viewDir = normalize(cameraPosition - vWorld);

                // 1. Calculate analytical concentric wave normals & deep well depression for BOTH Monolith and TV
                vec2 monoPos = vec2(0.0, -9.0);
                vec2 tvPos = uObjPos;
                
                float distMono = length(vWorld.xz - monoPos);
                float distTV = length(vWorld.xz - tvPos);
                
                float t = uTime * 4.2;
                
                // Monolith well wave slope
                float dampingMono = 1.0 - smoothstep(0.0, 7.5, distMono);
                float cosMono = cos(distMono * 4.5 - t * 2.2) * 4.5 * 0.045 * dampingMono;
                vec2 derivMono = (vWorld.xz - monoPos) / max(distMono, 0.0001) * cosMono;
                
                // TV well wave slope (enlarged to match Monolith size)
                float dampingTV = 1.0 - smoothstep(0.0, 7.5, distTV);
                float cosTV = cos(distTV * 4.5 - t * 2.4) * 4.5 * 0.045 * dampingTV;
                vec2 derivTV = (vWorld.xz - tvPos) / max(distTV, 0.0001) * cosTV;
                
                vec2 normDeriv = derivMono + derivTV;
                
                // Flat world normal perturbed by waves
                vec3 normal = normalize(vec3(-normDeriv.x, 1.0, -normDeriv.y));

                // 2. High frequency micro-ripples noise flowing to the right
                vec2 wp = vWorld.xz * 2.5;
                float t2 = uTime * 2.4;
                float n1 = noise(wp + vec2(-t2 * 0.45, t2 * 0.08));
                float n2 = noise(wp * 1.7 + vec2(-t2 * 0.35, t2 * 0.15));
                
                normal.xz += vec2(n1, n2) * 0.022 * (dampingMono + dampingTV);
                normal = normalize(normal);

                // Boundary fade to seamless background
                float dist = length(vWorld.xz) / 58.0;
                float edgeFade = smoothstep(0.2, 1.0, dist);

                // High-speed chrome approximation
                float metallicGlow = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
                vec3 chromeCol = mix(uColor, vec3(0.08, 0.10, 0.14), metallicGlow * 0.4);
                vec3 col = mix(chromeCol, uColor, edgeFade * 0.55);

                // Specular highlights: Soft overhead key light
                vec3 lightDir = uSunDirection;
                vec3 halfDir = normalize(lightDir + viewDir);
                float sunHeightFade = smoothstep(-0.1, 0.2, lightDir.y);
                float spec = pow(max(dot(normal, halfDir), 0.0), 64.0);
                col += vec3(0.4, 0.5, 0.6) * spec * 0.3 * sunHeightFade;

                // Object interaction — directional wake effects
                vec2 objDelta = vWorld.xz - uObjPos;
                float objDist = length(objDelta);
                vec2 objDir = objDist > 0.001 ? objDelta / objDist : vec2(0.0);
                float objProximity = 1.0 - smoothstep(0.0, uObjRadius * 0.7, objDist);

                // Caustic shimmer near TV (soft subtle tint)
                float caustic = sin(objDist * 18.0 - uTime * 4.5) * 0.5 + 0.5;
                caustic *= sin(objDist * 25.0 + uTime * 3.0) * 0.5 + 0.5;
                col += vec3(0.05, 0.10, 0.15) * caustic * objProximity * 0.15;

                // Bow wave foam highlight on upstream side (+X)
                float upstreamFrag = dot(objDir, vec2(1.0, 0.0)); // 1.0 = upstream (+X)
                
                // Foam mask: upstream collision zone + wrapping around front/back shoulders
                // Foam is generated proportionally to flowWeight (thickest at right impact, thin on sides, zero at left)
                float flowWeight = smoothstep(-0.2, 1.0, upstreamFrag);
                float foamZone = pow(flowWeight, 2.0); 
                // Tight band right against the bezel
                float foamDist = smoothstep(uObjRadius * 0.72, uObjRadius * 0.85, objDist) * (1.0 - smoothstep(uObjRadius * 0.85, uObjRadius * 1.25, objDist));
                
                // Build organic noise using the procedural noise function
                vec2 noiseUv = vWorld.xz * 2.2;
                float foamNoise1 = noise(noiseUv * 0.18 + vec2(uTime * 0.08, -uTime * 0.03));
                float foamNoise2 = noise(noiseUv * 0.4 - vec2(uTime * 0.15, uTime * 0.06));
                float combinedNoise = smoothstep(-0.24, 0.44, foamNoise1 + foamNoise2 * 0.5);

                // Upstream foam is turbulent but much more subtle and confined
                float crashFoam = foamZone * foamDist * (0.3 + 0.7 * combinedNoise) * 0.85; 
                
                // Downstream wake foam trailing to the left (-X) (much narrower and shorter)
                float downstreamFrag = dot(objDir, vec2(-1.0, 0.0)); // 1.0 = downstream (-X)
                float wakeSpreadFrag = abs(dot(objDir, vec2(0.0, 1.0)));
                float wakeAngle = smoothstep(0.3, 0.95, downstreamFrag) * (1.0 - smoothstep(0.18, 0.38, wakeSpreadFrag));
                float wakeDist = smoothstep(uObjRadius * 0.8, uObjRadius * 1.0, objDist) * (1.0 - smoothstep(uObjRadius * 1.0, uObjRadius * 2.0, objDist));
                float wakeFoam = wakeAngle * wakeDist * (combinedNoise * 0.22);
                
                // Ring foam at the boundary contact line (more faint and thin)
                float ringFoam = (1.0 - smoothstep(0.0, uObjRadius * 0.55, objDist)) * (0.1 + 0.9 * combinedNoise) * 0.28;
                
                // Clamp total foam value
                float totalFoam = clamp(crashFoam + wakeFoam + ringFoam, 0.0, 1.0);
                
                // Shading calculations to prevent self-illumination (glowing) in the dark
                vec3 foamColor = vec3(0.82, 0.88, 0.92); // Less bright white, slightly slate blue
                // Calculate simple diffuse component from the sun
                float sunDiffuse = max(dot(normal, uSunDirection), 0.0);
                vec3 shadedFoamColor = foamColor * (sunDiffuse * 0.35 + vec3(0.18));
                
                // Mix foam naturally into the final output (max 48% opacity instead of 95%)
                col = mix(col, shadedFoamColor, totalFoam * 0.48);

                // Turbulent normal perturbation near TV
                float turbNorm = sin(objDelta.x * 20.0 + uTime * 7.0) * cos(objDelta.y * 16.0 - uTime * 5.0);
                normal.xz += vec2(turbNorm) * 0.06 * objProximity;
                normal = normalize(normal);

                // Depth Fog calculation
                float depth = length(cameraPosition - vWorld);
                float fogFactor = clamp((depth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
                col = mix(col, uFogColor, fogFactor);

                gl_FragColor = vec4(col, 1.0);
            }
        `,
    });

    liquidFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(120, 120, 128, 128),
        liquidFloorMat
    );
    liquidFloor.rotation.x = -Math.PI / 2;
    liquidFloor.position.y = -2.0;
    scene.add(liquidFloor);
}
