const splash      = document.getElementById('loading-splash');
const barFill     = document.getElementById('loading-bar-fill');
const loadingText = document.getElementById('loading-text');

let progress = {
  scene: 10,
  overlay: 5,
  lights: 5,
  particles: 10,
  texture1: 0,
  texture2: 0,
  model: 0,
};

let done = false;

function setProgress(pct, label) {
  if (done) return;
  const clamped = Math.min(Math.max(Math.round(pct), 0), 100);
  if (barFill) {
    barFill.style.width = `${clamped}%`;
  }
  if (label && loadingText) {
    loadingText.textContent = label;
  }
}

export function setMilestone(key, value) {
  if (done) return;
  progress[key] = value;

  const total = Math.min(
    progress.scene +
    progress.overlay +
    progress.lights +
    progress.particles +
    progress.texture1 +
    progress.texture2 +
    progress.model,
    100
  );

  let label = 'Cargando...';
  if (total < 30) {
    label = 'Preparando escena...';
  } else if (progress.model < 50) {
    label = `Cargando modelo 3D... ${Math.round((progress.model / 50) * 100)}%`;
  } else if (progress.texture1 < 10 || progress.texture2 < 10) {
    label = 'Cargando texturas...';
  } else {
    label = 'Listo.';
  }

  setProgress(total, label);
}

export function milestoneComplete(key) {
  const maxValues = {
    scene: 10,
    overlay: 5,
    lights: 5,
    particles: 10,
  };
  if (maxValues[key] !== undefined) {
    setMilestone(key, maxValues[key]);
  }
}

export function finishLoading() {
  if (done) return;
  done = true;
  setProgress(100, 'Listo.');

  setTimeout(() => {
    if (splash) {
      splash.classList.add('done');
      splash.addEventListener('animationend', () => splash.remove(), { once: true });
    }
  }, 350);
}

