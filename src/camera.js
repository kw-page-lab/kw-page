import * as THREE from 'three';

export function initCameraDrift(camera, controls, canvas) {
  let lastInteractionTime = -10.0;
  let isUserInteracting = false;
  let didUserInteract = true;
  let lastCutTime = -10.0;
  let wiggleScale = 0.0;

  const initialDist = camera.position.distanceTo(controls.target);
  let startTheta = 0;
  let startPhi = Math.PI / 2 - 0.15;
  let startDistance = initialDist;

  let endTheta = 0;
  let endPhi = Math.PI / 2 - 0.15;
  let endDistance = initialDist;

  let transitionT = 1.0;
  const transitionDuration = 5.5;

  const registerInteraction = (elapsedTime) => {
    lastInteractionTime = elapsedTime;
  };

  const handlePointerDown = () => {
    isUserInteracting = true;
    didUserInteract = true;
    wiggleScale = 0.0;
  };

  const handlePointerMove = () => {
    if (isUserInteracting) {
      didUserInteract = true;
      wiggleScale = 0.0;
    }
  };

  const handlePointerUp = () => {
    isUserInteracting = false;
    didUserInteract = true;
    wiggleScale = 0.0;
  };

  const handleWheel = () => {
    didUserInteract = true;
    wiggleScale = 0.0;
  };

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('wheel', handleWheel);

  const update = (elapsedTime, deltaTime) => {
    if (isUserInteracting) {
      registerInteraction(elapsedTime);
    }

    const timeSinceInteraction = elapsedTime - lastInteractionTime;
    const idleDelay = 5.0;

    if (!isUserInteracting && timeSinceInteraction > idleDelay) {
      const targetZ = 12.0;
      const targetY = 1.30;
      const relX = camera.position.x;
      const relY = camera.position.y - targetY;
      const relZ = camera.position.z - targetZ;

      const currentDistance = Math.sqrt(relX * relX + relY * relY + relZ * relZ);
      const currentPhi = Math.acos(relY / currentDistance);
      const currentTheta = Math.atan2(relX, relZ);

      if (elapsedTime - lastCutTime > 5.5) {
        if (didUserInteract) {
          startTheta = currentTheta;
          startPhi = currentPhi;
          startDistance = currentDistance;
          didUserInteract = false;
        } else {
          startTheta = endTheta;
          startPhi = endPhi;
          startDistance = endDistance;
        }

        endTheta = (Math.random() - 0.5) * 0.28;
        endPhi = (Math.PI / 2 - 0.15) + (Math.random() - 0.5) * 0.06;
        
        const isMobileDevice = window.innerWidth < 768;
        if (isMobileDevice) {
          endDistance = 6.8 + Math.random() * 0.70;
        } else {
          endDistance = 5.2 + Math.random() * 0.50;
        }

        transitionT = 0.0;
        lastCutTime = elapsedTime;
      }

      transitionT = Math.min(transitionT + deltaTime / transitionDuration, 1.0);
      const t = transitionT;
      const tSmooth = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);

      const theta = THREE.MathUtils.lerp(startTheta, endTheta, tSmooth);
      const phi = THREE.MathUtils.lerp(startPhi, endPhi, tSmooth);
      const distance = THREE.MathUtils.lerp(startDistance, endDistance, tSmooth);

      wiggleScale = THREE.MathUtils.lerp(wiggleScale, 1.0, 0.015);

      const wiggleTheta = theta + Math.sin(elapsedTime * 0.15) * 0.02 * wiggleScale;
      const wigglePhi = phi + Math.cos(elapsedTime * 0.20) * 0.015 * wiggleScale;
      const wiggleDistance = distance + Math.sin(elapsedTime * 0.10) * 0.08 * wiggleScale;

      camera.position.x = wiggleDistance * Math.sin(wigglePhi) * Math.sin(wiggleTheta);
      camera.position.y = targetY + wiggleDistance * Math.cos(wigglePhi);
      camera.position.z = targetZ + wiggleDistance * Math.sin(wigglePhi) * Math.cos(wiggleTheta);
    }

    controls.update();

    if (camera.position.y < 0.2) {
      camera.position.y = 0.2;
    }
    if (controls.target.y < 0.0) {
      controls.target.y = 0.0;
    }
  };

  const destroy = () => {
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('wheel', handleWheel);
  };

  return {
    update,
    destroy
  };
}
