import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const DESIGN = {
  bgColor: 0x030303,
  floorColor: 0x4f4f4f,
  spotlightColor: 0xffffff,
  fogColor: 0x030303,
  fogNear: 7.0,
  fogFar: 18.0
};

export function initScene(container, canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    stencil: false,
    depth: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DESIGN.bgColor);
  scene.fog = new THREE.Fog(DESIGN.fogColor, DESIGN.fogNear, DESIGN.fogFar);

  const isMobile = window.innerWidth < 768;
  const defaultDist = isMobile ? 7.2 : 5.6;
  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 1.30, 12.0 + defaultDist);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.02;
  controls.minPolarAngle = Math.PI / 2 - 0.25;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.minAzimuthAngle = -0.35;
  controls.maxAzimuthAngle = 0.35;
  controls.minDistance = isMobile ? 5.2 : 4.3;
  controls.maxDistance = isMobile ? 8.5 : 6.5;
  controls.enablePan = false;
  controls.target.set(0, 1.30, 12.0);

  const floorGeometry = new THREE.PlaneGeometry(100, 100);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: DESIGN.floorColor,
    roughness: 0.75,
    metalness: 0.05,
    flatShading: false
  });

  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);

  const handleResize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    const isMobileNow = width < 768;
    controls.minDistance = isMobileNow ? 5.2 : 4.3;
    controls.maxDistance = isMobileNow ? 8.5 : 6.5;

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  };

  window.addEventListener('resize', handleResize);

  const destroy = () => {
    window.removeEventListener('resize', handleResize);
    controls.dispose();
    floorGeometry.dispose();
    floorMaterial.dispose();
    renderer.dispose();
  };

  return {
    scene,
    camera,
    renderer,
    controls,
    destroy
  };
}
