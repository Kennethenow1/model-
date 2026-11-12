import * as THREE from 'three';

export function createDesert() {
  const group = new THREE.Group();
  group.name = 'desert';

  const groundGeo = new THREE.PlaneGeometry(140, 140, 80, 80);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xd4b06a,
    roughness: 0.88,
    metalness: 0.02,
    transparent: true,
    opacity: 1,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.2;
  group.add(ground);

  const duneMat = new THREE.MeshStandardMaterial({
    color: 0xd2b06a,
    roughness: 0.95,
    transparent: true,
    opacity: 1,
  });

  const duneSpecs = [
    { x: -14, z: -18, sx: 18, sy: 4.5, sz: 10 },
    { x: 12, z: -22, sx: 16, sy: 5.2, sz: 11 },
    { x: -4, z: -32, sx: 22, sy: 6.5, sz: 14 },
    { x: 20, z: -8, sx: 10, sy: 3.2, sz: 8 },
    { x: -22, z: -6, sx: 12, sy: 3.8, sz: 9 },
  ];

  for (const spec of duneSpecs) {
    const dune = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      duneMat.clone()
    );
    dune.position.set(spec.x, -0.15, spec.z);
    dune.scale.set(spec.sx, spec.sy, spec.sz);
    group.add(dune);
  }

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 24, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffe2a0,
      transparent: true,
      opacity: 1,
    })
  );
  sun.position.set(18, 16, -40);
  group.add(sun);

  const sunGlow = new THREE.PointLight(0xffc978, 1.4, 120);
  sunGlow.position.copy(sun.position);
  group.add(sunGlow);

  const heatGeo = new THREE.BufferGeometry();
  const heatCount = 200;
  const heatPos = new Float32Array(heatCount * 3);
  for (let i = 0; i < heatCount; i++) {
    heatPos[i * 3] = (Math.random() - 0.5) * 50;
    heatPos[i * 3 + 1] = 0.4 + Math.random() * 3;
    heatPos[i * 3 + 2] = (Math.random() - 0.5) * 40 - 8;
  }
  heatGeo.setAttribute('position', new THREE.BufferAttribute(heatPos, 3));
  const heatMat = new THREE.PointsMaterial({
    color: 0xffe8b8,
    size: 0.08,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const heat = new THREE.Points(heatGeo, heatMat);
  group.add(heat);

  const base = groundGeo.attributes.position.array.slice();

  function update(time, intensity) {
    const pos = groundGeo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = base[i];
      const z = base[i + 2];
      const dunes =
        Math.sin(x * 0.08 + 0.4) * 1.4 +
        Math.cos(z * 0.07) * 1.1 +
        Math.sin((x * 0.5 + z) * 0.05) * 0.7;
      pos[i + 1] = Math.max(0, dunes) * (0.4 + intensity * 0.6);
    }
    groundGeo.attributes.position.needsUpdate = true;
    groundGeo.computeVertexNormals();

    sun.material.opacity = 0.4 + intensity * 0.6;
    sunGlow.intensity = 0.4 + intensity * 1.2;

    const hp = heatGeo.attributes.position.array;
    for (let i = 0; i < heatCount; i++) {
      hp[i * 3 + 1] += 0.01 + Math.sin(time + i) * 0.004;
      hp[i * 3] += Math.sin(time * 0.7 + i) * 0.01;
      if (hp[i * 3 + 1] > 4) {
        hp[i * 3 + 1] = 0.3;
        hp[i * 3] = (Math.random() - 0.5) * 50;
      }
    }
    heatGeo.attributes.position.needsUpdate = true;
    heatMat.opacity = 0.1 + intensity * 0.3;
  }

  return { group, update };
}
