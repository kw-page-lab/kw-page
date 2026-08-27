// Load static GLB model
function loadModel() {
    const loader = new THREE.GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load('kimeraware_logo_3d_opt.glb', function (gltf) {
        cuboidGroup = gltf.scene;

        // Scale to match slider states (scaled up by 1.35x within its axis)
        const monolithScale = 1.35 * (window.innerWidth < 768 ? 0.65 : 1.0);
        cuboidGroup.scale.set(
            (params.width / 2.0) * monolithScale,
            (params.height / 3.92) * monolithScale,
            (params.depth / 2.0) * monolithScale
        );

        // Configure meshes and pre-cache red blocks for fast per-frame animation
        cuboidGroup.traverse(c => {
            if (c.isMesh) {
                c.castShadow = false;
                c.receiveShadow = false;
                c.matrixAutoUpdate = true;

                if (c.userData && c.userData.isRedBlock) {
                    c.userData.animPhase = Math.random() * Math.PI * 2;
                    c.userData.animSpeed = 1.5 + Math.random() * 2.0;
                    c.userData.animRange = 0.03 + Math.random() * 0.04;
                    c.renderOrder = 1;
                    redBlocks.push(c); // Cache once, animate directly every frame
                }
            }
        });

        // Apply initial offsets and materials
        updateMeshPositions();
        updateGLBMaterials();

        // Place monolith in the far upper river area (Z = -9.0, Y = -0.5) partially submerged on one corner
        cuboidGroup.position.set(0, -0.5, -9.0);

        scene.add(cuboidGroup);

        // Create interior point lights inside the monolith
        createInteriorLights();
        updateInteriorLights();

        // Mark monolith load as 100% complete
        window.monolithProgress = 100;
        window.updateOverallProgress();
    }, function (xhr) {
        if (xhr.total) {
            window.monolithProgress = Math.round((xhr.loaded / xhr.total) * 100);
        } else {
            window.monolithProgress = 50; // fallback
        }
        window.updateOverallProgress();
    }, function (error) {
        console.error('Error al cargar el modelo GLB:', error);
        
        // Show clean CORS/local error warning to the user
        const loaderContent = document.querySelector('.loader-content');
        if (loaderContent) loaderContent.style.display = 'none';
        
        const status = document.getElementById('loading-status');
        const details = document.getElementById('loading-details');
        
        if (status) {
            status.style.display = 'block';
            status.innerText = 'CORS Bloqueado / Archivo No Encontrado';
            status.style.color = '#ff3333';
        }
        if (details) {
            details.style.display = 'block';
            details.innerHTML = `
                El navegador bloqueó la carga del modelo 3D debido al protocolo local (<code>file://</code>).<br><br>
                Para levantar el modelo GLB de forma segura, ejecuta un servidor web local en esta carpeta:<br><br>
                <strong>Opción A:</strong> Con Python (Integrado en tu sistema)<br>
                <code>python -m http.server</code><br><br>
                <strong>Opción B:</strong> Con NodeJS/NPM<br>
                <code>npx http-server</code><br><br>
                Luego abre tu navegador en: <a href="http://localhost:8000/kimeraware_3d.html" style="color: #f60101; font-weight: bold; text-decoration: none;">http://localhost:8000/kimeraware_3d.html</a>
            `;
        }
    });
}

// Swapping materials dynamically on GLB meshes (Standard vs Lambert)
function updateGLBMaterials() {
    if (!cuboidGroup) return;

    // Performance mode drops pixel ratio to 0.85 for massive GPU relief, normal caps at 1.0
    renderer.setPixelRatio(params.performanceMode ? 0.85 : 1.0);

    // Hide/show cloud billboards based on performance mode
    if (cloudsGroup) {
        cloudsGroup.visible = !params.performanceMode;
    }

    // Toggle visibility of high-quality Water vs performance-mode Chrome water
    if (liquidFloor) {
        liquidFloor.visible = params.performanceMode;
    }
    if (liquidFloorReal) {
        liquidFloorReal.visible = !params.performanceMode;
    }

    cuboidGroup.traverse(c => {
        if (c.isMesh) {
            if (c.material instanceof THREE.MeshBasicMaterial) return;

            const col = c.material.color;
            const isRed   = col.r > 0.8 && col.g < 0.2;
            const isWhite = col.r > 0.8 && col.g > 0.8;

            if (params.performanceMode) {
                c.material = isRed ? lambertRed : isWhite ? lambertWhite : lambertBlack;
            } else {
                c.material = isRed ? standardRed : isWhite ? standardWhite : standardBlack;
            }
        }
    });
}

// Reposition meshes dynamically along local Z-axis based on layer offsets
function updateMeshPositions() {
    if (!cuboidGroup) return;

    cuboidGroup.traverse(c => {
        if (c.isMesh) {
            // Skip the core box and caps
            if (c.material instanceof THREE.MeshBasicMaterial || c.geometry.type === "PlaneGeometry") {
                return;
            }

            const col = c.material.color;

            // Classify layers by mesh material colors and offset their local Z position
            if (col.r > 0.8 && col.g < 0.2) {
                // Red blocks are handled dynamically in the animation loop
            } else if (col.r > 0.8 && col.g > 0.8) {
                // White letters (baked Z is -0.03)
                c.position.z = -0.03 + params.whiteOffset;
            } else {
                // Black mask and islands (baked Z is -0.01)
                c.position.z = -0.01 + params.blackOffset;
            }
        }
    });
}
