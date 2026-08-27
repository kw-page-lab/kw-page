// Initialize Three.js Environment
function init() {
    const container = document.getElementById('canvas-container');

    // 1. Create Scene with Depth Fog matching the website background (void effect)
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050608);
    scene.fog = new THREE.Fog(0x050608, 15, 30);

    // 2. Camera Setup — High overhead aerial view looking straight down into the water
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 150);
    camera.position.set(0, 8.5, -9.0);
    camera.up.set(0, 0, -1); // North is UP on screen

    // 3. Renderer Setup — no logarithmicDepthBuffer (huge perf cost, z-fighting handled by renderOrder)
    const isLinux = /Linux/i.test(navigator.userAgent) || 
                  /Linux/i.test(navigator.platform) || 
                  (navigator.userAgentData && navigator.userAgentData.platform && /Linux/i.test(navigator.userAgentData.platform));
    
    window.isLinuxPlatform = isLinux;
    
    const rendererOptions = {
        antialias: !isLinux,
        powerPreference: "high-performance",
        desynchronized: true
    };
    renderer = new THREE.WebGLRenderer(rendererOptions);
    renderer.setPixelRatio(1.0); // Safe cap at 1.0 to prevent GPU crash/thermal shutdown on 4K/HiDPI screens
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.LinearToneMapping; // ACESFilmic is expensive; Linear is free
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    // 4. Orbit Controls Setup
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.minDistance = 2.5;
    controls.maxDistance = 35.0;
    controls.maxPolarAngle = Math.PI / 2.35; // Strict water level clamp: prevents peering underneath the water
    controls.minPolarAngle = 0.01;           // Full overhead vertical capability
    controls.target.set(0.0, -2.1, -9.0); // Initial target: Monolith at Z = -9.0

    // 5. Strategic Lighting Setup — designed to accentuate monolith reliefs

    // Ambient: very dim so shadows are not pure black
    ambientLight = new THREE.AmbientLight(0x111827, 0.8);
    scene.add(ambientLight);

    // Key light: low-angle, slightly left — grazes across Z reliefs to cast directional shading
    dirLight = new THREE.DirectionalLight(0xffffff, 2.8);
    dirLight.position.set(-3, 2, 6); // Close to camera plane, angled left
    dirLight.castShadow = false;     // No dynamic shadows — reliefs are shown via normals
    scene.add(dirLight);

    // 6. Background Dust/Starfield
    createStarfield();

    // 6b. Liquid reflective floor
    createLiquidFloor();

    // 6c. Atmospheric clouds and water particles
    createClouds();
    createWaterParticles();

    // 7. Load GLB Model & Tentacles
    loadModel();
    loadTVModel();
    if (typeof initTentacles === 'function') {
        initTentacles();
    }

    // 8. Add Listeners
    window.addEventListener('resize', onWindowResize);

    // Shared TV Focus triggering helper (used by mouse double-click and mobile double-tap)
    function triggerTVFocus(clientX, clientY) {
        if (!window.tvGroup) return;
        
        if (isTVFocused) {
            // If currently focused, double click/tap anywhere exits the focus
            isTVFocused = false;
            isExitingTV = true;
            tvExitStartTime = Date.now();
            window.currentExitTargetX = currentTvYaw;
            const tvCenterY = getTVCenterY();
            window.currentExitTargetY = tvCenterY + currentTvPitch;
            
            isCameraLocked = true;
            targetScrollProgress = 1.0; // Snap vertical scroll to bottom
            scrollProgress = 1.0;       // Ensure scroll progress matches target
            updateCameraLockUI();
            return;
        }
        
        // Ignore double click/tap to focus if camera scroll transition is running
        if (Math.abs(scrollProgress - targetScrollProgress) > 0.25) return;
        
        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1
        );
        
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        
        // Intersect checking
        const intersects = raycaster.intersectObject(window.tvGroup, true);
        if (intersects.length > 0) {
            isTVFocused = true;
            window.tvFocusStartTime = Date.now();
            isExitingTV = false; // Cancel any active exit transition
            tvYaw = 0;
            tvPitch = 0;
            currentTvYaw = 0;
            currentTvPitch = 0;
            const targetDist = getTVTargetFocusDistance();
            tvFocusDistance = targetDist;
            tvTargetFocusDistance = targetDist;
            
            targetScrollProgress = 1.0; // Snap vertical scroll to bottom
            scrollProgress = 1.0;       // Sync scroll progress
            isCameraLocked = false;    // Disable manual elevator scroll controls
            updateCameraLockUI();
        }
    }

    // Unified double-click and double-tap detection using pointerup
    let lastPointerTime = 0;
    let lastPointerX = 0;
    let lastPointerY = 0;
    window.addEventListener('pointerup', (event) => {
        // Double-click focus disabled in aerial mode
    });
    
    // Custom pointer/mouse dragging for TV Look-Around
    window.addEventListener('mousedown', event => {
        if (!isTVFocused) return;
        if (event.button !== 0) return; // Only drag with left click
        isDraggingTV = true;
        prevTvDragX = event.clientX;
        prevTvDragY = event.clientY;
    });

    window.addEventListener('mousemove', event => {
        if (!isTVFocused || !isDraggingTV) return;
        const deltaX = event.clientX - prevTvDragX;
        const deltaY = event.clientY - prevTvDragY;
        prevTvDragX = event.clientX;
        prevTvDragY = event.clientY;

        // Move yaw & pitch based on drag (inverted to match drag expectation)
        tvYaw += deltaX * 0.003 * tvFocusDistance;
        tvPitch -= deltaY * 0.003 * tvFocusDistance;

        // Clamp angles: broad horizontal look-around freedom, controlled pitch
        const maxYaw = 2.5;
        const maxPitch = 0.65;
        tvYaw = Math.max(-maxYaw, Math.min(maxYaw, tvYaw));
        tvPitch = Math.max(-maxPitch, Math.min(maxPitch, tvPitch));
    });

    window.addEventListener('mouseup', () => {
        isDraggingTV = false;
    });

    window.addEventListener('touchstart', event => {
        if (!isTVFocused) return;
        if (event.touches.length === 1) {
            isDraggingTV = true;
            prevTvDragX = event.touches[0].clientX;
            prevTvDragY = event.touches[0].clientY;
        }
    }, { passive: true });

    window.addEventListener('touchmove', event => {
        if (!isTVFocused || !isDraggingTV) return;
        if (event.touches.length === 1) {
            const touchX = event.touches[0].clientX;
            const touchY = event.touches[0].clientY;
            const deltaX = touchX - prevTvDragX;
            const deltaY = touchY - prevTvDragY;
            prevTvDragX = touchX;
            prevTvDragY = touchY;

            // Move yaw & pitch based on drag (inverted to match drag expectation)
            tvYaw += deltaX * 0.0035 * tvFocusDistance;
            tvPitch -= deltaY * 0.0035 * tvFocusDistance;

            const maxYaw = 2.5;
            const maxPitch = 0.65;
            tvYaw = Math.max(-maxYaw, Math.min(maxYaw, tvYaw));
            tvPitch = Math.max(-maxPitch, Math.min(maxPitch, tvPitch));
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
        isDraggingTV = false;
    });
    
    const resetBtn = document.getElementById('resetCam');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (Math.abs(scrollProgress - targetScrollProgress) > 0.005 || isExitingTV) return;
            
            updateCameraLockUI();
            
            if (isTVFocused) {
                isTVFocused = false;
                isExitingTV = true;
                tvExitStartTime = Date.now();
                window.currentExitTargetX = currentTvYaw;
                const tvCenterY = getTVCenterY();
                window.currentExitTargetY = tvCenterY + currentTvPitch;
                
                isCameraLocked = true;
                targetScrollProgress = 0;
                scrollProgress = 0;
            } else {
                targetScrollProgress = 0;
                scrollProgress = 0;
                isCameraLocked = true;
                
                camera.position.set(0, 15.0, 10);
                controls.target.set(0, 15.0, 0);
                controls.enableZoom = false;
            }
        });
    }

    // Camera lock/unlock toggle logic
    const toggleBtn = document.getElementById('toggleLockCam');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            // Disable lock toggle under Act 1 only if focus lock is enabled
            if (document.body.classList.contains('act1-focus-lock') && typeof window.act1Factor !== 'undefined' && window.act1Factor > 0.5) {
                console.log("[Act 1] Camera lock is forced. Unlocking is disabled.");
                return;
            }

            if (Math.abs(scrollProgress - targetScrollProgress) > 0.25 || isExitingTV) return;
            
            if (isTVFocused) {
                isTVFocused = false;
                isExitingTV = true;
                tvExitStartTime = Date.now();
                window.currentExitTargetX = currentTvYaw;
                const tvCenterY = getTVCenterY();
                window.currentExitTargetY = tvCenterY + currentTvPitch;
                
                isCameraLocked = true;
                targetScrollProgress = 1;
                updateCameraLockUI();
            } else {
                isCameraLocked = !isCameraLocked;
                if (isCameraLocked) {
                    // Snap back to nearest state
                    if (scrollProgress > 0.5) {
                        targetScrollProgress = 1;
                    } else {
                        targetScrollProgress = 0;
                    }
                }
                updateCameraLockUI();
            }
        });
    }

    setupUIEventListeners();
    syncUI();
    
    // Initialize time of day values immediately
    updateEnvironmentFromTime();

    // Setup TV Nauta Sidebar
    setupSidebar();

    // Setup Easter Egg
    setupEasterEgg();

    // Setup Scroll Down Hint
    setupScrollHint();

    // Setup Neobrutalism Carousel & Pagination
    setupNeobrutalismCarousel();

    // 9. Start Animation
    animate();
}

// Handle window resizing
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Update TV scale and focus distances dynamically on resize
    if (window.tvGroup) {
        window.tvGroup.scale.setScalar(2.2 * (window.innerWidth < 768 ? 0.65 : 1.0));
    }
    if (isTVFocused) {
        const targetDist = getTVTargetFocusDistance();
        tvTargetFocusDistance = targetDist;
    }
}
