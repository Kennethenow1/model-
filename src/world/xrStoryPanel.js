import * as THREE from 'three';

/**
 * WebGL stand-in for the HTML / CSS3D story panel.
 * One opaque textured board (no overlapping transparent planes) so text stays
 * readable and the back doesn’t z-fight / glitch.
 */
export function createXrStoryPanel() {
  const width = 1024;
  const height = 1365;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const panelW = 2.31;
  const panelH = 3.08;
  const thickness = 0.1;

  const group = new THREE.Group();
  group.name = 'xrStoryPanel';
  group.position.set(0, 1.7, -2.2);
  group.visible = false;

  const sideMat = new THREE.MeshStandardMaterial({
    color: 0xd4cbb8,
    roughness: 0.55,
    metalness: 0.1,
  });
  const backMat = new THREE.MeshStandardMaterial({
    color: 0x2a2620,
    roughness: 0.8,
    metalness: 0.05,
  });
  const frontMat = new THREE.MeshBasicMaterial({
    map: texture,
    toneMapped: false,
    // Opaque — transparent + overlapping geo was eating the text in XR
    transparent: false,
    depthWrite: true,
  });

  // Box materials: +x, -x, +y, -y, +z (front), -z (back)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(panelW, panelH, thickness),
    [sideMat, sideMat, sideMat, sideMat, frontMat, backMat]
  );
  group.add(body);

  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(panelW + 0.05, panelH + 0.05, thickness * 0.45),
    new THREE.MeshStandardMaterial({
      color: 0xb8b0a2,
      roughness: 0.35,
      metalness: 0.4,
    })
  );
  rim.position.z = -thickness * 0.15;
  group.add(rim);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(panelW + 0.45, panelH + 0.45),
    new THREE.MeshBasicMaterial({
      color: 0x7eb7ff,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      // Front only — DoubleSide caused flash/glitch when viewed from behind
      side: THREE.FrontSide,
    })
  );
  glow.position.z = -thickness * 0.5 - 0.03;
  group.add(glow);

  const pedestal = new THREE.Mesh(
    new THREE.CircleGeometry(1.05, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  pedestal.rotation.x = -Math.PI / 2;
  pedestal.position.set(0, -1.55, 0.1);
  group.add(pedestal);

  // Invisible front plane for stable UV gaze hits (same size as board face)
  const hit = new THREE.Mesh(
    new THREE.PlaneGeometry(panelW, panelH),
    new THREE.MeshBasicMaterial({
      visible: false,
      side: THREE.DoubleSide,
    })
  );
  hit.position.z = thickness * 0.5 + 0.001;
  group.add(hit);

  let activeScene = 'ocean';
  let floatT = 0;

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let yy = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, yy);
        line = word;
        yy += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, yy);
    return yy + lineHeight;
  }

  function paint() {
    // Fully opaque backdrop so XR doesn’t composite garbage
    ctx.fillStyle = '#f3eee4';
    ctx.fillRect(0, 0, width, height);

    roundRect(28, 28, width - 56, height - 56, 40);
    ctx.fillStyle = '#f7f2e8';
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 34, 28, 0.12)';
    ctx.lineWidth = 3;
    ctx.stroke();

    let y = 110;
    ctx.fillStyle = '#6a635a';
    ctx.font = '600 28px system-ui, "DM Sans", sans-serif';
    ctx.fillText('A SHORT VOYAGE', 88, y);

    y += 70;
    ctx.fillStyle = '#1a1714';
    ctx.font = '400 64px "Instrument Serif", Georgia, serif';
    ctx.fillText('Between Water and Sand', 88, y);

    y += 52;
    ctx.fillStyle = '#5a544c';
    ctx.font = '400 30px system-ui, "DM Sans", sans-serif';
    y = wrapText(
      'In VR, look toward a section. The world follows your gaze.',
      88,
      y,
      width - 180,
      40
    );

    y += 36;
    ctx.strokeStyle = 'rgba(26,23,20,0.14)';
    ctx.beginPath();
    ctx.moveTo(88, y);
    ctx.lineTo(width - 88, y);
    ctx.stroke();
    y += 48;

    const sections = [
      {
        id: 'ocean',
        title: 'I. The Storm',
        body: 'Rain arrives sideways. The deck lifts and drops, and salt finds every seam in your coat. Lightning sketches the horizon — then the dark closes again.',
      },
      {
        id: 'desert',
        title: 'II. The Desert',
        body: 'Heat replaces the cold. Only dunes remain, soft and endless under a hard white sun. A shimmer ahead pretends to be water.',
      },
    ];

    for (const section of sections) {
      const active = section.id === activeScene;
      const boxH = 280;
      if (active) {
        roundRect(68, y - 14, width - 136, boxH, 22);
        ctx.fillStyle =
          section.id === 'ocean'
            ? 'rgba(58, 107, 140, 0.18)'
            : 'rgba(196, 163, 90, 0.2)';
        ctx.fill();
        ctx.strokeStyle =
          section.id === 'ocean'
            ? 'rgba(58, 107, 140, 0.45)'
            : 'rgba(196, 163, 90, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.fillStyle = '#1a1714';
      ctx.font = '400 44px "Instrument Serif", Georgia, serif';
      ctx.fillText(section.title, 96, y + 44);

      ctx.fillStyle = '#2c2823';
      ctx.font = '400 30px system-ui, "DM Sans", sans-serif';
      wrapText(section.body, 96, y + 96, width - 220, 40);
      y += boxH + 36;
    }

    texture.needsUpdate = true;
  }

  function setActiveScene(name) {
    activeScene = name;
    glow.material.color.set(name === 'desert' ? 0xe0b56a : 0x7eb7ff);
    paint();
  }

  function update(dt = 0.016) {
    if (!group.visible) return;
    floatT += dt;
    group.position.y = 1.7 + Math.sin(floatT * 0.7) * 0.03;
    group.rotation.y = Math.sin(floatT * 0.17) * 0.035;
    group.rotation.x = Math.sin(floatT * 0.28) * 0.012;
  }

  // Paint after fonts have a chance to load
  paint();
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => paint()).catch(() => {});
  }

  return {
    get mesh() {
      return hit;
    },
    group,
    hitMesh: hit,
    setActiveScene,
    update,
    setVisible(v) {
      group.visible = v;
      if (v) paint();
    },
  };
}
