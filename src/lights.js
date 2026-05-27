import * as THREE from 'three';
import { DESIGN } from './scene.js';

export function initLights(scene) {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.008);
  scene.add(ambientLight);

  const spotlight = new THREE.SpotLight(
    DESIGN.spotlightColor,
    15.0,
    30.0,
    Math.PI / 4.8,
    0.6,
    1.2
  );
  spotlight.position.set(0, 8, 0);
  spotlight.castShadow = true;

  spotlight.shadow.mapSize.width = 2048;
  spotlight.shadow.mapSize.height = 2048;
  spotlight.shadow.camera.near = 0.5;
  spotlight.shadow.camera.far = 15;
  spotlight.shadow.bias = -0.0001;
  scene.add(spotlight);

  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, 0, 0);
  scene.add(spotTarget);
  spotlight.target = spotTarget;

  const update = (elapsedTime) => {
    const lampX = Math.sin(elapsedTime * 0.85) * 0.75;
    const lampZ = Math.cos(elapsedTime * 0.85) * 0.75;

    spotlight.position.x = lampX;
    spotlight.position.z = 12.0 + lampZ;

    spotTarget.position.x = lampX * 4.2;
    spotTarget.position.z = 12.0 + lampZ * 4.2;
  };

  return {
    ambientLight,
    spotlight,
    spotTarget,
    update
  };
}
