const params = {
    width: 2.0,
    height: 3.92,
    depth: 2.0,
    autoRotate: true,
    rotateSpeed: 0.5,
    particles: true,
    interiorLight: true,
    performanceMode: false,
    blackOffset: 0.0,
    whiteOffset: 0.020,
    redOffset: 0.08,
    animMult: 1.0,
    autoTime: true,
    timeOfDay: 12.0
};

let scene, camera, renderer, controls;
let cuboidGroup;
let starField;
let ambientLight, dirLight;
let interiorLights = [];
// Pre-cached list of red block meshes — built once on load, avoids per-frame traverse()
const redBlocks = [];

// Liquid floor globals
let liquidFloor, liquidFloorMat;
let liquidFloorReal;

// Atmospheric cloud globals
let cloudsGroup;
const clouds = [];

// Low-lying water fog and rising water particles
let waterParticles, waterParticleGeometry;
let waterParticlePositions, waterParticleColors, waterParticleSpeeds;

// Global color instances to avoid allocations in render loop
const bgColCached = new THREE.Color();
const ambColCached = new THREE.Color();
const keyColCached = new THREE.Color();
const waterColCached = new THREE.Color();
const cloudColCached = new THREE.Color();

// Idle power saver (Eco Mode) state & listeners
let lastUserInteraction = Date.now();
function resetIdleTimer() {
    lastUserInteraction = Date.now();
}
window.addEventListener('mousemove', resetIdleTimer, { passive: true });
window.addEventListener('mousedown', resetIdleTimer, { passive: true });
window.addEventListener('keydown', resetIdleTimer, { passive: true });
window.addEventListener('touchstart', resetIdleTimer, { passive: true });
window.addEventListener('scroll', resetIdleTimer, { passive: true });

// --- QUALITY MATERIALS (default) ---
// MeshStandardMaterial: 1 render pass, much cheaper than Physical/clearcoat
const standardRed = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff2200,
    emissiveIntensity: 0.35,
    roughness: 0.15,
    metalness: 0.05,
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
});
const standardWhite = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.65,
    roughness: 0.35,
    metalness: 0.0,
    side: THREE.DoubleSide
});
const standardBlack = new THREE.MeshStandardMaterial({
    color: 0x0c0b0a,
    roughness: 0.55,
    metalness: 0.15,
    side: THREE.DoubleSide
});

// --- PERFORMANCE MATERIALS (High Performance Mode toggle) ---
const lambertRed = new THREE.MeshLambertMaterial({
    color: 0xff0000, emissive: 0x330000, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
});
const lambertWhite = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xcccccc, side: THREE.DoubleSide });
const lambertBlack = new THREE.MeshLambertMaterial({ color: 0x0c0b0a, side: THREE.DoubleSide });

// Aliases so the rest of the code keeps working with the same variable names
let physicalRed   = standardRed;
let physicalWhite = standardWhite;
let physicalBlack = standardBlack;
