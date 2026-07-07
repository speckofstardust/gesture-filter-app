const video = document.getElementById('webcam');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const hands = new Hands({
  locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.5,
});

hands.onResults(results => {
  const w = canvas.width;
  const h = canvas.height;

  // Draw mirrored video frame
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(results.image, 0, 0, w, h);
  ctx.restore();

  if (!results.multiHandLandmarks) return;

  console.log('Hands detected:', results.multiHandLandmarks.length);

  for (const landmarks of results.multiHandLandmarks) {
    // Flip x so skeleton matches the mirrored video
    const mirrored = landmarks.map(lm => ({ x: 1 - lm.x, y: lm.y, z: lm.z }));

    drawConnectors(ctx, mirrored, HAND_CONNECTIONS, {
      color: '#00FF00',
      lineWidth: 2,
    });
    drawLandmarks(ctx, mirrored, {
      color: '#FF0000',
      lineWidth: 1,
      radius: 4,
    });
  }
});

const camera = new Camera(video, {
  onFrame: async () => {
    await hands.send({ image: video });
  },
  width: 1280,
  height: 720,
});

camera.start().catch(err => console.error('Camera start failed:', err));
