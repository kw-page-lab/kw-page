import * as THREE from 'three';
import { initScene } from './scene.js';
import { initOverlay } from './overlay.js';
import { initLights } from './lights.js';
import { initParticles } from './particles.js';
import { loadTV } from './tvModel.js';
import { initCameraDrift } from './camera.js';
import { milestoneComplete, finishLoading } from './loader.js';

// eres mas curioso que yo eh? veamos que mas lejos puedes llegar (2/7)
const canvas = document.getElementById('webgl-canvas');
const container = document.getElementById('app-container');

const { scene, camera, renderer, controls } = initScene(container, canvas);
milestoneComplete('scene');

const overlay = initOverlay();
milestoneComplete('overlay');

const lights = initLights(scene);
milestoneComplete('lights');

const particles = initParticles(scene);
milestoneComplete('particles');

const cameraDrift = initCameraDrift(camera, controls, canvas);

let updateTV = null;

loadTV(scene, controls, lights.spotlight, lights.spotTarget)
  .then((tv) => {
    updateTV = tv.update;

    window.tvGroup = tv.tvGroup;
    window.crtScreen = tv.crtScreen;
    window.crtLight = tv.crtLight;
    window.internalCabinetLight = tv.internalCabinetLight;

    finishLoading();
  })
  .catch((error) => {
    console.error('TV Model failed to load:', error);
    finishLoading();
  });

const clock = new THREE.Clock();

const animate = () => {
  requestAnimationFrame(animate);

  const deltaTime = Math.min(clock.getDelta(), 0.1);
  const elapsedTime = clock.getElapsedTime();

  overlay.update(elapsedTime);
  lights.update(elapsedTime);
  particles.update(elapsedTime);

  if (updateTV) {
    updateTV(elapsedTime, deltaTime);
  }

  cameraDrift.update(elapsedTime, deltaTime);

  renderer.clear();
  renderer.render(scene, camera);
  renderer.render(overlay.overlayScene, overlay.overlayCamera);
};

animate();
