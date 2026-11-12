import * as THREE from 'three';

export function createOcean() {
  const group = new THREE.Group();
  group.name = 'ocean';

  const waterGeo = new THREE.PlaneGeometry(120, 120, 96, 96);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x2a5f7a,
    roughness: 0.28,
    metalness: 0.22,
    transparent: true,
    opacity: 1,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  group.add(water);

  const foamGeo = new THREE.PlaneGeometry(120, 120, 48, 48);
  const foamMat = new THREE.MeshStandardMaterial({
    color: 0x7eb0c9,
    roughness: 0.8,
    metalness: 0,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  const foam = new THREE.Mesh(foamGeo, foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.y = 0.08;
  group.add(foam);

  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0x2a3340,
    roughness: 1,
    transparent: true,
    opacity: 0.85,
  });
  for (let i = 0; i < 10; i++) {
    const cloud = new THREE.Mesh(
      new THREE.SphereGeometry(2.2 + Math.random() * 2.5, 12, 10),
      cloudMat.clone()
    );
    cloud.position.set(
      (Math.random() - 0.5) * 50,
      10 + Math.random() * 6,
      -18 - Math.random() * 30
    );
    cloud.scale.set(1.8 + Math.random(), 0.55, 1.2 + Math.random());
    group.add(cloud);
  }

  const rainGeo = new THREE.BufferGeometry();
  const rainCount = 900;
  const positions = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 40;
    positions[i * 3 + 1] = Math.random() * 20;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 40 - 5;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const rainMat = new THREE.PointsMaterial({
    color: 0xa8c4d8,
    size: 0.05,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const rain = new THREE.Points(rainGeo, rainMat);
  group.add(rain);

  const flash = new THREE.PointLight(0xb8d4ff, 0, 80);
  flash.position.set(0, 16, -10);
  group.add(flash);

  const basePositions = waterGeo.attributes.position.array.slice();
  const foamBase = foamGeo.attributes.position.array.slice();
  let nextFlash = 2 + Math.random() * 3;

  function update(time, intensity) {
    const pos = waterGeo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = basePositions[i];
      const z = basePositions[i + 2];
      const wave =
        Math.sin(x * 0.22 + time * 1.6) * 0.45 +
        Math.cos(z * 0.18 + time * 1.2) * 0.35 +
        Math.sin((x + z) * 0.12 + time * 2.1) * 0.25;
      pos[i + 1] = wave * (0.6 + intensity * 0.4);
    }
    waterGeo.attributes.position.needsUpdate = true;
    waterGeo.computeVertexNormals();

    const fpos = foamGeo.attributes.position.array;
    for (let i = 0; i < fpos.length; i += 3) {
      const x = foamBase[i];
      const z = foamBase[i + 2];
      fpos[i + 1] =
        Math.sin(x * 0.3 + time * 2.2) * 0.2 +
        Math.cos(z * 0.25 + time * 1.7) * 0.15;
    }
    foamGeo.attributes.position.needsUpdate = true;

    const rainPos = rainGeo.attributes.position.array;
    for (let i = 0; i < rainCount; i++) {
      rainPos[i * 3 + 1] -= (8 + (i % 5)) * 0.016 * (0.5 + intensity);
      rainPos[i * 3] -= 0.04 * intensity;
      if (rainPos[i * 3 + 1] < 0) {
        rainPos[i * 3 + 1] = 18 + Math.random() * 4;
        rainPos[i * 3] = (Math.random() - 0.5) * 40;
      }
    }
    rainGeo.attributes.position.needsUpdate = true;
    rainMat.opacity = 0.2 + intensity * 0.45;

    nextFlash -= 0.016;
    if (nextFlash <= 0) {
      flash.intensity = 18 + Math.random() * 22;
      nextFlash = 1.8 + Math.random() * 4.5;
    } else {
      flash.intensity *= 0.86;
    }
  }

  return { group, update };
}
