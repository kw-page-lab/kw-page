// Pause render loop when tab is not visible (saves 100% GPU when minimized)
document.addEventListener('visibilitychange', () => {
    isPageVisible = !document.hidden;
});

let isPageFocused = document.hasFocus();
function setFocused() {
    if (!isPageFocused) {
        isPageFocused = true;
        lastFrameTime = performance.now();
    }
}
window.addEventListener('focus', setFocused);
window.addEventListener('pointerdown', setFocused, { passive: true });
window.addEventListener('keydown', setFocused, { passive: true });
window.addEventListener('blur', () => {
    isPageFocused = false;
});

let lastRenderTime = 0;

// Animation loop
let idleFrameCount = 0;
function animate() {
    requestAnimationFrame(animate);
    if (!isPageVisible) return; // Don't render hidden tabs

    const now = performance.now();
    
    // Throttle rendering when unfocused (saves GPU for Wallpaper Engine/system, prevent conflicts)
    if (!isPageFocused) {
        const frameInterval = 1000 / 30; // Max 30 FPS when unfocused
        const elapsed = now - lastRenderTime;
        if (elapsed < frameInterval - 1) { // 1ms tolerance
            return;
        }
    }
    lastRenderTime = now;
    const deltaTime = (now - lastFrameTime) * 0.001;
    lastFrameTime = now;

    // Smooth transition for Act 1 filter (takes ~1.5 seconds)
    const act1TransitionSpeed = 1.0 / 1.5;
    if (window.act1Factor < window.act1Target) {
        window.act1Factor = Math.min(window.act1Target, window.act1Factor + deltaTime * act1TransitionSpeed);
    } else if (window.act1Factor > window.act1Target) {
        window.act1Factor = Math.max(window.act1Target, window.act1Factor - deltaTime * act1TransitionSpeed);
    }

    // Sync body class with TV focus state
    if (isTVFocused) {
        if (!document.body.classList.contains('tv-focused')) {
            document.body.classList.add('tv-focused');
        }
    } else {
        if (document.body.classList.contains('tv-focused')) {
            document.body.classList.remove('tv-focused');
        }
    }

    // Automatically hide scroll hint if we scroll down or enter TV focus
    const scrollHint = document.getElementById('scroll-hint-indicator');
    if (scrollHint && (scrollProgress > 0.05 || isTVFocused)) {
        scrollHint.classList.remove('show');
    }

    if (updateTV) {
        updateTV(now * 0.001, deltaTime);
    }
    // Fully extinguish internal lights in void mode
    if (window.tvInternalCabinetLight) {
        window.tvInternalCabinetLight.intensity = 0.0;
        window.tvInternalCabinetLight.visible = false;
    }
    if (window.tvCrtLight) {
        window.tvCrtLight.intensity = 0.0;
        window.tvCrtLight.visible = false;
    }
    // Dynamic emission from the screen illuminating the chassis and bezel
    if (window.tvBezelLight) {
        window.tvBezelLight.visible = true;
        if (window.tvCrtLight) {
            window.tvBezelLight.color.copy(window.tvCrtLight.color);
        }
        // Realistic CRT ambient chassis glow with subtle pulse
        const flicker = 1.0 + Math.sin(now * 0.035) * 0.08 + Math.sin(now * 0.007) * 0.04;
        window.tvBezelLight.intensity = 4.2 * flicker;
    }
    if (window.tvBasePosition) {
        const bob = Math.sin(now * 0.0015) * 0.04;
        window.tvBasePosition.y = -3.2 + bob;
    }

    // Update TV Pulsar Light (Fades in and out, teleports when fully faded out, disabled when focused)
    if (window.tvPulsarLight && window.relocateTvPulsar) {
        if (isTVFocused) {
            window.tvPulsarLight.intensity = 0.0;
        } else {
            const pulseSpeed = 1.8; // speed of pulsing
            const pulse = Math.sin(now * 0.001 * pulseSpeed);
            if (pulse > 0.0) {
                window.tvPulsarLight.intensity = pulse * 24.0; // peak intensity
                window.wasPulsarOff = false;
            } else {
                window.tvPulsarLight.intensity = 0.0;
                if (!window.wasPulsarOff) {
                    window.relocateTvPulsar();
                    window.wasPulsarOff = true;
                }
            }
        }
    }

    // Update TV Cable Physics & Mesh
    if (window.tvCordNodes && window.tvCableMesh && window.tvCableCurve && window.tvCordAttachPoint) {
        const numNodes = window.tvCordNodes.length;
        const nodes = window.tvCordNodes;
        const segmentLength = window.tvCordSegmentLength;
        
        // Get current attach point
        const attachPos = new THREE.Vector3();
        window.tvCordAttachPoint.getWorldPosition(attachPos);
        
        // Pin start node to TV
        nodes[0].pos.copy(attachPos);
        nodes[0].prevPos.copy(attachPos);
        
        // Pin end node to water floor anchor
        const anchorPos = new THREE.Vector3(0, -2.5, -0.5);
        nodes[numNodes - 1].pos.copy(anchorPos);
        nodes[numNodes - 1].prevPos.copy(anchorPos);
        
        // Apply gravity & verlet integration (clamp dt to prevent explosions on tab focus lags)
        const physDt = Math.min(deltaTime, 0.03); 
        const gravity = new THREE.Vector3(0, -9.8, 0);
        const dtSq = physDt * physDt;
        const damping = 0.97;
        
        const waveTime = now * 0.0015;
        for (let i = 1; i < numNodes - 1; i++) {
            const node = nodes[i];
            const temp = node.pos.clone();
            
            // pos = pos + (pos - prev) * damping + grav * dt^2
            node.pos.addScaledVector(node.pos.clone().sub(node.prevPos), damping);
            node.pos.addScaledVector(gravity, dtSq);
            
            // Apply water current / drag force if submerged (below water level y = -1.8)
            if (node.pos.y < -1.8) {
                const submergence = Math.min(1.0, (-1.8 - node.pos.y) / 0.7);
                // Current drift towards positive X (flows to the right)
                // Add some sinusoidal wave dynamics for natural water motion
                const forceX = (2.2 + Math.sin(waveTime * 2.5 + i * 0.5) * 1.5) * submergence;
                const forceZ = (Math.cos(waveTime * 1.8 + i * 0.4) * 1.0) * submergence;
                
                node.pos.addScaledVector(new THREE.Vector3(forceX, 0, forceZ), dtSq * 6.0);
            }
            
            node.prevPos.copy(temp);
        }
        
        // Solve constraints (distance locks)
        for (let iter = 0; iter < 6; iter++) {
            nodes[0].pos.copy(attachPos);
            nodes[numNodes - 1].pos.copy(anchorPos);
            
            for (let i = 0; i < numNodes - 1; i++) {
                const nA = nodes[i];
                const nB = nodes[i+1];
                const diff = nB.pos.clone().sub(nA.pos);
                const dist = diff.length();
                if (dist > 0.0001) {
                    const error = (segmentLength - dist) / dist;
                    const correction = diff.multiplyScalar(error * 0.5);
                    if (i > 0) nA.pos.sub(correction);
                    if (i < numNodes - 2) nB.pos.add(correction);
                }
            }
        }
        
        // Update geometry (only every 2 frames to drastically reduce CPU garbage collection and GPU upload overhead)
        window._cableFrameToggle = !window._cableFrameToggle;
        if (window._cableFrameToggle) {
            window.tvCableCurve.points = nodes.map(n => n.pos);
            if (window.tvCableMesh.geometry) window.tvCableMesh.geometry.dispose();
            window.tvCableMesh.geometry = new THREE.TubeGeometry(window.tvCableCurve, 20, 0.04, 6, false);
        }
    }

    // Update time of day (void reactive environment)
    updateEnvironmentFromTime();

    // FPS Counter
    frameCount++;
    const time = performance.now();
    if (time >= lastTime + 1000) {
        fpsElement.innerText = 'FPS: ' + Math.round((frameCount * 1000) / (time - lastTime));
        frameCount = 0;
        lastTime = time;
    }

    // Monolith resting in water with diagonal corner submersion (submerged much deeper)
    if (cuboidGroup) {
        const t = time * 0.001;
        // Diagonal pitch and roll: bottom corner dips deep under water
        cuboidGroup.rotation.x = -Math.PI / 2.6 + Math.sin(t * 0.7) * 0.03;
        cuboidGroup.rotation.y = 0.38 + Math.cos(t * 0.5) * 0.03;
        cuboidGroup.rotation.z = -0.35 + Math.sin(t * 0.6) * 0.02;
        cuboidGroup.position.y = -2.1 + Math.sin(t * 1.1) * 0.04;
    }

    // Rotate background stars slowly
    if (params.particles && starField) {
        starField.rotation.y += 0.0003;
        starField.rotation.x += 0.0001;
    }

    // Animate Red Blocks — direct array iteration, no traverse() overhead
    if (redBlocks.length > 0) {
        const t = time * 0.001;
        const minZ = -0.06 + params.whiteOffset + 0.015;
        for (let i = 0; i < redBlocks.length; i++) {
            const c = redBlocks[i];
            const wave = Math.sin(t * c.userData.animSpeed + c.userData.animPhase) * c.userData.animRange * params.animMult;
            const targetZ = -0.06 + params.redOffset + wave;
            c.position.z = targetZ < minZ ? minZ : targetZ;
        }
    }

    if (isTVFocused) {
        // Disable OrbitControls input processing
        controls.enabled = false;

        // In aerial top-down mode, keep standard up vector (0, 0, -1) so the TV screen is right side up (North is up)
        const tvWorldPos = new THREE.Vector3();
        if (window.tvGroup) window.tvGroup.getWorldPosition(tvWorldPos);
        else tvWorldPos.set(0, -2.9, 8.0);

        // Smoothly interpolate the focus distance (zoom)
        tvFocusDistance = THREE.MathUtils.lerp(tvFocusDistance, 4.2, 0.08);

        // Smoothly interpolate the look-around offsets
        currentTvYaw = THREE.MathUtils.lerp(currentTvYaw, tvYaw, 0.1);
        currentTvPitch = THREE.MathUtils.lerp(currentTvPitch, tvPitch, 0.1);

        // Position camera directly above the TV looking straight down
        camera.position.x = THREE.MathUtils.lerp(camera.position.x, tvWorldPos.x, 0.08);
        camera.position.y = THREE.MathUtils.lerp(camera.position.y, tvWorldPos.y + tvFocusDistance, 0.08);
        camera.position.z = THREE.MathUtils.lerp(camera.position.z, tvWorldPos.z + 0.1, 0.08);

        // Standard aerial camera up vector pointing along -Z (North)
        camera.up.set(0, 0, -1);

        camera.lookAt(tvWorldPos.x + currentTvYaw, tvWorldPos.y, tvWorldPos.z + currentTvPitch);
    } else {
        // If we are currently in the exit focus transition
        if (isExitingTV) {
            controls.enabled = false;

            // Smoothly glide camera position back to State 2 (TV Aerial view)
            camera.position.x = THREE.MathUtils.lerp(camera.position.x, 0.0, 0.11);
            camera.position.y = THREE.MathUtils.lerp(camera.position.y, 8.5, 0.11);
            camera.position.z = THREE.MathUtils.lerp(camera.position.z, 9.5, 0.11);

            camera.up.set(0, 0, -1);
            camera.lookAt(0, -2.5, 9.5);

            if (Date.now() - tvExitStartTime >= 400) {
                isExitingTV = false;
                targetStageIndex = 1;
                fromCamPos.copy(CAMERA_STAGES[1].cam);
                toCamPos.copy(CAMERA_STAGES[1].cam);
                fromTargetPos.copy(CAMERA_STAGES[1].target);
                toTargetPos.copy(CAMERA_STAGES[1].target);
                fromUpVec.copy(CAMERA_STAGES[1].up);
                toUpVec.copy(CAMERA_STAGES[1].up);
                stageTransition = 1.0;

                camera.position.set(0, 8.5, 9.5);
                camera.up.set(0, 0, -1);
                camera.lookAt(0, -2.5, 9.5);
            }
        } else {
            // Smoothly interpolate stage transition (Fast, crisp & silky 60fps response)
            stageTransition = THREE.MathUtils.lerp(stageTransition, 1.0, 0.085);
            const t = THREE.MathUtils.smoothstep(stageTransition, 0.0, 1.0);

            const curCamPos = fromCamPos.clone().lerp(toCamPos, t);
            const curTargetPos = fromTargetPos.clone().lerp(toTargetPos, t);
            const curUpVec = fromUpVec.clone().lerp(toUpVec, t);
            if (curUpVec.lengthSq() > 0.001) curUpVec.normalize();

            if (isCameraLocked) {
                controls.enabled = false;
                camera.position.copy(curCamPos);
                camera.up.copy(curUpVec);
                camera.lookAt(curTargetPos);
                controls.target.copy(curTargetPos);
            } else {
                controls.enabled = true;
                controls.target.copy(curTargetPos);
                controls.update();

                if (camera.position.y < -1.90) {
                    camera.position.y = -1.90;
                }
            }

            scrollProgress = (targetStageIndex === 1) ? 0.5 : (targetStageIndex === 2 ? 1.0 : 0.0);
        }
    }

    // Update TV scene overlay & Logo opacity (Visible in Stage 2 [TV] and Stage 3 [Monolith Submerged], Hidden in Stage 1)
    const t = THREE.MathUtils.smoothstep(stageTransition, 0.0, 1.0);
    const fromHasOverlay = (fromStageIndex === 1 || fromStageIndex === 2);
    const toHasOverlay = (targetStageIndex === 1 || targetStageIndex === 2);
    let tvOverlayOpacity = 0.0;

    if (isTVFocused) {
        tvOverlayOpacity = 0.65;
    } else if (isCameraLocked) {
        if (fromHasOverlay && toHasOverlay) {
            tvOverlayOpacity = 1.0; // Stays fully visible between Stage 2 and Stage 3!
        } else if (!fromHasOverlay && toHasOverlay) {
            tvOverlayOpacity = t;   // Transitions 0.0 -> 1.0 entering Stage 2
        } else if (fromHasOverlay && !toHasOverlay) {
            tvOverlayOpacity = 1.0 - t; // Transitions 1.0 -> 0.0 returning to Stage 1
        } else {
            tvOverlayOpacity = 0.0; // Stage 1 (Hidden)
        }
    } else {
        const targetY = controls ? controls.target.y : camera.position.y;
        tvOverlayOpacity = Math.max(0, Math.min(1, (5.0 - targetY) / 3.0));
    }
    
    const tvOverlayEl = document.getElementById('tv-scene-overlay');
    if (tvOverlayEl) {
        tvOverlayEl.style.opacity = tvOverlayOpacity;
        if (tvOverlayOpacity > 0.05) {
            tvOverlayEl.style.pointerEvents = 'auto';
        } else {
            tvOverlayEl.style.pointerEvents = 'none';
        }
    }

    // Neobrutalism TV Side Carousel: active only on Stage 2 (TV view)
    let nbCarouselOpacity = 0.0;
    if (isCameraLocked) {
        if (targetStageIndex === 1 && fromStageIndex === 1) {
            nbCarouselOpacity = 1.0;
        } else if (targetStageIndex === 1) {
            nbCarouselOpacity = t;
        } else if (fromStageIndex === 1) {
            nbCarouselOpacity = 1.0 - t;
        } else {
            nbCarouselOpacity = 0.0;
        }
    } else {
        nbCarouselOpacity = tvOverlayOpacity;
    }

    const nbCarouselEl = document.getElementById('neobrutalism-tv-carousel-container');
    if (nbCarouselEl) {
        nbCarouselEl.style.opacity = nbCarouselOpacity;
        if (nbCarouselOpacity > 0.05) {
            nbCarouselEl.style.pointerEvents = 'auto';
            nbCarouselEl.classList.add('is-tv-visible');
        } else {
            nbCarouselEl.style.pointerEvents = 'none';
            nbCarouselEl.classList.remove('is-tv-visible');
        }
    }

    // Update 3-way tagline text transitions with zero superposition guarantee
    let distorsionaOpacity = 0.0;
    let comienzaOpacity = 0.0;
    let sumergidoOpacity = 0.0;

    if (isTVFocused) {
        distorsionaOpacity = 0.0;
        comienzaOpacity = 0.0;
        sumergidoOpacity = 0.0;
    } else if (isCameraLocked) {
        // Active incoming stage gets opacity t
        if (targetStageIndex === 0) distorsionaOpacity = t;
        else if (targetStageIndex === 1) comienzaOpacity = t;
        else if (targetStageIndex === 2) sumergidoOpacity = t;

        // Active outgoing stage gets opacity (1.0 - t)
        if (fromStageIndex !== targetStageIndex) {
            if (fromStageIndex === 0) distorsionaOpacity = 1.0 - t;
            else if (fromStageIndex === 1) comienzaOpacity = 1.0 - t;
            else if (fromStageIndex === 2) sumergidoOpacity = 1.0 - t;
        } else {
            // Already settled
            if (targetStageIndex === 0) distorsionaOpacity = 1.0;
            else if (targetStageIndex === 1) comienzaOpacity = 1.0;
            else if (targetStageIndex === 2) sumergidoOpacity = 1.0;
        }
    } else {
        const targetY = controls ? controls.target.y : camera.position.y;
        distorsionaOpacity = Math.max(0, Math.min(1, (targetY - 5.5) / 4.0));
        comienzaOpacity = Math.max(0, Math.min(1, (7.5 - targetY) / 4.0));
    }

    const distEl = document.getElementById('tagline-distorsiona');
    const comEl = document.getElementById('tagline-comienza');
    const sumEl = document.getElementById('tagline-sumergido');
    if (distEl) distEl.style.opacity = distorsionaOpacity;
    if (comEl) comEl.style.opacity = comienzaOpacity;
    if (sumEl) sumEl.style.opacity = sumergidoOpacity;

    // Liquid floor: update time and sun direction uniforms
    if (liquidFloor && liquidFloor.visible) {
        liquidFloorMat.uniforms.uTime.value = time * 0.001;
        if (dirLight) {
            liquidFloorMat.uniforms.uSunDirection.value.copy(dirLight.position).normalize();
        }
    }
    if (liquidFloorReal && liquidFloorReal.visible) {
        liquidFloorReal.material.uniforms[ 'time' ].value = time * 0.001 * 0.95;
        liquidFloorReal.material.uniforms[ 'sunDirection' ].value.set(0.0, 1.0, 0.0);
        // Update displacement uniforms for THREE.Water shader
        if (window._waterRealShader) {
            window._waterRealShader.uniforms.uWaterTime.value = time * 0.001;
            if (window.tvCrtScreen || window.tvGroup) {
                const tvWorldPos = new THREE.Vector3();
                if (window.tvCrtScreen) {
                    window.tvCrtScreen.getWorldPosition(tvWorldPos);
                } else {
                    window.tvGroup.getWorldPosition(tvWorldPos);
                }
                window._waterRealShader.uniforms.uObjPos.value.set(tvWorldPos.x, tvWorldPos.z);
            }
            if (cuboidGroup) {
                const monoWorldPos = new THREE.Vector3();
                cuboidGroup.getWorldPosition(monoWorldPos);
                window._waterRealShader.uniforms.uMonolithPos.value.set(monoWorldPos.x, monoWorldPos.z);
            }
        }
    }
    // Update TV displacement uniforms for custom shader too
    if (liquidFloorMat && window.tvGroup) {
        const tvWorldPos2 = new THREE.Vector3();
        window.tvGroup.getWorldPosition(tvWorldPos2);
        liquidFloorMat.uniforms.uObjPos.value.set(tvWorldPos2.x, tvWorldPos2.z);
    }

    // Animate and float clouds
    if (cloudsGroup && clouds.length > 0) {
        const t = time * 0.001;
        for (let i = 0; i < clouds.length; i++) {
            const c = clouds[i];
            c.rotation.z += c.userData.rotSpeed;
            c.position.y = c.userData.baseY + Math.sin(t * c.userData.floatSpeed + c.userData.floatPhase) * 0.12;
        }
        // Update time uniform shared across the material
        clouds[0].material.uniforms.uTime.value = t;

        // Animate close-up traversing mist planes for Act 1
        if (window.act1MistPlanes && window.act1MistPlanes.length > 0) {
            for (let i = 0; i < window.act1MistPlanes.length; i++) {
                const m = window.act1MistPlanes[i];
                // Float X across the screen
                m.position.x += deltaTime * m.userData.speedX;
                
                // Wrap around X depending on drift direction
                if (m.userData.speedX > 0 && m.position.x > 24.0) {
                    m.position.x = -24.0;
                    m.position.y = m.userData.baseY + (Math.random() - 0.5) * 4.0;
                } else if (m.userData.speedX < 0 && m.position.x < -24.0) {
                    m.position.x = 24.0;
                    m.position.y = m.userData.baseY + (Math.random() - 0.5) * 4.0;
                }
                
                // Slow rotation in camera plane
                m.userData.currentRot += m.userData.rotSpeed * deltaTime * 12.0;
                m.quaternion.copy(camera.quaternion);
                m.rotateZ(m.userData.currentRot);
                
                // Slow vertical bobbing
                m.position.y = m.userData.baseY + Math.sin(t * m.userData.floatSpeed + m.userData.floatPhase) * 0.35;
            }
        }
        
        // Update time uniform for Act 1 mist material
        if (window.act1MistMaterial) {
            window.act1MistMaterial.uniforms.uTime.value = t;
        }
    }

    // Animate rising water particles with horizontal current drift (positive X)
    if (waterParticles && waterParticleGeometry) {
        const positions = waterParticleGeometry.attributes.position.array;
        const colors = waterParticleGeometry.attributes.color.array;
        const count = positions.length / 3;
        const driftSpeed = 1.2;
        
        for (let i = 0; i < count; i++) {
            positions[i * 3 + 1] += deltaTime * waterParticleSpeeds[i];
            positions[i * 3] += deltaTime * driftSpeed;
            
            // Recycle particle if it floats too high or too far right
            if (positions[i * 3 + 1] > 16.0 || positions[i * 3] > 35.0) {
                // Spawn randomly across the entire X/Z space so they rise uniformly from the whole water surface
                positions[i * 3] = (Math.random() - 0.5) * 70.0;
                positions[i * 3 + 1] = -2.0 + Math.random() * 2.0;
                positions[i * 3 + 2] = (Math.random() - 0.5) * 70.0;
                waterParticleSpeeds[i] = 0.5 + Math.random() * 1.5;
            }

            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];
            
            const ratioY = Math.max(0, Math.min(1, (y - (-2.0)) / 18.0));
            const fadeY = 1.0 - ratioY;
            
            const ratioX = Math.max(0, Math.min(1, Math.abs(x) / 35.0));
            const fadeX = 1.0 - ratioX;
            
            const ratioZ = Math.max(0, Math.min(1, Math.abs(z) / 35.0));
            const fadeZ = 1.0 - ratioZ;
            
            const totalFade = fadeX * fadeY * fadeZ;

            const c = window.waterParticleBaseColors[i];
            colors[i * 3] = c.r * totalFade;
            colors[i * 3 + 1] = c.g * totalFade;
            colors[i * 3 + 2] = c.b * totalFade;
        }
        
        waterParticleGeometry.attributes.position.needsUpdate = true;
        waterParticleGeometry.attributes.color.needsUpdate = true;
    }

    // Update organic tentacles cluster hugging monolith and TV
    if (typeof updateTentacles === 'function') {
        updateTentacles(now * 0.001, deltaTime);
    }

    renderer.render(scene, camera);
}
