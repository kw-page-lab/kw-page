// Procedural Kinetic Organic Tentacles System v3-r63
// Curled Fleshy Cephalopod Tips on TV + Sinuous Living Muscle Flexion

(function() {
    let tMat = null;

    function createFleshColorMap() {
        const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
        x.fillStyle = '#5c1018'; x.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 140; i++) {
            const sx = Math.random() * 512, sy = Math.random() * 512, len = 40 + Math.random() * 140, a = Math.random() * Math.PI;
            x.strokeStyle = `rgba(${160+Math.random()*60},${18+Math.random()*30},${25+Math.random()*25},${0.20+Math.random()*0.25})`;
            x.lineWidth = 1.5 + Math.random() * 4.5; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len); x.stroke();
        }
        for (let i = 0; i < 70; i++) {
            const sx = Math.random() * 512, sy = Math.random() * 512;
            x.strokeStyle = `rgba(${90+Math.random()*35},${8+Math.random()*18},${14+Math.random()*20},${0.30+Math.random()*0.35})`;
            x.lineWidth = 0.6 + Math.random() * 1.8; x.beginPath(); x.moveTo(sx, sy); let cx = sx, cy = sy;
            for (let s = 0; s < 6 + Math.random() * 8; s++) { cx += (Math.random() - 0.5) * 40; cy += (Math.random() - 0.5) * 40; x.lineTo(cx, cy); } x.stroke();
        }
        for (let i = 0; i < 220; i++) {
            const px = Math.random() * 512, py = Math.random() * 512, r = Math.random() * 14 + 2;
            const g = x.createRadialGradient(px, py, 0, px, py, r);
            g.addColorStop(0, `rgba(${190+Math.random()*65},${35+Math.random()*45},${35+Math.random()*35},${0.12+Math.random()*0.15})`);
            g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
        }
        const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3); return t;
    }

    function createFleshBumpMap() {
        const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
        x.fillStyle = '#808080'; x.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 350; i++) {
            const px = Math.random() * 512, py = Math.random() * 512, r = Math.random() * 9 + 1, b = 110 + Math.random() * 90;
            const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(${b},${b},${b},0.35)`); g.addColorStop(1, 'rgba(128,128,128,0)');
            x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
        }
        for (let i = 0; i < 900; i++) {
            x.fillStyle = `rgba(${50+Math.random()*50},${50+Math.random()*50},${50+Math.random()*50},0.45)`;
            x.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
        }
        const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 4); return t;
    }

    function createFleshRoughnessMap() {
        const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
        x.fillStyle = '#222'; x.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 180; i++) {
            const px = Math.random() * 256, py = Math.random() * 256, r = Math.random() * 16 + 3;
            const g = x.createRadialGradient(px, py, 0, px, py, r);
            g.addColorStop(0, `rgba(${70+Math.random()*50},${70+Math.random()*50},${70+Math.random()*50},0.4)`);
            g.addColorStop(1, 'rgba(34,34,34,0)'); x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
        }
        const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 4); return t;
    }

    function getTentacleMaterial() {
        if (!tMat) {
            tMat = new THREE.MeshStandardMaterial({
                map: createFleshColorMap(),
                bumpMap: createFleshBumpMap(),
                bumpScale: 0.10,
                roughnessMap: createFleshRoughnessMap(),
                roughness: 0.16,
                metalness: 0.12,
                color: 0xdf2828,
                emissive: 0x2e060a,
                side: THREE.DoubleSide,
                transparent: false
            });
            tMat.onBeforeCompile = (shader) => {
                shader.uniforms.uWaterSurfaceY = { value: -2.0 };
                shader.vertexShader = `
                    varying vec3 vWorldPositionCustom;
                    ${shader.vertexShader}
                `.replace('#include <worldpos_vertex>',
                    `#include <worldpos_vertex>
                    vWorldPositionCustom = (modelMatrix * vec4(transformed, 1.0)).xyz;`
                );
                shader.fragmentShader = `
                    uniform float uWaterSurfaceY;
                    varying vec3 vWorldPositionCustom;
                    ${shader.fragmentShader}
                `.replace('#include <dithering_fragment>',
                    `#include <dithering_fragment>
                    if (vWorldPositionCustom.y < uWaterSurfaceY) {
                        float depthBelowWater = uWaterSurfaceY - vWorldPositionCustom.y;
                        float absorbFactor = clamp(depthBelowWater * 0.35, 0.0, 0.65);
                        vec3 waterMurkColor = vec3(0.08, 0.02, 0.028);
                        gl_FragColor.rgb = mix(gl_FragColor.rgb * (1.0 - absorbFactor * 0.35), waterMurkColor, absorbFactor * 0.30);
                    }`
                );
            };
        }
        return tMat;
    }

    // ===================== ACCURATE ASYMMETRIC TV & MONOLITH COLLISION =====================
    const _delta = new THREE.Vector3();

    function collideObjectFlesh(point, bPos, bQuat, bInvQuat, isTV, bHalfSize, fleshRadius) {
        const safeR = fleshRadius + 0.005;
        _delta.subVectors(point, bPos).applyQuaternion(bInvQuat);
        let lx = _delta.x, ly = _delta.y, lz = _delta.z;

        if (isTV) {
            const hw = 1.95, hh = 1.70, minZ = -1.65, maxZ = 0.00;
            const cx = Math.max(-hw, Math.min(hw, lx));
            const cy = Math.max(-hh, Math.min(hh, ly));
            const cz = Math.max(minZ, Math.min(maxZ, lz));

            const dx = lx - cx, dy = ly - cy, dz = lz - cz;
            const distSq = dx * dx + dy * dy + dz * dz;

            if (distSq > 1e-6) {
                const dist = Math.sqrt(distSq);
                if (dist < safeR) {
                    const push = (safeR - dist) / dist;
                    _delta.set(lx + dx * push, ly + dy * push, lz + dz * push);
                    point.copy(_delta).applyQuaternion(bQuat).add(bPos);
                    return (safeR - dist) / safeR;
                }
                return 0;
            } else {
                const dxp = hw - lx, dxn = hw + lx;
                const dyp = hh - ly, dyn = hh + ly;
                const dzp = maxZ - lz;
                const dzn = lz - minZ;
                const minDist = Math.min(dxp, dxn, dyp, dyn, dzp, dzn);

                if (minDist === dzp)      _delta.z = maxZ + safeR;
                else if (minDist === dxp) _delta.x = hw + safeR;
                else if (minDist === dxn) _delta.x = -hw - safeR;
                else if (minDist === dyp) _delta.y = hh + safeR;
                else if (minDist === dyn) _delta.y = -hh - safeR;
                else                      _delta.z = minZ - safeR;

                point.copy(_delta).applyQuaternion(bQuat).add(bPos);
                return 1.0;
            }

        } else {
            const BHW = bHalfSize.x, BHH = bHalfSize.y, BHD = bHalfSize.z;
            const cx = Math.max(-BHW, Math.min(BHW, lx));
            const cy = Math.max(-BHH, Math.min(BHH, ly));
            const cz = Math.max(-BHD, Math.min(BHD, lz));

            const dx = lx - cx, dy = ly - cy, dz = lz - cz;
            const distSq = dx * dx + dy * dy + dz * dz;

            if (distSq > 1e-6) {
                const dist = Math.sqrt(distSq);
                if (dist < safeR) {
                    const push = (safeR - dist) / dist;
                    _delta.set(lx + dx * push, ly + dy * push, lz + dz * push);
                    point.copy(_delta).applyQuaternion(bQuat).add(bPos);
                    return (safeR - dist) / safeR;
                }
                return 0;
            } else {
                const dxp = BHW - lx, dxn = BHW + lx;
                const dyp = BHH - ly, dyn = BHH + ly;
                const dzp = BHD - lz, dzn = BHD + lz;
                const minDist = Math.min(dxp, dxn, dyp, dyn, dzp, dzn);

                if (minDist === dxp)      _delta.x = BHW + safeR;
                else if (minDist === dxn) _delta.x = -BHW - safeR;
                else if (minDist === dyp) _delta.y = BHH + safeR;
                else if (minDist === dyn) _delta.y = -BHH - safeR;
                else if (minDist === dzp) _delta.z = BHD + safeR;
                else                      _delta.z = -BHD - safeR;

                point.copy(_delta).applyQuaternion(bQuat).add(bPos);
                return 1.0;
            }
        }
    }

    function pushMeshVertex(v, bPos, bQuat, bInvQuat, isTV, bHalfSize) {
        _delta.subVectors(v, bPos).applyQuaternion(bInvQuat);
        let lx = _delta.x, ly = _delta.y, lz = _delta.z;
        const margin = 0.003;

        if (isTV) {
            const hw = 1.95, hh = 1.70, minZ = -1.65, maxZ = 0.00;
            if (Math.abs(lx) <= hw && Math.abs(ly) <= hh && lz >= minZ && lz <= maxZ) {
                const dxp = hw - lx, dxn = hw + lx;
                const dyp = hh - ly, dyn = hh + ly;
                const dzp = maxZ - lz, dzn = lz - minZ;
                const minDist = Math.min(dxp, dxn, dyp, dyn, dzp, dzn);

                if (minDist === dzp)      _delta.z = maxZ + margin;
                else if (minDist === dxp) _delta.x = hw + margin;
                else if (minDist === dxn) _delta.x = -hw - margin;
                else if (minDist === dyp) _delta.y = hh + margin;
                else if (minDist === dyn) _delta.y = -hh - margin;
                else                      _delta.z = minZ - margin;

                v.copy(_delta).applyQuaternion(bQuat).add(bPos);
            }
        } else {
            const BHW = bHalfSize.x, BHH = bHalfSize.y, BHD = bHalfSize.z;
            if (Math.abs(lx) <= BHW && Math.abs(ly) <= BHH && Math.abs(lz) <= BHD) {
                const dxp = BHW - lx, dxn = BHW + lx;
                const dyp = BHH - ly, dyn = BHH + ly;
                const dzp = BHD - lz, dzn = BHD + lz;
                const minDist = Math.min(dxp, dxn, dyp, dyn, dzp, dzn);

                if (minDist === dxp)      _delta.x = BHW + margin;
                else if (minDist === dxn) _delta.x = -BHW - margin;
                else if (minDist === dyp) _delta.y = BHH + margin;
                else if (minDist === dyn) _delta.y = -BHH - margin;
                else if (minDist === dzp) _delta.z = BHD + margin;
                else                      _delta.z = -BHD - margin;

                v.copy(_delta).applyQuaternion(bQuat).add(bPos);
            }
        }
    }

    // ===================== SEGMENT-TO-SEGMENT 3D CAPSULE REPULSION =====================
    function closestSegmentSegment(p1, q1, p2, q2) {
        const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
        const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
        const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;

        const a = d1x * d1x + d1y * d1y + d1z * d1z;
        const e = d2x * d2x + d2y * d2y + d2z * d2z;
        const f = d2x * rx + d2y * ry + d2z * rz;

        if (a <= 1e-6 && e <= 1e-6) return { s: 0, t: 0 };
        if (a <= 1e-6) return { s: 0, t: Math.max(0, Math.min(1, f / e)) };

        const c = d1x * rx + d1y * ry + d1z * rz;
        if (e <= 1e-6) return { s: Math.max(0, Math.min(1, -c / a)), t: 0 };

        const b = d1x * d2x + d1y * d2y + d1z * d2z;
        const denom = a * e - b * b;
        let s = denom !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
        let t = (b * s + f) / e;

        if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
        else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }

        return { s, t };
    }

    // ===================== WORLD SPACE TENTACLE CLUSTER =====================
    class WorldTentacleCluster {
        constructor(centerPos, boxHalfSize, configs, options = {}) {
            this.center = centerPos.clone();
            this.bHalfSize = boxHalfSize.clone();
            this.waterSurfaceY = options.waterSurfaceY || -2.0;
            this.isTV = options.isTV || false;
            this.tentacles = [];
            this.clusterGroup = new THREE.Group();
            scene.add(this.clusterGroup);
            this._initHorde(configs);
        }

        _initHorde(hordeConfigs) {
            const cluster = this;

            class Tentacle {
                constructor(basePos, cfg) {
                    this.base = basePos.clone();
                    this.depth = cfg.depth || 2.4;
                    this.joints = cfg.joints || 60;
                    this.rBase = cfg.rBase || (cluster.isTV ? 0.28 : 0.23);
                    this.rTip = cfg.rTip || 0.015;
                    this.radSegs = 14;
                    this.segLen = cfg.segLen || 0.15;
                    this.behavior = cfg.behavior || 'constrict_low';
                    this.hugLayer = cfg.hugLayer || 0;
                    this.customParams = cfg.customParams || {};

                    this.breathFreq = 0.25 + Math.random() * 0.35;
                    this.breathPhase = Math.random() * Math.PI * 2;
                    this.breathAmp = 0.010 + Math.random() * 0.015;

                    this.driftSpeed1 = 0.3 + Math.random() * 0.5;
                    this.driftSpeed2 = 0.4 + Math.random() * 0.6;
                    this.driftPhase1 = Math.random() * Math.PI * 2;
                    this.driftPhase2 = Math.random() * Math.PI * 2;

                    this.tipWiggleSpeed = 0.9 + Math.random() * 1.5;
                    this.tipWigglePhase = Math.random() * Math.PI * 2;

                    const sv = 0.8 + Math.random() * 0.4;
                    this.speeds = [1, 0.8*sv, 0.11*sv, 0.05*sv, 0.035*sv, 0.03*sv, 0.025*sv];

                    this.baseRadii = [];
                    for (let i = 0; i < this.joints; i++) {
                        const t = i / (this.joints - 1);
                        this.baseRadii.push(this.rBase * Math.pow(1 - t, 0.8) + this.rTip);
                    }
                    this.radii = this.baseRadii.slice();
                    this.compression = new Float32Array(this.joints);

                    this.pulseWavePos = -10; this.pulseSpeed = 0; this.pulseCooldown = 1.5 + Math.random() * 5;
                    this.pulseTimer = Math.random() * this.pulseCooldown; this.pulseIntensity = 0;

                    this.cp = []; this.cpTarget = [];
                    for (let i = 0; i < 7; i++) {
                        const y = (cluster.waterSurfaceY - this.depth) + i * 0.6;
                        this.cp.push(new THREE.Vector3(this.base.x, y, this.base.z));
                        this.cpTarget.push(new THREE.Vector3(this.base.x, y, this.base.z));
                    }
                    this.skeleton = []; for (let i = 0; i < this.joints; i++) this.skeleton.push(new THREE.Vector3());

                    this.geometry = this._buildGeo();
                    this.mesh = new THREE.Mesh(this.geometry, getTentacleMaterial());
                    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
                    cluster.clusterGroup.add(this.mesh);
                }

                _buildGeo() {
                    const g = new THREE.BufferGeometry();
                    const vc = this.joints * this.radSegs, ic = (this.joints - 1) * this.radSegs * 6;
                    const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint32Array(ic);
                    let ii = 0;
                    for (let i = 0; i < this.joints - 1; i++) for (let j = 0; j < this.radSegs; j++) {
                        const nj = (j+1) % this.radSegs, a = i*this.radSegs+j, b = i*this.radSegs+nj, c = (i+1)*this.radSegs+j, d = (i+1)*this.radSegs+nj;
                        idx[ii++]=a; idx[ii++]=c; idx[ii++]=b; idx[ii++]=b; idx[ii++]=c; idx[ii++]=d;
                    }
                    for (let i = 0; i < this.joints; i++) for (let j = 0; j < this.radSegs; j++) {
                        const ui = (i*this.radSegs+j)*2; uv[ui]=j/this.radSegs; uv[ui+1]=i/(this.joints-1);
                    }
                    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
                    return g;
                }

                _getMonolithPerimeterPoint(angle, bPos, bQuat, layerMargin, heightParam) {
                    const cosA = Math.cos(angle), sinA = Math.sin(angle);
                    const hw = cluster.bHalfSize.x + layerMargin;
                    const hd = cluster.bHalfSize.z + layerMargin;
                    const n = 4.0;
                    const denom = Math.pow(Math.abs(cosA / hw), n) + Math.pow(Math.abs(sinA / hd), n);
                    const r = Math.pow(denom, -1 / n);
                    const pLocal = new THREE.Vector3(cosA * r, heightParam, sinA * r);
                    pLocal.applyQuaternion(bQuat);
                    return pLocal.add(bPos);
                }

                _computeTargets(time, bPos, bQuat) {
                    const bx = this.base.x, bz = this.base.z, waterY = cluster.waterSurfaceY;
                    const breath = Math.sin(time * this.breathFreq + this.breathPhase) * this.breathAmp;
                    const driftY = Math.sin(time * this.driftSpeed1 + this.driftPhase1) * 0.04;
                    const driftA = Math.cos(time * this.driftSpeed2 + this.driftPhase2) * 0.05;

                    const p = this.customParams;
                    const beh = this.behavior;

                    if (cluster.isTV) {
                        // ================= TV TARGETS: CURLED FLESHY CEPHALOPOD HOOKS =================
                        const screenPt = (sx, sy, szAltitude) => {
                            return new THREE.Vector3(sx, sy, szAltitude).applyQuaternion(bQuat).add(bPos);
                        };

                        const wY = Math.sin(time * this.tipWiggleSpeed + this.tipWigglePhase) * 0.045;
                        const wX = Math.cos(time * this.tipWiggleSpeed * 0.85 + this.tipWigglePhase) * 0.040;

                        if (beh === 'bezel_grip_right') {
                            // #1. Flanco derecho: Espiral en J-Hook carnosa que se enrosca hacia arriba
                            this.cpTarget[0].copy(screenPt(2.50, -1.0 + driftY * 0.2, -1.30));
                            this.cpTarget[1].copy(screenPt(2.45, -0.6 + driftY * 0.2, -0.75));
                            this.cpTarget[2].copy(screenPt(2.35, -0.2 + driftY * 0.15, -0.25));
                            this.cpTarget[3].copy(screenPt(2.20, 0.00 + driftY * 0.15, 0.18));
                            this.cpTarget[4].copy(screenPt(1.85, 0.08 + driftY * 0.1, 0.22));
                            this.cpTarget[5].copy(screenPt(1.35, 0.02 + wY, 0.12));
                            this.cpTarget[6].copy(screenPt(1.02 + wX, 0.32 + wY, 0.03 + breath * 0.01));

                        } else if (beh === 'bezel_corner_topright') {
                            // #2. Esquina superior derecha: Garra helicoidal enroscada diagonalmente
                            this.cpTarget[0].copy(screenPt(2.10, 2.30 + driftY * 0.2, -1.30));
                            this.cpTarget[1].copy(screenPt(2.15, 2.25 + driftY * 0.2, -0.75));
                            this.cpTarget[2].copy(screenPt(2.05, 2.15 + driftY * 0.15, -0.25));
                            this.cpTarget[3].copy(screenPt(1.90, 1.95 + driftY * 0.15, 0.18));
                            this.cpTarget[4].copy(screenPt(1.60, 1.62 + driftY * 0.1, 0.22));
                            this.cpTarget[5].copy(screenPt(1.18 + wX, 1.30 + wY, 0.12));
                            this.cpTarget[6].copy(screenPt(0.82 + wX, 0.88 + wY, 0.03 + breath * 0.01));

                        } else if (beh === 'bezel_lip_top') {
                            // #3. Centro superior (Techo): Curva drapeada sinuosa enroscada a la izquierda
                            this.cpTarget[0].copy(screenPt(0.30 + driftA * 0.3, 2.80, -1.35));
                            this.cpTarget[1].copy(screenPt(0.15 + driftA * 0.3, 2.70, -0.80));
                            this.cpTarget[2].copy(screenPt(-0.10 + driftA * 0.2, 2.55, -0.30));
                            this.cpTarget[3].copy(screenPt(-0.20 + driftA * 0.2, 2.35, 0.22));
                            this.cpTarget[4].copy(screenPt(-0.25 + driftA * 0.15, 1.85, 0.26));
                            this.cpTarget[5].copy(screenPt(-0.32 + wX, 1.25 + wY, 0.14));
                            this.cpTarget[6].copy(screenPt(-0.45 + wX, 0.82 + wY, 0.03 + breath * 0.01));

                        } else if (beh === 'corner_clamp_topleft') {
                            // #4. Esquina superior izquierda: Espiral cerrada enroscada hacia adentro
                            this.cpTarget[0].copy(screenPt(-2.10, 2.30 + driftY * 0.2, -1.30));
                            this.cpTarget[1].copy(screenPt(-2.15, 2.25 + driftY * 0.2, -0.75));
                            this.cpTarget[2].copy(screenPt(-2.05, 2.15 + driftY * 0.15, -0.25));
                            this.cpTarget[3].copy(screenPt(-1.90, 1.95 + driftY * 0.15, 0.18));
                            this.cpTarget[4].copy(screenPt(-1.62, 1.58 + driftY * 0.1, 0.22));
                            this.cpTarget[5].copy(screenPt(-1.22 + wX, 1.28 + wY, 0.12));
                            this.cpTarget[6].copy(screenPt(-0.85 + wX, 0.90 + wY, 0.03 + breath * 0.01));

                        } else if (beh === 'left_flank_hug') {
                            // #5. Flanco izquierdo: Ventosa en C enroscada y flexionante hacia arriba
                            this.cpTarget[0].copy(screenPt(-2.50, 0.20 + driftY * 0.2, -1.30));
                            this.cpTarget[1].copy(screenPt(-2.45, -0.10 + driftY * 0.2, -0.75));
                            this.cpTarget[2].copy(screenPt(-2.35, -0.25 + driftY * 0.15, -0.25));
                            this.cpTarget[3].copy(screenPt(-2.20, -0.25 + driftY * 0.15, 0.18));
                            this.cpTarget[4].copy(screenPt(-1.85, -0.22 + driftY * 0.1, 0.22));
                            this.cpTarget[5].copy(screenPt(-1.38 + wX, -0.35 + wY, 0.12));
                            this.cpTarget[6].copy(screenPt(-0.98 + wX, -0.05 + wY, 0.03 + breath * 0.01));

                        } else if (beh === 'bottom_left_corner') {
                            // #6. Esquina inferior izquierda: Garra helicoidal ascendente curvada
                            this.cpTarget[0].copy(screenPt(-2.40, -2.75 + driftY * 0.2, -1.40));
                            this.cpTarget[1].copy(screenPt(-2.40, -2.65 + driftY * 0.2, -0.85));
                            this.cpTarget[2].copy(screenPt(-2.25, -2.45 + driftY * 0.15, -0.30));
                            this.cpTarget[3].copy(screenPt(-2.05, -2.20 + driftY * 0.15, 0.18));
                            this.cpTarget[4].copy(screenPt(-1.65, -1.75 + driftY * 0.1, 0.22));
                            this.cpTarget[5].copy(screenPt(-1.20 + wX, -1.35 + wY, 0.12));
                            this.cpTarget[6].copy(screenPt(-0.82 + wX, -0.75 + wY, 0.03 + breath * 0.01));

                        } else if (beh === 'bezel_chin_bottom') {
                            // #7. Barbilla inferior: Cresta enroscada hacia la derecha
                            this.cpTarget[0].copy(screenPt(0.30 + driftA * 0.3, -2.85, -1.40));
                            this.cpTarget[1].copy(screenPt(0.20 + driftA * 0.3, -2.75, -0.85));
                            this.cpTarget[2].copy(screenPt(0.15 + driftA * 0.2, -2.60, -0.30));
                            this.cpTarget[3].copy(screenPt(0.20 + driftA * 0.2, -2.35, 0.18));
                            this.cpTarget[4].copy(screenPt(0.28 + driftA * 0.15, -1.85, 0.22));
                            this.cpTarget[5].copy(screenPt(0.38 + wX, -1.25 + wY, 0.12));
                            this.cpTarget[6].copy(screenPt(0.58 + wX, -0.78 + wY, 0.03 + breath * 0.01));
                        }

                    } else {
                        // ================= MONOLITH VERTICAL TARGETS (SLIMMER & LAYERED) =================
                        this.cpTarget[0].set(bx, waterY - this.depth, bz);
                        this.cpTarget[1].set(bx, waterY - this.depth * 0.45, bz);
                        this.cpTarget[2].set(bx, waterY + 0.45 + breath * 0.1, bz);

                        const BHH = cluster.bHalfSize.y;
                        const m = 0.12 + (this.hugLayer * 0.09);

                        if (beh === 'constrict_low') {
                            const a0 = p.startAngle + driftA, dir = p.dir || 1;
                            const yBase = -BHH * 0.55 + driftY;
                            const p3 = this._getMonolithPerimeterPoint(a0, bPos, bQuat, m, yBase - 0.25);
                            this.cpTarget[3].set(bx * 0.35 + p3.x * 0.65, bPos.y * 0.35 + (waterY + 0.2) * 0.65, bz * 0.35 + p3.z * 0.65);
                            this.cpTarget[4].copy(this._getMonolithPerimeterPoint(a0 + dir * 0.65, bPos, bQuat, m, yBase));
                            this.cpTarget[5].copy(this._getMonolithPerimeterPoint(a0 + dir * 1.55, bPos, bQuat, m, yBase + 0.12));
                            this.cpTarget[6].copy(this._getMonolithPerimeterPoint(a0 + dir * 2.35, bPos, bQuat, m * 0.85, yBase + 0.18));

                        } else if (beh === 'corner_wrap_rim') {
                            const cA = p.cornerAngle + driftA * 0.5, dir = p.dir || 1;
                            const p3 = this._getMonolithPerimeterPoint(cA - dir * 0.4, bPos, bQuat, m, 0.0);
                            this.cpTarget[3].set(bx * 0.35 + p3.x * 0.65, bPos.y * 0.45 + (waterY + 0.2) * 0.55, bz * 0.35 + p3.z * 0.65);
                            this.cpTarget[4].copy(this._getMonolithPerimeterPoint(cA, bPos, bQuat, m, BHH * 0.55 + driftY));
                            this.cpTarget[5].copy(this._getMonolithPerimeterPoint(cA + dir * 0.45, bPos, bQuat, m, BHH * 0.85 + driftY));
                            this.cpTarget[6].copy(this._getMonolithPerimeterPoint(cA + dir * 0.90, bPos, bQuat, m * 0.9, BHH * 0.96 + breath * 0.02));

                        } else if (beh === 'spiral_helix') {
                            const a0 = p.startAngle + driftA, dir = p.dir || 1;
                            const p3 = this._getMonolithPerimeterPoint(a0, bPos, bQuat, m, -BHH * 0.45);
                            this.cpTarget[3].set(bx * 0.35 + p3.x * 0.65, bPos.y * 0.4 + (waterY + 0.2) * 0.6, bz * 0.35 + p3.z * 0.65);
                            this.cpTarget[4].copy(this._getMonolithPerimeterPoint(a0 + dir * 0.8, bPos, bQuat, m, -BHH * 0.05 + driftY));
                            this.cpTarget[5].copy(this._getMonolithPerimeterPoint(a0 + dir * 1.7, bPos, bQuat, m, BHH * 0.45 + driftY));
                            this.cpTarget[6].copy(this._getMonolithPerimeterPoint(a0 + dir * 2.45, bPos, bQuat, m * 0.9, BHH * 0.78));

                        } else if (beh === 'corner_clamp') {
                            const cA = p.cornerAngle, yOff = p.yOffset || 0, dir = p.dir || 1;
                            const p3 = this._getMonolithPerimeterPoint(cA, bPos, bQuat, m + 0.08, yOff * 0.5);
                            this.cpTarget[3].set(bx * 0.35 + p3.x * 0.65, bPos.y * 0.45 + (waterY + 0.2) * 0.55, bz * 0.35 + p3.z * 0.65);
                            this.cpTarget[4].copy(this._getMonolithPerimeterPoint(cA - dir * 0.4, bPos, bQuat, m, yOff));
                            this.cpTarget[5].copy(this._getMonolithPerimeterPoint(cA + dir * 0.4, bPos, bQuat, m, yOff + 0.15));
                            this.cpTarget[6].copy(this._getMonolithPerimeterPoint(cA + dir * 1.15, bPos, bQuat, m * 0.9, yOff + 0.28));

                        } else if (beh === 'rest_tip_on_top') {
                            const a0 = p.startAngle + driftA;
                            const p3 = this._getMonolithPerimeterPoint(a0, bPos, bQuat, m, BHH * 0.2);
                            this.cpTarget[3].set(bx * 0.3 + p3.x * 0.7, bPos.y * 0.5 + (waterY + 0.2) * 0.5, bz * 0.3 + p3.z * 0.7);
                            this.cpTarget[4].copy(this._getMonolithPerimeterPoint(a0, bPos, bQuat, m, BHH * 0.85));

                            const BHW = cluster.bHalfSize.x;
                            const BHD = cluster.bHalfSize.z;
                            const rimIn = new THREE.Vector3(Math.cos(a0) * (BHW * 0.78), BHH + 0.05, Math.sin(a0) * (BHD * 0.78)).applyQuaternion(bQuat).add(bPos);
                            this.cpTarget[5].copy(rimIn);

                            const tipDist = p.restDist || 0.42;
                            const tipAngle = a0 + (p.curlAngle || 0.20);
                            const tipPos = new THREE.Vector3(Math.cos(tipAngle) * (BHW * tipDist), BHH + 0.03 + breath * 0.015, Math.sin(tipAngle) * (BHD * tipDist)).applyQuaternion(bQuat).add(bPos);
                            this.cpTarget[6].copy(tipPos);

                        } else if (beh === 'sensory_probe') {
                            const a0 = p.startAngle + driftA, dir = p.dir || 1;
                            const p3 = this._getMonolithPerimeterPoint(a0, bPos, bQuat, m, -BHH * 0.2);
                            this.cpTarget[3].set(bx * 0.35 + p3.x * 0.65, bPos.y * 0.45 + (waterY + 0.2) * 0.55, bz * 0.35 + p3.z * 0.65);
                            this.cpTarget[4].copy(this._getMonolithPerimeterPoint(a0 + dir * 0.4, bPos, bQuat, m, BHH * 0.4));
                            this.cpTarget[5].copy(this._getMonolithPerimeterPoint(a0 + 0.25, bPos, bQuat, m + 0.12, BHH + 0.15));

                            const wXp = Math.sin(time * this.tipWiggleSpeed + this.tipWigglePhase) * 0.35;
                            const wZp = Math.cos(time * this.tipWiggleSpeed * 0.85 + this.tipWigglePhase) * 0.35;
                            const wYp = Math.sin(time * this.tipWiggleSpeed * 1.3) * 0.15;

                            const BHW = cluster.bHalfSize.x;
                            const BHD = cluster.bHalfSize.z;
                            const probeTip = new THREE.Vector3(Math.cos(a0) * (BHW + 0.5) + wXp, BHH + 0.65 + wYp, Math.sin(a0) * (BHD + 0.5) + wZp).applyQuaternion(bQuat).add(bPos);
                            this.cpTarget[6].copy(probeTip);
                        }
                    }
                }

                _updatePulse(dt) {
                    this.pulseTimer += dt;
                    if (this.pulseWavePos < 0 || this.pulseWavePos > 1.3) {
                        if (this.pulseTimer >= this.pulseCooldown) {
                            this.pulseWavePos = -0.15; this.pulseSpeed = 0.55 + Math.random() * 0.3;
                            this.pulseIntensity = 0.25 + Math.random() * 0.2;
                            this.pulseTimer = 0; this.pulseCooldown = 2 + Math.random() * 5;
                        }
                    }
                    if (this.pulseWavePos >= -0.15 && this.pulseWavePos <= 1.3) this.pulseWavePos += dt * this.pulseSpeed;
                    for (let i = 0; i < this.joints; i++) {
                        const t = i / (this.joints - 1), dist = Math.abs(t - this.pulseWavePos), pw = 0.12;
                        let swell = 0;
                        if (dist < pw) swell = Math.cos(dist / pw * Math.PI * 0.5) * this.pulseIntensity * (1 - t * 0.85);
                        this.radii[i] = this.baseRadii[i] * (1 + swell);
                    }
                }

                update(time, dt, bPos, bQuat, bInvQuat) {
                    this._computeTargets(time, bPos, bQuat);
                    this._updatePulse(dt);

                    for (let i = 0; i < 7; i++) {
                        const s = Math.min(this.speeds[i] * (1 + dt * 10), 1.0);
                        this.cp[i].lerp(this.cpTarget[i], s);
                    }

                    for (let i = 0; i < 7; i++) {
                        collideObjectFlesh(this.cp[i], bPos, bQuat, bInvQuat, cluster.isTV, cluster.bHalfSize, this.radii[Math.min(i*8, this.joints-1)] + 0.01);
                    }

                    const curve = new THREE.CatmullRomCurve3(this.cp, false, 'centripetal', 0.5);
                    const pts = curve.getSpacedPoints(this.joints - 1);
                    for (let i = 0; i < this.joints; i++) this.skeleton[i].copy(pts[i]);

                    // Fleshy tip curling flexion & dynamic muscle tone for TV tentacles
                    if (cluster.isTV) {
                        for (let i = this.joints - 14; i < this.joints; i++) {
                            const tipFraction = (i - (this.joints - 14)) / 14.0; // 0 to 1
                            const flex = Math.sin(time * this.tipWiggleSpeed + this.tipWigglePhase + tipFraction * 3.2) * (0.025 * tipFraction);
                            this.skeleton[i].x += flex * 0.6;
                            this.skeleton[i].y += flex * 0.6;
                        }
                    }

                    for (let pass = 0; pass < 4; pass++) {
                        for (let i = 0; i < this.joints; i++) {
                            const comp = collideObjectFlesh(this.skeleton[i], bPos, bQuat, bInvQuat, cluster.isTV, cluster.bHalfSize, this.radii[i]);
                            this.compression[i] = comp;
                        }
                        for (let i = 0; i < this.joints - 1; i++) {
                            const p1 = this.skeleton[i], p2 = this.skeleton[i+1];
                            const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
                            const d = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1e-4;
                            if (d > this.segLen * 1.15 || d < this.segLen * 0.85) {
                                const s = this.segLen / d, b = i < 8 ? 1 : 0.45;
                                p2.x = p1.x + dx*s*b + dx*(1-b); p2.y = p1.y + dy*s*b + dy*(1-b); p2.z = p1.z + dz*s*b + dz*(1-b);
                            }
                        }
                    }
                }

                smoothSkeleton(it = 2) {
                    for (let iter = 0; iter < it; iter++) for (let i = 2; i < this.joints - 1; i++) {
                        const prev = this.skeleton[i-1], curr = this.skeleton[i], next = this.skeleton[i+1];
                        curr.x = curr.x * 0.6 + (prev.x + next.x) * 0.2;
                        curr.y = curr.y * 0.6 + (prev.y + next.y) * 0.2;
                        curr.z = curr.z * 0.6 + (prev.z + next.z) * 0.2;
                    }
                }

                buildMesh(bPos, bQuat, bInvQuat) {
                    const pos = this.geometry.attributes.position.array, nrm = this.geometry.attributes.normal.array;
                    const N = this.joints, RS = this.radSegs;
                    let nV = new THREE.Vector3(0,0,1), bV = new THREE.Vector3(), tV = new THREE.Vector3(); const vT = new THREE.Vector3();

                    for (let i = 0; i < N; i++) {
                        const p = this.skeleton[i];
                        if (i === 0) tV.subVectors(this.skeleton[1], p);
                        else if (i === N-1) tV.subVectors(p, this.skeleton[i-1]);
                        else tV.subVectors(this.skeleton[i+1], this.skeleton[i-1]);
                        tV.normalize();
                        bV.crossVectors(tV, nV).normalize();
                        if (bV.lengthSq() < 1e-3) { nV.set(1,0,0); bV.crossVectors(tV, nV).normalize(); }
                        nV.crossVectors(bV, tV).normalize();

                        const comp = this.compression[i], r = this.radii[i] * (1 + comp * 0.15);
                        for (let j = 0; j < RS; j++) {
                            const th = (j / RS) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
                            const nx = ct * nV.x + st * bV.x, ny = ct * nV.y + st * bV.y, nz = ct * nV.z + st * bV.z;
                            vT.set(p.x + nx * r, p.y + ny * r, p.z + nz * r);

                            pushMeshVertex(vT, bPos, bQuat, bInvQuat, cluster.isTV, cluster.bHalfSize);

                            const vi = (i * RS + j) * 3;
                            pos[vi] = vT.x; pos[vi+1] = vT.y; pos[vi+2] = vT.z;
                            nrm[vi] = nx; nrm[vi+1] = ny; nrm[vi+2] = nz;
                        }
                    }
                    this.geometry.attributes.position.needsUpdate = true;
                    this.geometry.attributes.normal.needsUpdate = true;
                    this.geometry.computeBoundingSphere();
                }
            }

            for (const c of hordeConfigs) {
                let bx, bz;
                if (c.radX && c.radZ) {
                    bx = this.center.x + Math.cos(c.angle) * c.radX;
                    bz = this.center.z + Math.sin(c.angle) * c.radZ;
                } else {
                    bx = this.center.x + Math.cos(c.angle) * (c.radius || 2.8);
                    bz = this.center.z + Math.sin(c.angle) * (c.radius || 2.8);
                }
                const basePos = new THREE.Vector3(bx, this.waterSurfaceY, bz);

                this.tentacles.push(new Tentacle(basePos, {
                    joints: c.joints || 60, segLen: 0.15, rBase: c.rBase, rTip: 0.015, depth: c.depth || 2.4,
                    hugLayer: c.hugLayer || 0, behavior: c.behavior || 'constrict_low', customParams: c.customParams || {}
                }));
            }
        }

        update(time, dt, bPos, bQuat) {
            const bInvQuat = bQuat.clone().invert();
            for (const tn of this.tentacles) tn.update(time, dt, bPos, bQuat, bInvQuat);

            // ================= 4-PASS LAYER-AWARE 3D INTER-TENTACLE REPULSION =================
            const numT = this.tentacles.length;
            const sepV = new THREE.Vector3();

            for (let pass = 0; pass < 4; pass++) {
                for (let a = 0; a < numT; a++) {
                    for (let b = a + 1; b < numT; b++) {
                        const tA = this.tentacles[a], tB = this.tentacles[b];
                        const layerDiff = tB.hugLayer - tA.hugLayer;

                        for (let i = 2; i < tA.joints - 1; i += 2) {
                            const p1 = tA.skeleton[i], q1 = tA.skeleton[i+1];
                            const rA = Math.max(tA.radii[i], tA.radii[i+1]);

                            for (let j = 2; j < tB.joints - 1; j += 2) {
                                const p2 = tB.skeleton[j], q2 = tB.skeleton[j+1];
                                const rB = Math.max(tB.radii[j], tB.radii[j+1]);

                                const minAllowed = rA + rB + 0.04;
                                const { s, t } = closestSegmentSegment(p1, q1, p2, q2);

                                const c1x = p1.x + (q1.x - p1.x) * s;
                                const c1y = p1.y + (q1.y - p1.y) * s;
                                const c1z = p1.z + (q1.z - p1.z) * s;

                                const c2x = p2.x + (q2.x - p2.x) * t;
                                const c2y = p2.y + (q2.y - p2.y) * t;
                                const c2z = p2.z + (q2.z - p2.z) * t;

                                const dx = c1x - c2x, dy = c1y - c2y, dz = c1z - c2z;
                                const distSq = dx * dx + dy * dy + dz * dz;

                                if (distSq < minAllowed * minAllowed && distSq > 1e-6) {
                                    const dist = Math.sqrt(distSq);
                                    const overlap = (minAllowed - dist) * 0.40;
                                    sepV.set((dx / dist) * overlap, (dy / dist) * overlap, (dz / dist) * overlap);

                                    let wA = 0.5, wB = 0.5;
                                    if (layerDiff > 0) { wA = 0.10; wB = 0.90; }
                                    else if (layerDiff < 0) { wA = 0.90; wB = 0.10; }

                                    p1.x += sepV.x * (1 - s) * wA; p1.y += sepV.y * (1 - s) * wA; p1.z += sepV.z * (1 - s) * wA;
                                    q1.x += sepV.x * s * wA;       q1.y += sepV.y * s * wA;       q1.z += sepV.z * s * wA;

                                    p2.x -= sepV.x * (1 - t) * wB; p2.y -= sepV.y * (1 - t) * wB; p2.z -= sepV.z * (1 - t) * wB;
                                    q2.x -= sepV.x * t * wB;       q2.y -= sepV.y * t * wB;       q2.z -= sepV.z * t * wB;
                                }
                            }
                        }
                    }
                }
            }

            for (const tn of this.tentacles) {
                for (let i = 0; i < tn.joints; i++) {
                    collideObjectFlesh(tn.skeleton[i], bPos, bQuat, bInvQuat, this.isTV, this.bHalfSize, tn.radii[i]);
                }
                tn.smoothSkeleton(2);
                tn.buildMesh(bPos, bQuat, bInvQuat);
            }
        }
    }

    // ===================== DYNAMIC SINUOUS LEVIATHAN BREACHING ARCHES =====================
    class DynamicWaterBreachArch {
        constructor(config) {
            this.center = config.center.clone();
            this.angle = config.angle;
            this.joints = config.joints || 60;
            this.radSegs = 14;

            this.radius = config.radius || 0.30;
            this.bulgeFactor = config.bulgeFactor || 0.20;

            this.rFar = config.rFar || 7.8;
            this.rMid = config.rMid || 5.2;
            this.rNear = config.rNear || 3.1;
            this.apexY = config.apexY || -1.25;

            this.sCurveIntensity = config.sCurveIntensity || 0.35;
            this.sCurvePhase = Math.random() * Math.PI * 2;

            this.pulseWavePos = -10;
            this.pulseSpeed = 0.45 + Math.random() * 0.35;
            this.pulseCooldown = 2.0 + Math.random() * 4.0;
            this.pulseTimer = Math.random() * this.pulseCooldown;
            this.pulseIntensity = 0.28 + Math.random() * 0.22;

            this.breathFreq = 0.22 + Math.random() * 0.25;
            this.breathPhase = Math.random() * Math.PI * 2;
            this.breathAmp = 0.08 + Math.random() * 0.06;

            this.swayFreq = 0.30 + Math.random() * 0.30;
            this.swayPhase = Math.random() * Math.PI * 2;
            this.swayAmp = 0.18 + Math.random() * 0.15;

            this.baseRadii = [];
            for (let i = 0; i < this.joints; i++) {
                const t = i / (this.joints - 1);
                const swellShape = Math.sin(t * Math.PI);
                this.baseRadii.push(this.radius * (1.0 - this.bulgeFactor * 0.5 + swellShape * this.bulgeFactor));
            }
            this.radii = this.baseRadii.slice();

            const uX = Math.cos(this.angle), uZ = Math.sin(this.angle);
            const perpX = -uZ, perpZ = uX;

            this.uX = uX; this.uZ = uZ;
            this.perpX = perpX; this.perpZ = perpZ;

            const s1 = Math.sin(this.sCurvePhase) * this.sCurveIntensity;
            const s2 = Math.cos(this.sCurvePhase) * this.sCurveIntensity;

            this.cpOrig = [
                new THREE.Vector3(this.center.x + uX * this.rFar - perpX * s1, -3.8, this.center.z + uZ * this.rFar - perpZ * s1),
                new THREE.Vector3(this.center.x + uX * ((this.rFar + this.rMid) * 0.5) + perpX * s2 * 0.5, -2.35, this.center.z + uZ * ((this.rFar + this.rMid) * 0.5) + perpZ * s2 * 0.5),
                new THREE.Vector3(this.center.x + uX * this.rMid + perpX * s1, this.apexY, this.center.z + uZ * this.rMid + perpZ * s1),
                new THREE.Vector3(this.center.x + uX * ((this.rMid + this.rNear) * 0.5) - perpX * s2 * 0.5, -2.35, this.center.z + uZ * ((this.rMid + this.rNear) * 0.5) - perpZ * s2 * 0.5),
                new THREE.Vector3(this.center.x + uX * this.rNear + perpX * s1 * 0.3, -3.8, this.center.z + uZ * this.rNear + perpZ * s1 * 0.3)
            ];

            this.cp = this.cpOrig.map(p => p.clone());
            this.skeleton = [];
            for (let i = 0; i < this.joints; i++) this.skeleton.push(new THREE.Vector3());

            this.geometry = this._buildGeo();
            this.mesh = new THREE.Mesh(this.geometry, getTentacleMaterial());
            this.mesh.castShadow = false;
            this.mesh.receiveShadow = false;
            scene.add(this.mesh);
        }

        _buildGeo() {
            const g = new THREE.BufferGeometry();
            const vc = this.joints * this.radSegs, ic = (this.joints - 1) * this.radSegs * 6;
            const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint32Array(ic);
            let ii = 0;
            for (let i = 0; i < this.joints - 1; i++) for (let j = 0; j < this.radSegs; j++) {
                const nj = (j+1) % this.radSegs, a = i*this.radSegs+j, b = i*this.radSegs+nj, c = (i+1)*this.radSegs+j, d = (i+1)*this.radSegs+nj;
                idx[ii++]=a; idx[ii++]=c; idx[ii++]=b; idx[ii++]=b; idx[ii++]=c; idx[ii++]=d;
            }
            for (let i = 0; i < this.joints; i++) for (let j = 0; j < this.radSegs; j++) {
                const ui = (i*this.radSegs+j)*2; uv[ui]=j/this.radSegs; uv[ui+1]=i/(this.joints-1);
            }
            g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
            return g;
        }

        _updatePulse(dt) {
            this.pulseTimer += dt;
            if (this.pulseWavePos < 0 || this.pulseWavePos > 1.3) {
                if (this.pulseTimer >= this.pulseCooldown) {
                    this.pulseWavePos = -0.15;
                    this.pulseSpeed = 0.45 + Math.random() * 0.35;
                    this.pulseIntensity = 0.28 + Math.random() * 0.22;
                    this.pulseTimer = 0;
                    this.pulseCooldown = 2.5 + Math.random() * 4.0;
                }
            }
            if (this.pulseWavePos >= -0.15 && this.pulseWavePos <= 1.3) this.pulseWavePos += dt * this.pulseSpeed;
            for (let i = 0; i < this.joints; i++) {
                const t = i / (this.joints - 1), dist = Math.abs(t - this.pulseWavePos), pw = 0.15;
                let swell = 0;
                if (dist < pw) swell = Math.cos(dist / pw * Math.PI * 0.5) * this.pulseIntensity;
                this.radii[i] = this.baseRadii[i] * (1 + swell);
            }
        }

        update(time, dt) {
            this._updatePulse(dt);

            const breathY = Math.sin(time * this.breathFreq + this.breathPhase) * this.breathAmp;
            const sway1 = Math.cos(time * this.swayFreq + this.swayPhase) * this.swayAmp;
            const sway2 = Math.sin(time * this.swayFreq * 1.5 + this.swayPhase) * (this.swayAmp * 0.6);

            const px = this.perpX, pz = this.perpZ;

            this.cp[0].set(this.cpOrig[0].x + px * sway2 * 0.3, this.cpOrig[0].y, this.cpOrig[0].z + pz * sway2 * 0.3);
            this.cp[1].set(this.cpOrig[1].x + px * sway1 * 0.6, this.cpOrig[1].y + breathY * 0.5, this.cpOrig[1].z + pz * sway1 * 0.6);
            this.cp[2].set(this.cpOrig[2].x + px * (sway1 + sway2), this.cpOrig[2].y + breathY, this.cpOrig[2].z + pz * (sway1 + sway2));
            this.cp[3].set(this.cpOrig[3].x - px * sway2 * 0.7, this.cpOrig[3].y + breathY * 0.5, this.cpOrig[3].z - pz * sway2 * 0.7);
            this.cp[4].set(this.cpOrig[4].x, this.cpOrig[4].y, this.cpOrig[4].z);

            const curve = new THREE.CatmullRomCurve3(this.cp, false, 'centripetal', 0.5);
            const pts = curve.getSpacedPoints(this.joints - 1);
            for (let i = 0; i < this.joints; i++) this.skeleton[i].copy(pts[i]);

            this.buildMesh();
        }

        buildMesh() {
            const pos = this.geometry.attributes.position.array, nrm = this.geometry.attributes.normal.array;
            const N = this.joints, RS = this.radSegs;
            let nV = new THREE.Vector3(0,1,0), bV = new THREE.Vector3(), tV = new THREE.Vector3(); const vT = new THREE.Vector3();

            for (let i = 0; i < N; i++) {
                const p = this.skeleton[i];
                if (i === 0) tV.subVectors(this.skeleton[1], p);
                else if (i === N-1) tV.subVectors(p, this.skeleton[i-1]);
                else tV.subVectors(this.skeleton[i+1], this.skeleton[i-1]);
                tV.normalize();
                bV.crossVectors(tV, nV).normalize();
                if (bV.lengthSq() < 1e-3) { nV.set(0,0,1); bV.crossVectors(tV, nV).normalize(); }
                nV.crossVectors(bV, tV).normalize();

                const r = this.radii[i];
                for (let j = 0; j < RS; j++) {
                    const th = (j / RS) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
                    const nx = ct * nV.x + st * bV.x, ny = ct * nV.y + st * bV.y, nz = ct * nV.z + st * bV.z;
                    vT.set(p.x + nx * r, p.y + ny * r, p.z + nz * r);

                    const vi = (i * RS + j) * 3;
                    pos[vi] = vT.x; pos[vi+1] = vT.y; pos[vi+2] = vT.z;
                    nrm[vi] = nx; nrm[vi+1] = ny; nrm[vi+2] = nz;
                }
            }
            this.geometry.attributes.position.needsUpdate = true;
            this.geometry.attributes.normal.needsUpdate = true;
            this.geometry.computeBoundingSphere();
        }
    }

    let monolithCluster = null, tvCluster = null;
    let oceanBreachArches = [];

    function initTentacles() {
        // ================= MONOLITH (REFINED SLIMMER MUSCULAR ANATOMY) =================
        const monoCenter = new THREE.Vector3(0, -2.1, -9);
        if (!monolithCluster) {
            const mc = [
                { radius: 2.7, angle: 0.10, behavior: 'constrict_low', hugLayer: 0, rBase: 0.24, depth: 2.3, joints: 58,
                  customParams: { startAngle: 0.05, dir: 1 } },
                { radius: 3.3, angle: Math.PI * 0.32, behavior: 'sensory_probe', hugLayer: 1, rBase: 0.22, depth: 2.4, joints: 60,
                  customParams: { startAngle: Math.PI * 0.30, dir: 1 } },
                { radius: 2.8, angle: Math.PI * 0.55, behavior: 'corner_wrap_rim', hugLayer: 0, rBase: 0.23, depth: 2.4, joints: 58,
                  customParams: { cornerAngle: Math.PI * 0.52, dir: 1 } },
                { radius: 3.1, angle: Math.PI * 0.80, behavior: 'rest_tip_on_top', hugLayer: 1, rBase: 0.23, depth: 2.5, joints: 62,
                  customParams: { startAngle: Math.PI * 0.78, curlAngle: 0.20, restDist: 0.32 } },
                { radius: 2.9, angle: Math.PI * 1.12, behavior: 'corner_clamp', hugLayer: 0, rBase: 0.24, depth: 2.4, joints: 58,
                  customParams: { cornerAngle: Math.PI * 1.08, dir: 1, yOffset: -0.2 } },
                { radius: 3.2, angle: Math.PI * 1.40, behavior: 'spiral_helix', hugLayer: 1, rBase: 0.22, depth: 2.4, joints: 60,
                  customParams: { startAngle: Math.PI * 1.38, dir: -1 } },
                { radius: 2.8, angle: Math.PI * 1.65, behavior: 'constrict_low', hugLayer: 0, rBase: 0.24, depth: 2.4, joints: 58,
                  customParams: { startAngle: Math.PI * 1.62, dir: -1 } }
            ];
            monolithCluster = new WorldTentacleCluster(
                monoCenter,
                new THREE.Vector3(1.35, 2.646, 1.35),
                mc,
                { waterSurfaceY: -2.0, isTV: false }
            );
        }

        // ================= TV (7 ORGANIC TENTACLES WITH CURLED FLESHY TIPS) =================
        const tvCenter = new THREE.Vector3(0.45, -2.19, 8.94);
        if (!tvCluster) {
            const tc = [
                // 1. Abraza el lateral derecho y posa punta en espiral en J-Hook carnosa
                { radX: 2.8, radZ: 2.8, angle: 0.15, behavior: 'bezel_grip_right', hugLayer: 0, rBase: 0.28, depth: 2.3, joints: 58, customParams: {} },
                // 2. Abraza la esquina superior derecha y posa punta en garra helicoidal enroscada
                { radX: 2.8, radZ: 2.8, angle: Math.PI * 0.35, behavior: 'bezel_corner_topright', hugLayer: 1, rBase: 0.27, depth: 2.4, joints: 60, customParams: {} },
                // 3. Abraza el labio superior con despeje total y drapeado sinuoso enroscado
                { radX: 2.8, radZ: 2.8, angle: Math.PI * 0.55, behavior: 'bezel_lip_top', hugLayer: 0, rBase: 0.28, depth: 2.4, joints: 58, customParams: {} },
                // 4. Muerde esquina superior izquierda y posa punta en espiral cerrada
                { radX: 2.8, radZ: 2.8, angle: Math.PI * 0.80, behavior: 'corner_clamp_topleft', hugLayer: 1, rBase: 0.27, depth: 2.5, joints: 60, customParams: {} },
                // 5. Envuelve el flanco izquierdo y posa punta en ventosa en C enroscada
                { radX: 2.8, radZ: 2.8, angle: Math.PI * 1.05, behavior: 'left_flank_hug', hugLayer: 0, rBase: 0.28, depth: 2.3, joints: 58, customParams: {} },
                // 6. Abraza esquina inferior izquierda y posa punta en garra helicoidal ascendente
                { radX: 2.8, radZ: 2.8, angle: Math.PI * 1.35, behavior: 'bottom_left_corner', hugLayer: 1, rBase: 0.27, depth: 2.4, joints: 60, customParams: {} },
                // 7. Abraza moldura inferior y posa punta en cresta enroscada
                { radX: 2.8, radZ: 2.8, angle: Math.PI * 1.75, behavior: 'bezel_chin_bottom', hugLayer: 0, rBase: 0.28, depth: 2.3, joints: 58, customParams: {} }
            ];

            tvCluster = new WorldTentacleCluster(
                tvCenter,
                new THREE.Vector3(1.95, 1.70, 0.85),
                tc,
                { waterSurfaceY: -2.0, isTV: true }
            );
        }

        // ================= DYNAMIC HETEROGENEOUS OCEAN BREACHING LEVIATHANS =================
        if (oceanBreachArches.length === 0) {
            // TV Flanking Breaches (Slender, sleek and matching the TV tentacles)
            const tvArches = [
                // 1. Flanco Derecho: Onda fluida esbelta
                { center: tvCenter, angle: 0.15, rFar: 7.8, rMid: 5.2, rNear: 3.1, radius: 0.30, bulgeFactor: 0.20, apexY: -1.25, sCurveIntensity: 0.40, joints: 60 },
                // 2. Esquina Sup-Der: Delgado, ágil y serpentino
                { center: tvCenter, angle: Math.PI * 0.35, rFar: 8.0, rMid: 5.4, rNear: 3.2, radius: 0.24, bulgeFactor: 0.15, apexY: -1.45, sCurveIntensity: 0.50, joints: 60 },
                // 3. Esquina Sup-Izq: Muscular proporcionado
                { center: tvCenter, angle: Math.PI * 0.80, rFar: 7.6, rMid: 5.0, rNear: 3.0, radius: 0.28, bulgeFactor: 0.22, apexY: -1.30, sCurveIntensity: 0.35, joints: 60 },
                // 4. Flanco Izquierdo: Aguado y fluido rozando la espuma
                { center: tvCenter, angle: Math.PI * 1.05, rFar: 7.9, rMid: 5.3, rNear: 3.1, radius: 0.26, bulgeFactor: 0.18, apexY: -1.55, sCurveIntensity: 0.55, joints: 60 },
                // 5. Esquina Inf-Izq: Curva serpentina suave
                { center: tvCenter, angle: Math.PI * 1.35, rFar: 7.5, rMid: 4.8, rNear: 2.9, radius: 0.25, bulgeFactor: 0.18, apexY: -1.35, sCurveIntensity: 0.45, joints: 60 }
            ];

            for (const ac of tvArches) {
                oceanBreachArches.push(new DynamicWaterBreachArch(ac));
            }

            // Monolith Flanking Breaches (Balanced muscular proportions)
            const monoArches = [
                // 6. Monolito Este: Bobina musculosa refinada
                { center: monoCenter, angle: 0.10, rFar: 7.8, rMid: 5.2, rNear: 3.1, radius: 0.34, bulgeFactor: 0.28, apexY: -1.15, sCurveIntensity: 0.35, joints: 60 },
                // 7. Monolito Nor-Este: Onda serpentina media
                { center: monoCenter, angle: Math.PI * 0.32, rFar: 8.0, rMid: 5.4, rNear: 3.2, radius: 0.28, bulgeFactor: 0.20, apexY: -1.35, sCurveIntensity: 0.48, joints: 60 },
                // 8. Monolito Nor-Oeste: Delgado látigo
                { center: monoCenter, angle: Math.PI * 0.80, rFar: 8.2, rMid: 5.5, rNear: 3.3, radius: 0.25, bulgeFactor: 0.15, apexY: -1.40, sCurveIntensity: 0.55, joints: 60 },
                // 9. Monolito Oeste: Muscular proporcionado
                { center: monoCenter, angle: Math.PI * 1.12, rFar: 7.7, rMid: 5.1, rNear: 3.0, radius: 0.32, bulgeFactor: 0.30, apexY: -1.25, sCurveIntensity: 0.38, joints: 60 },
                // 10. Monolito Sur-Oeste: Curva baja aguada
                { center: monoCenter, angle: Math.PI * 1.40, rFar: 7.9, rMid: 5.3, rNear: 3.1, radius: 0.27, bulgeFactor: 0.18, apexY: -1.50, sCurveIntensity: 0.50, joints: 60 }
            ];

            for (const ac of monoArches) {
                oceanBreachArches.push(new DynamicWaterBreachArch(ac));
            }
        }
    }

    function updateTentacles(time, dt) {
        if (!monolithCluster || !tvCluster || oceanBreachArches.length === 0) initTentacles();

        // === MONOLITH ===
        const mPos = new THREE.Vector3(0, -2.1, -9), mQuat = new THREE.Quaternion();
        if (cuboidGroup) { cuboidGroup.getWorldPosition(mPos); cuboidGroup.getWorldQuaternion(mQuat); }
        else mQuat.setFromEuler(new THREE.Euler(-Math.PI/2.6, 0.38, -0.35));
        if (monolithCluster) monolithCluster.update(time, dt, mPos, mQuat);

        // === TV (DYNAMIC CRT SCREEN REFERENCE) ===
        const tvPos = new THREE.Vector3(0.45, -2.19, 8.94), tvQuat = new THREE.Quaternion();
        if (window.tvCrtScreen) {
            window.tvCrtScreen.getWorldPosition(tvPos);
            window.tvCrtScreen.getWorldQuaternion(tvQuat);
        } else if (window.tvGroup) {
            window.tvGroup.getWorldPosition(tvPos);
            window.tvGroup.getWorldQuaternion(tvQuat);
        } else {
            tvQuat.setFromEuler(new THREE.Euler(-Math.PI/2.05, 0, 0.22));
        }
        if (tvCluster) tvCluster.update(time, dt, tvPos, tvQuat);

        // === DYNAMIC HETEROGENEOUS BREACHING LEVIATHANS ===
        for (const arch of oceanBreachArches) {
            arch.update(time, dt);
        }
    }

    window.initTentacles = initTentacles;
    window.updateTentacles = updateTentacles;
})();
