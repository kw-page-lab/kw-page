import * as THREE from 'three';
import { initScene } from './scene.js';
import { initOverlay } from './overlay.js';
import { initLights } from './lights.js';
import { initParticles } from './particles.js';
import { loadTV } from './tvModel.js';
import { initCameraDrift } from './camera.js';
import { milestoneComplete, finishLoading } from './loader.js';

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
let tvRef = null;

loadTV(scene, controls, lights.spotlight, lights.spotTarget)
  .then((tv) => {
    updateTV = tv.update;
    tvRef = tv;

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

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let magneticTimer = null;
let pendingUV = null;
let pointerDownPos = { x: 0, y: 0 };
let isMagneticHolding = false;
const HOLD_DELAY_MS = 950;
const DRAG_CANCEL_PX = 6;

const _wq   = new THREE.Quaternion();
const _wp   = new THREE.Vector3();
const _hit  = new THREE.Vector3();
const _local = new THREE.Vector3();
const _plane = new THREE.Plane();
const _lastCenterUV = new THREE.Vector2(-1, -1);

const updateMagneticFromPointer = (event) => {
  if (!window.crtScreen || !tvRef) return;

  const rect = canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const center = window.crtScreen.material.uniforms.uMagneticCenter.value;
  const prevX = center.x;
  const prevY = center.y;

  const intersects = raycaster.intersectObject(window.crtScreen);
  if (intersects.length > 0 && intersects[0].uv) {
    center.copy(intersects[0].uv);
  } else {
    window.crtScreen.updateWorldMatrix(true, false);
    window.crtScreen.getWorldQuaternion(_wq);
    window.crtScreen.getWorldPosition(_wp);
    _plane.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 0, 1).applyQuaternion(_wq),
      _wp
    );
    if (raycaster.ray.intersectPlane(_plane, _hit)) {
      window.crtScreen.worldToLocal(_local.copy(_hit));
      center.set(
        THREE.MathUtils.clamp(_local.x / 1.75 + 0.5, 0.02, 0.98),
        THREE.MathUtils.clamp(_local.y / 1.54 + 0.5, 0.02, 0.98)
      );
    }
  }

  if (_lastCenterUV.x >= 0 && tvRef.setVelocityBoost) {
    tvRef.setVelocityBoost(center.x - prevX, center.y - prevY);
  }
  _lastCenterUV.set(center.x, center.y);
};

const cancelMagneticIntent = () => {
  if (magneticTimer) {
    clearTimeout(magneticTimer);
    magneticTimer = null;
  }
  pendingUV = null;
};

const releaseMagnetic = () => {
  cancelMagneticIntent();
  isMagneticHolding = false;
  controls.enabled = true;
  if (tvRef) tvRef.stopMagneticHold();
};

canvas.addEventListener('pointerdown', (event) => {
  const rect = canvas.getBoundingClientRect();
  pointerDownPos = { x: event.clientX, y: event.clientY };
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  if (window.crtScreen && tvRef) {
    const intersects = raycaster.intersectObject(window.crtScreen);
    if (intersects.length > 0 && intersects[0].uv) {
      pendingUV = intersects[0].uv.clone();
      magneticTimer = setTimeout(() => {
        if (pendingUV) {
          controls.enabled = false;
          isMagneticHolding = true;
          tvRef.startMagneticHold(pendingUV);
          pendingUV = null;
        }
        magneticTimer = null;
      }, HOLD_DELAY_MS);
    }
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (pendingUV && event.buttons > 0) {
    const dx = event.clientX - pointerDownPos.x;
    const dy = event.clientY - pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > DRAG_CANCEL_PX) {
      cancelMagneticIntent();
    }
  }

  if (isMagneticHolding) {
    updateMagneticFromPointer(event);
  }
});

canvas.addEventListener('pointerup', releaseMagnetic);
canvas.addEventListener('pointercancel', releaseMagnetic);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseMagnetic();
});

window.addEventListener('blur', releaseMagnetic);

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
