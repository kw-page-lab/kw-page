function createLiquidFloor() {
    // Load normal map for the high-realism THREE.Water object
    const textureLoader = new THREE.TextureLoader();
    const waterNormals = textureLoader.load('https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/waternormals.jpg', function (texture) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    });

    // Use high-res geometry so vertex displacement is smooth around the TV
    const waterGeoHiRes = new THREE.PlaneGeometry(120, 120, 128, 128);

    // 1. High-realism THREE.Water (from Three.js ocean example)
    liquidFloorReal = new THREE.Water(
        waterGeoHiRes,
        {
            textureWidth: 256,
            textureHeight: 256,
            waterNormals: waterNormals,
            sunDirection: new THREE.Vector3(-3.0, 2.0, 6.0).normalize(),
            sunColor: 0xffffff,
            waterColor: 0x030406,
            distortionScale: 3.7,
            fog: scene.fog !== undefined
        }
    );
    liquidFloorReal.rotation.x = -Math.PI / 2;
    liquidFloorReal.position.y = -2.0;

    // Inject vertex displacement into THREE.Water's built-in shader
    // to push water down around the TV, creating a "submerged object" effect
    liquidFloorReal.material.onBeforeCompile = (shader) => {
        shader.uniforms.uObjPos = { value: new THREE.Vector2(0.31, 0.0) };
        shader.uniforms.uObjRadius = { value: 2.8 };
        shader.uniforms.uObjDepth = { value: 0.22 };
        shader.uniforms.uWaterTime = { value: 0.0 };
        
        // Store ref so we can update in animate loop
        window._waterRealShader = shader;
        
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform vec2 uObjPos;
            uniform float uObjRadius;
            uniform float uObjDepth;
            uniform float uWaterTime;
            `
        );
        shader.vertexShader = shader.vertexShader.replace(
            'void main() {',
            `void main() {
            vec3 displacedPosition = position;
            // Current flows in -X direction
            vec2 flowDir = vec2(-1.0, 0.0);
            vec2 delta = (modelMatrix * vec4(displacedPosition, 1.0)).xz - uObjPos;
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
            float bowWave = bowFalloff * flowWeight * 0.85; // Much higher peak (85cm) on the right impact, wrapping at 21cm on sides (flowWeight = 0.25)
            // Rapid chaotic splash waves hitting and wrapping around the bezel:
            bowWave += sin(dist * 10.0 - uWaterTime * 5.0) * 0.16 * bowFalloff * flowWeight;
            bowWave += cos(dist * 16.0 + uWaterTime * 7.0) * 0.05 * bowFalloff * flowWeight;

            // V-wake: trailing waves downstream (-X)
            float downstream = dot(dir, flowDir); // 1.0 = downstream
            float wakeSpread = abs(dot(dir, vec2(0.0, 1.0))); // lateral spread
            float vAngle = smoothstep(0.2, 0.7, downstream) * smoothstep(0.0, 0.5, wakeSpread);
            float wakeFalloff = vAngle * smoothstep(uObjRadius * 0.5, uObjRadius * 1.0, dist) * (1.0 - smoothstep(uObjRadius * 1.5, uObjRadius * 4.0, dist));
            float wake = sin(dist * 10.0 - uWaterTime * 3.5) * 0.005 * wakeFalloff;
            wake += sin(dist * 16.0 - uWaterTime * 5.5) * 0.001 * wakeFalloff;

            // Turbulence: chaotic displacement close to the object
            float turbZone = falloff * falloff;
            float turb = sin(delta.x * 15.0 + uWaterTime * 6.0) * cos(delta.y * 12.0 - uWaterTime * 4.5) * 0.015 * turbZone;
            turb += sin(delta.x * 22.0 - uWaterTime * 8.0) * sin(delta.y * 18.0 + uWaterTime * 5.0) * 0.005 * turbZone;

            // Concentric ripples: reduced on the downstream (left) side to make it calmer
            float ripple = sin(dist * 6.0 - uWaterTime * 3.0) * 0.02 * falloff * (1.0 - downstream * 0.6);

            displacedPosition.z += depression + bowWave + wake + turb + ripple;
            `
        );

        // Replace vec4( position, 1.0 ) with vec4( displacedPosition, 1.0 ) in THREE.Water's shader
        shader.vertexShader = shader.vertexShader.replace(
            /vec4\(\s*position\s*,\s*1\.0\s*\)/g,
            'vec4( displacedPosition, 1.0 )'
        );

        // Declare uniforms in fragment shader
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            uniform vec2 uObjPos;
            uniform float uObjRadius;
            uniform float uWaterTime;
            `
        );

        // Inject foam logic at the end of fragment shader before tonemapping
        shader.fragmentShader = shader.fragmentShader.replace(
            'gl_FragColor = vec4( outgoingLight, alpha );',
            `
            // Calculate foam based on position relative to TV
            vec2 delta = worldPosition.xz - uObjPos;
            float dist = length(delta);
            vec2 dir = dist > 0.001 ? delta / dist : vec2(0.0);
            
            // Current flows in -X direction
            vec2 flowDir = vec2(-1.0, 0.0);
            float upstream = dot(dir, -flowDir); // 1.0 = upstream (+X)
            
            // Foam mask: upstream collision zone + wrapping around front/back shoulders
            // Foam is generated proportionally to flowWeight (thickest at right impact, thin on sides, zero at left)
            float flowWeight = smoothstep(-0.2, 1.0, upstream);
            float foamZone = pow(flowWeight, 2.0); 
            // Tight band right against the bezel
            float foamDist = smoothstep(uObjRadius * 0.72, uObjRadius * 0.85, dist) * (1.0 - smoothstep(uObjRadius * 0.85, uObjRadius * 1.25, dist));
            
            // Build complex organic noise using the normalSampler texture
            vec2 noiseUv = worldPosition.xz * 2.2;
            float foamNoise1 = texture2D(normalSampler, noiseUv * 0.18 + vec2(uWaterTime * 0.08, -uWaterTime * 0.03)).r;
            float foamNoise2 = texture2D(normalSampler, noiseUv * 0.4 - vec2(uWaterTime * 0.15, uWaterTime * 0.06)).g;
            float combinedNoise = smoothstep(0.40, 0.70, foamNoise1 + foamNoise2 * 0.5);

            // Upstream foam is turbulent but much more subtle and confined
            float crashFoam = foamZone * foamDist * (0.3 + 0.7 * combinedNoise) * 0.85; 
            
            // Downstream wake foam trailing to the left (-X) (much narrower and shorter)
            float downstream = dot(dir, flowDir); // 1.0 = downstream (-X)
            float wakeSpread = abs(dot(dir, vec2(0.0, 1.0)));
            float wakeAngle = smoothstep(0.3, 0.95, downstream) * (1.0 - smoothstep(0.18, 0.38, wakeSpread));
            float wakeDist = smoothstep(uObjRadius * 0.8, uObjRadius * 1.0, dist) * (1.0 - smoothstep(uObjRadius * 1.0, uObjRadius * 2.0, dist));
            float wakeFoam = wakeAngle * wakeDist * (combinedNoise * 0.22);
            
            // Ring foam at the boundary contact line (more faint and thin)
            float ringFoam = (1.0 - smoothstep(0.0, uObjRadius * 0.55, dist)) * (0.1 + 0.9 * combinedNoise) * 0.28;
            
            // Clamp total foam value
            float totalFoam = clamp(crashFoam + wakeFoam + ringFoam, 0.0, 1.0);
            
            // Shading calculations to prevent self-illumination (glowing) in the dark.
            // We blend foamColor with the ambient term (0.18) + diffuse light from the sun.
            vec3 foamColor = vec3(0.82, 0.88, 0.92); // Less bright white, slightly slate blue
            vec3 shadedFoamColor = foamColor * (diffuseLight * 0.35 + vec3(0.18));
            
            // Mix foam naturally into the final output (max 48% opacity instead of 95%)
            vec3 finalColor = mix(outgoingLight, shadedFoamColor, totalFoam * 0.48);
            
            gl_FragColor = vec4( finalColor, alpha );
            `
        );
    };
    scene.add(liquidFloorReal);

    // 2. High-speed chrome approximation (performance mode)
    liquidFloorMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime:              { value: 0 },
            uColor:             { value: new THREE.Color(0x050608) },
            uFogColor:          { value: new THREE.Color(0x050608) },
            uFogNear:           { value: 15.0 },
            uFogFar:            { value: 30.0 },
            uSunDirection:      { value: new THREE.Vector3(-3.0, 2.0, 6.0).normalize() },
            uObjPos:            { value: new THREE.Vector2(0.31, 0.0) },
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

                // 1. Calculate analytical concentric wave normals per-pixel
                float distCenter = length(vWorld.xz);
                float t = uTime * 4.2;
                
                float w1 = sin(distCenter * 5.0 - t * 2.2);
                float w2 = sin(distCenter * 10.0 + t * 3.2);
                
                // Localized wave damping near the monolith
                float damping = 1.0 - smoothstep(0.0, 8.5, distCenter);
                
                // Calculate slope derivatives analytically per-pixel
                float cos1 = cos(distCenter * 5.0 - t * 2.2) * 5.0 * 0.045;
                float cos2 = cos(distCenter * 10.0 + t * 3.2) * 10.0 * 0.012;
                float slope = (cos1 + cos2) * damping;
                
                // World space horizontal perturbation vector
                vec2 normDeriv = (vWorld.xz / max(distCenter, 0.0001)) * slope;
                
                // Flat world normal perturbed by waves
                vec3 normal = normalize(vec3(-normDeriv.x, 1.0, -normDeriv.y));

                // 2. High frequency micro-ripples noise flowing to the right (positive X current)
                vec2 wp = vWorld.xz * 2.5;
                float t2 = uTime * 2.4;
                float n1 = noise(wp + vec2(-t2 * 0.45, t2 * 0.08));
                float n2 = noise(wp * 1.7 + vec2(-t2 * 0.35, t2 * 0.15));
                
                normal.xz += vec2(n1, n2) * 0.022 * damping;
                normal = normalize(normal);

                // Boundary fade to seamless background
                float dist = length(vWorld.xz) / 58.0;
                float edgeFade = smoothstep(0.2, 1.0, dist);

                // High-speed chrome approximation
                float metallicGlow = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
                vec3 chromeCol = mix(uColor, vec3(0.65, 0.7, 0.75), metallicGlow);
                vec3 col = mix(chromeCol, uColor, edgeFade * 0.55);

                // Specular highlights: White key light (acting as sun)
                vec3 lightDir = uSunDirection;
                vec3 halfDir = normalize(lightDir + viewDir);
                float sunHeightFade = smoothstep(-0.1, 0.2, lightDir.y);
                float spec = pow(max(dot(normal, halfDir), 0.0), 128.0);
                col += vec3(0.9, 0.95, 1.0) * spec * 0.8 * sunHeightFade;

                // Object interaction — directional wake effects
                vec2 objDelta = vWorld.xz - uObjPos;
                float objDist = length(objDelta);
                vec2 objDir = objDist > 0.001 ? objDelta / objDist : vec2(0.0);
                float objProximity = 1.0 - smoothstep(0.0, uObjRadius * 0.7, objDist);

                // Caustic shimmer near TV
                float caustic = sin(objDist * 18.0 - uTime * 4.5) * 0.5 + 0.5;
                caustic *= sin(objDist * 25.0 + uTime * 3.0) * 0.5 + 0.5;
                col += vec3(0.15, 0.25, 0.35) * caustic * objProximity * 0.25;

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
