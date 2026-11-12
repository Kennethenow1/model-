import * as THREE from 'three';

/**
 * WebGL stand-in for the HTML story panel.
 * CSS3D does not render inside immersive WebXR sessions, so we draw
 * the same story onto a canvas texture for VR mode.
 */
export function createXrStoryPanel() {
  const width = 840;
  const height = 1120;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.31, 3.08),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      toneMapped: false,
    })
  );
  mesh.position.set(0, 1.7, -2.2);
  mesh.visible = false;

  let activeScene = 'ocean';

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
    ctx.clearRect(0, 0, width, height);

    // Card
    roundRect(24, 24, width - 48, height - 48, 36);
    ctx.fillStyle = 'rgba(247, 242, 232, 0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    let y = 90;
    ctx.fillStyle = '#6a635a';
    ctx.font = '600 22px "DM Sans", sans-serif';
    ctx.letterSpacing = '4px';
    ctx.fillText('A SHORT VOYAGE', 72, y);

    y += 58;
    ctx.fillStyle = '#1a1714';
    ctx.font = '400 54px "Instrument Serif", serif';
    ctx.fillText('Between Water and Sand', 72, y);

    y += 42;
    ctx.fillStyle = '#6a635a';
    ctx.font = '400 26px "DM Sans", sans-serif';
    y = wrapText(
      'In VR, look toward a section. The world follows your gaze.',
      72,
      y,
      width - 150,
      34
    );

    y += 28;
    ctx.strokeStyle = 'rgba(26,23,20,0.12)';
    ctx.beginPath();
    ctx.moveTo(72, y);
    ctx.lineTo(width - 72, y);
    ctx.stroke();
    y += 40;

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
      const boxH = 230;
      if (active) {
        roundRect(56, y - 10, width - 112, boxH, 18);
        ctx.fillStyle =
          section.id === 'ocean'
            ? 'rgba(58, 107, 140, 0.16)'
            : 'rgba(196, 163, 90, 0.18)';
        ctx.fill();
        ctx.strokeStyle =
          section.id === 'ocean'
            ? 'rgba(58, 107, 140, 0.4)'
            : 'rgba(196, 163, 90, 0.45)';
        ctx.stroke();
      }

      ctx.fillStyle = '#1a1714';
      ctx.font = '400 36px "Instrument Serif", serif';
      ctx.fillText(section.title, 80, y + 36);

      ctx.fillStyle = '#2c2823';
      ctx.font = '400 26px "DM Sans", sans-serif';
      wrapText(section.body, 80, y + 78, width - 180, 34);
      y += boxH + 28;
    }

    texture.needsUpdate = true;
  }

  function setActiveScene(name) {
    activeScene = name;
    paint();
  }

  paint();

  return {
    mesh,
    setActiveScene,
    setVisible(v) {
      mesh.visible = v;
    },
  };
}
