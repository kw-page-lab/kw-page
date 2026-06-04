let scrollProgress = 0;
let targetScrollProgress = 0;
let touchStartYScope = 0;
let isCameraLocked = true; // Lock state for vertical elevator mode
let isTVFocused = false;   // Focus state for double-clicking the monitor
let tvYaw = 0;             // Target look-around yaw (horizontal) offset
let tvPitch = 0;           // Target look-around pitch (vertical) offset
let currentTvYaw = 0;      // Smoothed look-around yaw
let currentTvPitch = 0;    // Smoothed look-around pitch
function getTVTargetFocusDistance() {
    if (window.innerWidth < 768) {
        const aspect = window.innerWidth / window.innerHeight;
        if (aspect < 1.0) {
            return Math.min(9.5, Math.max(7.5, 4.8 / aspect));
        } else {
            return 7.5;
        }
    } else {
        return 7.5;
    }
}
const baseTvFocusDist = getTVTargetFocusDistance();
let tvFocusDistance = baseTvFocusDist; // Smoothed focus distance
let tvTargetFocusDistance = baseTvFocusDist; // Target focus distance

function getTVCenterY() {
    return (window.tvBasePosition) ? window.tvBasePosition.y + (1.30 * (window.tvGroup ? window.tvGroup.scale.y : 2.2)) : 1.25;
}
let isDraggingTV = false;
let prevTvDragX = 0;
let prevTvDragY = 0;
let isExitingTV = false;   // TV focus exit transition state
let tvExitStartTime = 0;   // Start time of the exit transition

let frameCount = 0;
let lastTime = performance.now();
let lastFrameTime = performance.now();
let isPageVisible = true;
const fpsElement = document.getElementById('fps');

function createReflectionCamera() {
    // Placeholder — reflection camera not used in current render pipeline
}

function updateReflectionCamera() {
    // Reflect camera position across the floor plane (y = liquidFloor.position.y)
    const floorY = liquidFloor.position.y;
    const aboveFloor = camera.position.y - floorY;
    reflCamera.position.set(
        camera.position.x,
        floorY - aboveFloor,   // mirrored Y
        camera.position.z
    );

    // Reflect look direction
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    lookDir.y = -lookDir.y;
    const lookTarget = reflCamera.position.clone().add(lookDir);
    reflCamera.up.set(0, -1, 0);
    reflCamera.lookAt(lookTarget);
    reflCamera.updateMatrixWorld();
    reflCamera.projectionMatrix.copy(camera.projectionMatrix);
    reflCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

    // Texture matrix: world pos → NDC of reflected cam → [0,1]
    reflTextureMatrix.set(
        0.5, 0.0, 0.0, 0.5,
        0.0, 0.5, 0.0, 0.5,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    );
    reflTextureMatrix.multiply(reflCamera.projectionMatrix);
    reflTextureMatrix.multiply(reflCamera.matrixWorldInverse);
}
