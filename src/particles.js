import * as THREE from 'three';

const createCircleTexture = (colorStr, size = 64) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, colorStr);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  
  return new THREE.CanvasTexture(canvas);
};

export function initParticles(scene) {
  const coldCount = 150;
  const coldGeometry = new THREE.BufferGeometry();
  const coldPositions = new Float32Array(coldCount * 3);
  const coldData = [];

  for (let i = 0; i < coldCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 3.8;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = Math.random() * 8;
    
    coldPositions[i * 3] = x;
    coldPositions[i * 3 + 1] = y;
    coldPositions[i * 3 + 2] = z;
    
    coldData.push({
      baseX: x,
      baseY: y,
      baseZ: z,
      speedX: (Math.random() - 0.5) * 0.002,
      speedY: Math.random() * 0.012 + 0.004,
      speedZ: (Math.random() - 0.5) * 0.002,
      swaySpeed: Math.random() * 1.5 + 0.4,
      swayAmp: Math.random() * 0.12 + 0.03
    });
  }

  coldGeometry.setAttribute('position', new THREE.BufferAttribute(coldPositions, 3));
  const coldMaterial = new THREE.PointsMaterial({
    size: 0.065,
    map: createCircleTexture('rgba(195, 235, 255, 0.75)'),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  });

  const coldParticles = new THREE.Points(coldGeometry, coldMaterial);
  scene.add(coldParticles);

  const warmCount = 110;
  const warmGeometry = new THREE.BufferGeometry();
  const warmPositions = new Float32Array(warmCount * 3);
  const warmData = [];

  for (let i = 0; i < warmCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 3.8;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = Math.random() * 8;
    
    warmPositions[i * 3] = x;
    warmPositions[i * 3 + 1] = y;
    warmPositions[i * 3 + 2] = z;
    
    warmData.push({
      baseX: x,
      baseY: y,
      baseZ: z,
      speedX: (Math.random() - 0.5) * 0.002,
      speedY: Math.random() * 0.010 + 0.004,
      speedZ: (Math.random() - 0.5) * 0.002,
      swaySpeed: Math.random() * 1.4 + 0.5,
      swayAmp: Math.random() * 0.10 + 0.02
    });
  }

  warmGeometry.setAttribute('position', new THREE.BufferAttribute(warmPositions, 3));
  const warmMaterial = new THREE.PointsMaterial({
    size: 0.055,
    map: createCircleTexture('rgba(255, 222, 175, 0.75)'),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  });

  const warmParticles = new THREE.Points(warmGeometry, warmMaterial);
  scene.add(warmParticles);

  const sootCount = 140;
  const sootGeometry = new THREE.BufferGeometry();
  const sootPositions = new Float32Array(sootCount * 3);
  const sootData = [];

  for (let i = 0; i < sootCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 10 + 1.5;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = Math.random() * 9;
    
    sootPositions[i * 3] = x;
    sootPositions[i * 3 + 1] = y;
    sootPositions[i * 3 + 2] = z;
    
    sootData.push({
      baseX: x,
      baseY: y,
      baseZ: z,
      speedX: (Math.random() - 0.5) * 0.003,
      speedY: -(Math.random() * 0.008 + 0.004),
      speedZ: (Math.random() - 0.5) * 0.003,
      swaySpeed: Math.random() * 0.8 + 0.2,
      swayAmp: Math.random() * 0.20 + 0.05
    });
  }

  sootGeometry.setAttribute('position', new THREE.BufferAttribute(sootPositions, 3));
  const sootMaterial = new THREE.PointsMaterial({
    size: 0.18,
    map: createCircleTexture('rgba(28, 28, 28, 0.72)'),
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: true
  });

  const sootParticles = new THREE.Points(sootGeometry, sootMaterial);
  scene.add(sootParticles);

  const update = (elapsedTime) => {
    const coldPos = coldGeometry.attributes.position.array;
    for (let i = 0; i < coldCount; i++) {
      const idx = i * 3;
      const d = coldData[i];
      
      d.baseY += d.speedY;
      d.baseX += d.speedX;
      d.baseZ += d.speedZ;
      
      if (d.baseY > 8.0) {
        d.baseY = 0;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 3.8;
        d.baseX = Math.cos(angle) * radius;
        d.baseZ = Math.sin(angle) * radius;
      }
      
      coldPos[idx] = d.baseX + Math.sin(elapsedTime * d.swaySpeed) * d.swayAmp;
      coldPos[idx + 1] = d.baseY;
      coldPos[idx + 2] = d.baseZ + Math.cos(elapsedTime * d.swaySpeed) * d.swayAmp;
    }
    coldGeometry.attributes.position.needsUpdate = true;

    const warmPos = warmGeometry.attributes.position.array;
    for (let i = 0; i < warmCount; i++) {
      const idx = i * 3;
      const d = warmData[i];
      
      d.baseY += d.speedY;
      d.baseX += d.speedX;
      d.baseZ += d.speedZ;
      
      if (d.baseY > 8.0) {
        d.baseY = 0;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 3.8;
        d.baseX = Math.cos(angle) * radius;
        d.baseZ = Math.sin(angle) * radius;
      }
      
      warmPos[idx] = d.baseX + Math.sin(elapsedTime * d.swaySpeed) * d.swayAmp;
      warmPos[idx + 1] = d.baseY;
      warmPos[idx + 2] = d.baseZ + Math.cos(elapsedTime * d.swaySpeed) * d.swayAmp;
    }
    warmGeometry.attributes.position.needsUpdate = true;

    const sootPos = sootGeometry.attributes.position.array;
    for (let i = 0; i < sootCount; i++) {
      const idx = i * 3;
      const d = sootData[i];
      
      d.baseY += d.speedY;
      d.baseX += d.speedX;
      d.baseZ += d.speedZ;
      
      if (d.baseY < 0.0) {
        d.baseY = 9.0;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 10 + 1.5;
        d.baseX = Math.cos(angle) * radius;
        d.baseZ = Math.sin(angle) * radius;
      }
      
      sootPos[idx] = d.baseX + Math.sin(elapsedTime * d.swaySpeed) * d.swayAmp;
      sootPos[idx + 1] = d.baseY;
      sootPos[idx + 2] = d.baseZ + Math.cos(elapsedTime * d.swaySpeed) * d.swayAmp;
    }
    sootGeometry.attributes.position.needsUpdate = true;
  };

  const destroy = () => {
    coldGeometry.dispose();
    coldMaterial.dispose();
    warmGeometry.dispose();
    warmMaterial.dispose();
    sootGeometry.dispose();
    sootMaterial.dispose();
  };

  return {
    coldParticles,
    warmParticles,
    sootParticles,
    update,
    destroy
  };
}
