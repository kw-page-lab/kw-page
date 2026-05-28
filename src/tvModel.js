import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import crtVertexShader from './shaders/crtVertex.glsl?raw';
import crtFragmentShader from './shaders/crtFragment.glsl?raw';
import { setMilestone } from './loader.js';
import { loadScreenAssets, updateScreenManager, inTransition, destroyScreenManager } from './screenManager.js';

// Excuse me, sir, there must be someone you've confused me for (4/7)
// REJECTED FALSE ICONS (5/7)

const getMeshBoundingBox = (object) => {
  const box = new THREE.Box3();
  let hasMesh = false;
  
  object.traverse((child) => {
    if (child.isMesh) {
      const childBox = new THREE.Box3().setFromObject(child);
      if (!hasMesh) {
        box.copy(childBox);
        hasMesh = true;
      } else {
        box.union(childBox);
      }
    }
  });
  
  return box;
};

function dec(hex) {
  const key = import.meta.env.VITE_XOR_KEY_STRING || 'kw';
  let res = '';
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    const keyChar = key.charCodeAt((i / 2) % key.length);
    res += String.fromCharCode(byte ^ keyChar);
  }
  return res;
}

async function loadEncryptedAsset(url, mimeType, textureLoader) {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const view = new Uint8Array(buffer);
  const keyStr = import.meta.env.VITE_XOR_KEY_BYTES || '75,87,95,65,82,71';
  const key = keyStr.split(',').map(Number);
  for (let i = 0; i < view.length; i++) {
    view[i] ^= key[i % key.length];
  }
  const blob = new Blob([view], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  
  return new Promise((resolve, reject) => {
    textureLoader.load(
      blobUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        URL.revokeObjectURL(blobUrl);
        resolve(tex);
      },
      undefined,
      (err) => {
        URL.revokeObjectURL(blobUrl);
        reject(err);
      }
    );
  });
}

