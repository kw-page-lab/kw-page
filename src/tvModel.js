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

  const texture1Promise = new Promise((resolve, reject) => {
    textureLoader.load(
      '/padre_transparente.webp',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        setMilestone('texture1', 10);
        resolve(tex);
      },
      undefined,
      (err) => {
        console.error('Error loading texture 1:', err);
        reject(err);
      }
    );
  });

  const texture2Promise = new Promise((resolve, reject) => {
    textureLoader.load(
      '/silueta_recortada_precisa.webp',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        setMilestone('texture2', 10);
        resolve(tex);
      },
      undefined,
      (err) => {
        console.error('Error loading texture 2:', err);
        reject(err);
      }
    );
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
          uChildVisibility: { value: 0.0 }
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

      const update = (elapsedTime, deltaTime) => {
        crtMaterial.uniforms.uTime.value = elapsedTime;

        updateScreenManager(crtMaterial.uniforms, elapsedTime, deltaTime);

        crtLight.intensity = (1.4 + Math.sin(elapsedTime * 35.0) * 0.18 + Math.sin(elapsedTime * 7.0) * 0.06) * 16.0;

        internalCabinetLight.intensity = (10.0 + Math.sin(elapsedTime * 22.0) * 0.8 + Math.sin(elapsedTime * 4.0) * 0.25);

        if (inTransition) {
          const shakeX = (Math.random() - 0.5) * 0.012;
          const shakeY = (Math.random() - 0.5) * 0.012;
          const shakeZ = (Math.random() - 0.5) * 0.012;
          tvModel.position.set(-scaledCenter.x + shakeX, -scaledBox.min.y + shakeY, -scaledCenter.z + shakeZ);
        } else {
          tvModel.position.set(-scaledCenter.x, -scaledBox.min.y, -scaledCenter.z);
        }
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
        destroy
      };
    });
}
