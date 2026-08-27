let updateTV = null;

function loadTVModel() {
    // Create soft ambient fill light for TV (disabled harsh spotlight to maintain dark moody void)
    const tvSpotlight = new THREE.SpotLight(0xffffff, 0.0, 30.0, Math.PI / 3.5, 0.6, 1.2);
    tvSpotlight.visible = false;
    scene.add(tvSpotlight);
    window.tvSpotlight = tvSpotlight;
    
    const tvSpotTarget = new THREE.Object3D();
    tvSpotTarget.position.set(0.0, -3.2, 9.5); // Target the TV center
    scene.add(tvSpotTarget);
    tvSpotlight.target = tvSpotTarget;

    // Load using the compiled UMD bundle
    window.KimerawareTV.loadTV(scene, controls, tvSpotlight, tvSpotTarget)
        .then((tv) => {
            updateTV = tv.update;
            window.tvProgress = 100;
            window.updateOverallProgress();
            window.tvGroup = tv.tvGroup;
            window.tvCrtScreen = tv.crtScreen;
            window.tvBasePosition = tv.basePosition;
            window.tvInternalCabinetLight = tv.internalCabinetLight;
            
            // Position TV downstream to the South and subtly shifted right (X = 0.7, Z = 11.5, Y = -3.3) submerged in the water
            tv.basePosition.set(0.7, -3.3, 11.5);
            
            // Scale the TV
            tv.tvGroup.scale.setScalar(2.0 * (window.innerWidth < 768 ? 0.65 : 1.0));
            
            // Orient TV pointing North, tilted upwards towards aerial camera with diagonal roll (one corner sunken deeper)
            tv.tvGroup.rotation.x = -Math.PI / 2.05;
            tv.tvGroup.rotation.y = 0.0;
            tv.tvGroup.rotation.z = 0.22;


            // Create a non-invasive pulsar PointLight (disabled to prevent harsh glare)
            const pulsarLight = new THREE.PointLight(0xffffff, 0.0, 5.0, 1.2);
            pulsarLight.visible = false;
            scene.add(pulsarLight);
            window.tvPulsarLight = pulsarLight;

            // --- CABLE INJECTION ---
            // Create attachment point at the back of the TV
            const cordAttachPoint = new THREE.Object3D();
            cordAttachPoint.position.set(0, 1.4, -1.15); // middle-upper back of TV cabinet
            tv.tvGroup.add(cordAttachPoint);
            window.tvCordAttachPoint = cordAttachPoint;
            
            // Verlet nodes initialization
            const numNodes = 12;
            const nodes = [];
            const cableLength = 3.6; // loose hang
            const segmentLength = cableLength / (numNodes - 1);
            
            // Get initial positions
            const attachPos = new THREE.Vector3();
            cordAttachPoint.getWorldPosition(attachPos);
            const anchorPos = new THREE.Vector3(0, -2.5, -0.5); // anchor point below water
            
            for (let i = 0; i < numNodes; i++) {
                const t = i / (numNodes - 1);
                const pos = new THREE.Vector3().lerpVectors(attachPos, anchorPos, t);
                nodes.push({
                    pos: pos.clone(),
                    prevPos: pos.clone()
                });
            }
            window.tvCordNodes = nodes;
            window.tvCordSegmentLength = segmentLength;
            
            // Create Mesh for the cable
            const curvePoints = nodes.map(n => n.pos);
            const cableCurve = new THREE.CatmullRomCurve3(curvePoints);
            const cableGeometry = new THREE.TubeGeometry(cableCurve, 20, 0.04, 6, false);
            const cableMaterial = new THREE.MeshStandardMaterial({
                color: 0x07070a, // deep matte black/dark grey cord
                roughness: 0.85,
                metalness: 0.05
            });
            const cableMesh = new THREE.Mesh(cableGeometry, cableMaterial);
            scene.add(cableMesh);
            window.tvCableMesh = cableMesh;
            window.tvCableCurve = cableCurve;

            // PointLight hovering in front of the screen to illuminate the TV bezel and chassis
            window.tvCrtLight = tv.crtLight;
            if (tv.crtLight) {
                tv.crtLight.visible = false;
                tv.crtLight.intensity = 0.0;
            }
            if (tv.internalCabinetLight) {
                tv.internalCabinetLight.visible = false;
                tv.internalCabinetLight.intensity = 0.0;
            }
            
            // Hover light slightly in front of the screen (+Z in screen local space) to illuminate plastic chassis
            const bezelLight = new THREE.PointLight(0xaadcff, 3.5, 3.8, 1.2);
            bezelLight.position.set(0, 1.3, 0.65);
            tv.tvGroup.add(bezelLight);
            window.tvBezelLight = bezelLight;

            // Ambient fill light for tentacles around TV so their fleshy textures glow nicely
            const tvTentacleLight = new THREE.PointLight(0x88bbff, 3.0, 12.0, 1.5);
            tvTentacleLight.position.set(0, 1.4, 0);
            tv.tvGroup.add(tvTentacleLight);
            window.tvTentacleLight = tvTentacleLight;

            // Repositioning logic for pulsar (teleport to a new random angle/height around the TV)
            window.relocateTvPulsar = function() {
                const angle = Math.random() * Math.PI * 2;
                const distance = 1.3 + Math.random() * 0.9; // 1.3 to 2.2 units away
                const height = -0.3 + Math.random() * 1.2;  // vertical spread around TV
                
                pulsarLight.color.setHex(0xffffff); // Matches key/interior lights
                
                pulsarLight.position.set(
                    tv.basePosition.x + Math.sin(angle) * distance,
                    tv.basePosition.y + 1.2 + height,
                    tv.basePosition.z + Math.cos(angle) * distance
                );
            };
            window.wasPulsarOff = false;
            window.relocateTvPulsar();

            // Restore camera target since loadTV alters it
            controls.target.set(0, 15.0, 0);
            controls.minDistance = 10;
            controls.maxDistance = 10;
        })
        .catch((error) => {
            console.error('Error loading TV Model:', error);
        });
}