export function loadTV(scene, controls, spotlight, spotTarget) {
  const gltfLoader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();

  const modelPromise = new Promise((resolve, reject) => {
    gltfLoader.load(
      '/crt-tv.glb',
      (gltf) => {
        setMilestone('model', 50);
        resolve(gltf);
      },
      (xhr) => {
        let total = xhr.total;
        if (!total || total === 0) {
          total = 4862760;
        }
        const ratio = Math.min(xhr.loaded / total, 1.0);
        setMilestone('model', ratio * 50);
      },
      (err) => {
        console.error('Error loading TV GLTF:', err);
        reject(err);
      }
    );
  });

  const texture1Promise = loadEncryptedAsset(dec('4407340345130a03'), 'image/webp', textureLoader)
    .then((tex) => {
      setMilestone('texture1', 10);
      return tex;
    })
    .catch((err) => {
      console.error('Error loading texture 1:', err);
      throw err;
    });

  const texture2Promise = loadEncryptedAsset(dec('4404340545130a03'), 'image/webp', textureLoader)
    .then((tex) => {
      setMilestone('texture2', 10);
      return tex;
    })
    .catch((err) => {
      console.error('Error loading texture 2:', err);
      throw err;
    });

  return Promise.all([modelPromise, texture1Promise, texture2Promise])
    .then(([gltf, crtTexture, childTexture]) => {
      return loadScreenAssets(crtTexture, childTexture).then(() => {
        return [gltf, crtTexture, childTexture];
      });
    })
    .then(([gltf, crtTexture, childTexture]) => {
      const tvGroup = new THREE.Group();
      scene.add(tvGroup);

      const tvModel = gltf.scene;
      tvGroup.add(tvModel);

      tvModel.position.set(0, 0, 0);
      tvModel.rotation.set(0, 0, 0);
      tvModel.scale.set(1, 1, 1);
      tvModel.updateMatrixWorld(true);

      const targetHeight = 2.4;
      const initialBox = getMeshBoundingBox(tvModel);
      const initialSize = initialBox.getSize(new THREE.Vector3());
      const scaleFactor = targetHeight / initialSize.y;
      tvModel.scale.setScalar(scaleFactor);
      tvModel.updateMatrixWorld(true);

      const scaledBox = getMeshBoundingBox(tvModel);
      const scaledCenter = scaledBox.getCenter(new THREE.Vector3());

      tvModel.position.x = -scaledCenter.x;
      tvModel.position.y = -scaledBox.min.y;
      tvModel.position.z = -scaledCenter.z;
      
      tvModel.rotation.y = Math.PI;
      tvModel.updateMatrixWorld(true);

      tvModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            child.material.roughness = Math.max(child.material.roughness, 0.45);
            child.material.metalness = Math.min(child.material.metalness, 0.8);
          }
        }
      });

      const crtGeometry = new THREE.PlaneGeometry(1.75, 1.54, 16, 16);

      const crtMaterial = new THREE.ShaderMaterial({
        vertexShader: crtVertexShader,
        fragmentShader: crtFragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uTexture: { value: crtTexture },
          uTextureChild: { value: childTexture },
          uTextureText: { value: null },
          uChildVisibility: { value: 0.0 },
          uMagneticCenter: { value: new THREE.Vector2(-10.0, -10.0) },
          uMagneticTime: { value: 0.0 },
          uMagneticIntensity: { value: 0.0 },
          uMagneticBuildup: { value: 0.0 },
          uMagneticVelocity: { value: new THREE.Vector2(0.0, 0.0) }
        }
      });

      const crtScreen = new THREE.Mesh(crtGeometry, crtMaterial);
      
      const frontZ = scaledBox.max.z - scaledCenter.z;
      crtScreen.position.set(0.0, 1.30, frontZ + 2.01); 
      tvGroup.add(crtScreen);

      const crtLight = new THREE.SpotLight(
        0xaad8ff,
        12.0,
        9.0,
        Math.PI / 2.2,
        0.95,
        1.1
      );
      crtLight.position.set(0.0, 1.30, frontZ + 2.05);
      
      const crtLightTarget = new THREE.Object3D();
      crtLightTarget.position.set(0.0, 0.0, frontZ + 5.5);
      tvGroup.add(crtLightTarget);
      crtLight.target = crtLightTarget;
      tvGroup.add(crtLight);

      const internalCabinetLight = new THREE.SpotLight(0xff5511, 14.0, 3.2, Math.PI / 2.5, 0.9, 2.0);
      internalCabinetLight.position.set(0.0, 1.30, frontZ + 0.3);
      
      const internalTarget = new THREE.Object3D();
      internalTarget.position.set(0.0, 1.30, frontZ - 0.5);
      tvGroup.add(internalTarget);
      internalCabinetLight.target = internalTarget;
      tvGroup.add(internalCabinetLight);

      tvGroup.position.set(0.0, 0.0, 12.0);

      controls.target.set(0, 1.30, 12.0);
      spotTarget.position.set(0, 1.30, 12.0);
      spotlight.target = spotTarget;

      let _isHolding = false;
      let _buildupTime = 0.0;
      const MAX_BUILDUP = 3.5;
      const BURST_DUR = 0.22;
      let _releaseIntensity = 0.0;
      let _decayDuration = 0.0;
      let _decayElapsed = 0.0;
      let _velX = 0.0;
      let _velY = 0.0;
      let _velocityBoost = 0.0;

      const startMagneticHold = (uv) => {
        _isHolding = true;
        _buildupTime = crtMaterial.uniforms.uMagneticBuildup.value * MAX_BUILDUP;
        _decayDuration = 0.0;
        _decayElapsed = 0.0;
        crtMaterial.uniforms.uMagneticCenter.value.copy(uv);
      };

      const stopMagneticHold = () => {
        if (!_isHolding) return;
        _isHolding = false;
        _releaseIntensity = crtMaterial.uniforms.uMagneticBuildup.value;
        _decayDuration = 1.5 + _releaseIntensity * 9.0;
        _decayElapsed = -BURST_DUR;
      };

      const setVelocityBoost = (dvx, dvy) => {
        const speed = Math.sqrt(dvx * dvx + dvy * dvy);
        _velocityBoost = Math.min(speed * 12.0, 0.6);
        _velX = dvx * 8.0;
        _velY = dvy * 8.0;
      };

      const update = (elapsedTime, deltaTime) => {
        crtMaterial.uniforms.uTime.value = elapsedTime;

        _velocityBoost = Math.max(_velocityBoost - deltaTime * 5.0, 0.0);
        _velX *= Math.max(1.0 - deltaTime * 6.0, 0.0);
        _velY *= Math.max(1.0 - deltaTime * 6.0, 0.0);

        if (_isHolding) {
          _buildupTime = Math.min(_buildupTime + deltaTime, MAX_BUILDUP);
          const buildupFrac = _buildupTime / MAX_BUILDUP;
          crtMaterial.uniforms.uMagneticIntensity.value = Math.min(0.15 + buildupFrac * 0.85 + _velocityBoost * 0.4, 1.3);
          crtMaterial.uniforms.uMagneticBuildup.value = buildupFrac;
          crtMaterial.uniforms.uMagneticTime.value += deltaTime;
          crtMaterial.uniforms.uMagneticVelocity.value.set(_velX, _velY);

          const shakeAmp = Math.min(buildupFrac * 0.032, 0.032);
          if (shakeAmp > 0.001) {
            tvGroup.position.set(
              (Math.random() - 0.5) * shakeAmp,
              (Math.random() - 0.5) * shakeAmp,
              12.0 + (Math.random() - 0.5) * shakeAmp
            );
          } else {
            tvGroup.position.set(0.0, 0.0, 12.0);
          }

        } else if (_decayDuration > 0.0) {
          _decayElapsed += deltaTime;
          crtMaterial.uniforms.uMagneticTime.value += deltaTime;
          crtMaterial.uniforms.uMagneticVelocity.value.set(0.0, 0.0);

          if (_decayElapsed < 0.0) {
            const burstT = (_decayElapsed + BURST_DUR) / BURST_DUR;
            const burstPeak = Math.sin(burstT * Math.PI) * 0.55;
            const burstVal = Math.min(_releaseIntensity + burstPeak, 1.4);
            crtMaterial.uniforms.uMagneticIntensity.value = burstVal;
            crtMaterial.uniforms.uMagneticBuildup.value = burstVal;
            tvGroup.position.set(0.0, 0.0, 12.0);

          } else {
            const t = Math.min(_decayElapsed / _decayDuration, 1.0);
            const easeT = 1.0 - t * t;
            const current = _releaseIntensity * easeT;

            if (current <= 0.001 || t >= 1.0) {
              crtMaterial.uniforms.uMagneticIntensity.value = 0.0;
              crtMaterial.uniforms.uMagneticBuildup.value = 0.0;
              _decayDuration = 0.0;
              tvGroup.position.set(0.0, 0.0, 12.0);
            } else {
              crtMaterial.uniforms.uMagneticIntensity.value = current;
              crtMaterial.uniforms.uMagneticBuildup.value = current;
              const shakeAmp = current * 0.032;
              tvGroup.position.set(
                (Math.random() - 0.5) * shakeAmp,
                (Math.random() - 0.5) * shakeAmp,
                12.0 + (Math.random() - 0.5) * shakeAmp
              );
            }
          }

        } else {
          crtMaterial.uniforms.uMagneticVelocity.value.set(0.0, 0.0);
          if (inTransition) {
            tvGroup.position.set(
              (Math.random() - 0.5) * 0.012,
              (Math.random() - 0.5) * 0.012,
              12.0 + (Math.random() - 0.5) * 0.012
            );
          } else {
            tvGroup.position.set(0.0, 0.0, 12.0);
          }
        }

        updateScreenManager(crtMaterial.uniforms, elapsedTime, deltaTime);

        crtLight.intensity = (1.4 + Math.sin(elapsedTime * 35.0) * 0.18 + Math.sin(elapsedTime * 7.0) * 0.06) * 16.0;

        internalCabinetLight.intensity = (10.0 + Math.sin(elapsedTime * 22.0) * 0.8 + Math.sin(elapsedTime * 4.0) * 0.25);

        tvModel.position.set(-scaledCenter.x, -scaledBox.min.y, -scaledCenter.z);
      };

      const destroy = () => {
        crtGeometry.dispose();
        crtMaterial.dispose();
        destroyScreenManager();
        scene.remove(tvGroup);
      };

      return {
        tvGroup,
        crtScreen,
        crtLight,
        internalCabinetLight,
        update,
        destroy,
        startMagneticHold,
        stopMagneticHold,
        setVelocityBoost
      };
    });
}
