const CAMERA_STAGES = [
    {
        name: "monolith_aerial",
        cam: new THREE.Vector3(0.0, 8.5, -9.0),
        target: new THREE.Vector3(0.0, -2.1, -9.0),
        up: new THREE.Vector3(0.0, 0.0, -1.0),
        isTV: false
    },
    {
        name: "tv_aerial",
        cam: new THREE.Vector3(0.0, 8.5, 9.5),
        target: new THREE.Vector3(0.0, -2.5, 9.5),
        up: new THREE.Vector3(0.0, 0.0, -1.0),
        isTV: true
    },
    {
        name: "monolith_submerged_side",
        cam: new THREE.Vector3(7.2, 2.20, -5.8),
        target: new THREE.Vector3(0.0, 0.40, -9.0),
        up: new THREE.Vector3(0.0, 1.0, 0.0),
        isTV: false
    }
];

let currentStageIndex = 0;
let fromStageIndex = 0;
let targetStageIndex = 0;
let stageTransition = 1.0;
let fromCamPos = CAMERA_STAGES[0].cam.clone();
let toCamPos = CAMERA_STAGES[0].cam.clone();
let fromTargetPos = CAMERA_STAGES[0].target.clone();
let toTargetPos = CAMERA_STAGES[0].target.clone();
let fromUpVec = CAMERA_STAGES[0].up.clone();
let toUpVec = CAMERA_STAGES[0].up.clone();

function advanceCameraStage() {
    if (!isCameraLocked || isTVFocused || isExitingTV) return;
    if (stageTransition < 0.5) return; // Responsive & snappy transition trigger

    fromCamPos.copy(camera.position);
    fromTargetPos.copy(controls ? controls.target : CAMERA_STAGES[targetStageIndex].target);
    fromUpVec.copy(camera.up);
    fromStageIndex = targetStageIndex;

    targetStageIndex = (targetStageIndex + 1) % 3;
    toCamPos.copy(CAMERA_STAGES[targetStageIndex].cam);
    toTargetPos.copy(CAMERA_STAGES[targetStageIndex].target);
    toUpVec.copy(CAMERA_STAGES[targetStageIndex].up);

    stageTransition = 0.0;
    console.log(`[Camera Stage] Advanced from Stage ${fromStageIndex + 1} to Stage ${targetStageIndex + 1}: ${CAMERA_STAGES[targetStageIndex].name}`);
}

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

// Act 1 special sequence state variables
window.act1Factor = 0.0;
window.act1Target = 0.0;

window.setAct1FocusLock = function(active) {
    if (active) {
        document.body.classList.add('act1-focus-lock');
    } else {
        document.body.classList.remove('act1-focus-lock');
    }
    console.log(`[Act 1 Focus Lock] State set to: ${active}`);
};

window.setAct1UIBlocked = function(active) {
    if (active) {
        document.body.classList.add('act1-ui-blocked');
    } else {
        document.body.classList.remove('act1-ui-blocked');
    }
    console.log(`[Act 1 UI Block] State set to: ${active}`);
};

window.setAct1 = function(active, options = {}) {
    window.act1Target = active ? 1.0 : 0.0;
    if (active) {
        document.body.classList.add('act1-active');
        document.body.classList.remove('darkness-filter-active');
        if (options && options.focusLock) {
            window.setAct1FocusLock(true);
        }
        if (options && options.uiBlocked) {
            window.setAct1UIBlocked(true);
        }
    } else {
        document.body.classList.remove('act1-active');
        window.setAct1FocusLock(false);
        window.setAct1UIBlocked(false);
    }
    console.log(`[Act 1] State set to: ${active} (target: ${window.act1Target})`);
};

window.setDarknessFilter = function(active) {
    window.act1Target = active ? 1.0 : 0.0;
    if (active) {
        document.body.classList.add('darkness-filter-active');
        document.body.classList.remove('act1-active');
    } else {
        document.body.classList.remove('darkness-filter-active');
    }
    console.log(`[Darkness Filter] State set to: ${active} (target: ${window.act1Target})`);
};

