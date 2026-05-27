import * as THREE from 'three';
import overlayVertexShader from './shaders/overlayVertex.glsl?raw';
import overlayFragmentShader from './shaders/overlayFragment.glsl?raw';

export function initOverlay() {
  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const shaderMaterial = new THREE.ShaderMaterial({
    vertexShader: overlayVertexShader,
    fragmentShader: overlayFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uDarkness: { value: 0.8 },
      uOffset: { value: 0.25 }
    },
    transparent: true,
    depthWrite: false,
    depthTest: false
  });

  const overlayGeometry = new THREE.PlaneGeometry(2, 2);
  const overlayMesh = new THREE.Mesh(overlayGeometry, shaderMaterial);
  overlayScene.add(overlayMesh);

  const update = (elapsedTime) => {
    shaderMaterial.uniforms.uTime.value = elapsedTime;
  };

  const destroy = () => {
    overlayGeometry.dispose();
    shaderMaterial.dispose();
  };

  return {
    overlayScene,
    overlayCamera,
    update,
    destroy
  };
}
