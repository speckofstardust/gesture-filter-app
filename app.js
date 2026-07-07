const video = document.getElementById('webcam');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// MediaPipe landmark indices used for L-shape detection
const LM = { WRIST: 0, THUMB_TIP: 4, INDEX_TIP: 8, MIDDLE_TIP: 12, RING_TIP: 16, PINKY_TIP: 20 };

// Frames a gesture must hold before the active state toggles (anti-flicker)
const HOLD_FRAMES = 3;

// Per-hand smoothing state keyed by MediaPipe handedness label ("Left" / "Right")
const gestureState = {
  Left:  { active: false, onCount: 0, offCount: 0 },
  Right: { active: false, onCount: 0, offCount: 0 },
};

function dist2D(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function angleDeg(origin, a, b) {
  const v1 = { x: a.x - origin.x, y: a.y - origin.y };
  const v2 = { x: b.x - origin.x, y: b.y - origin.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag = Math.sqrt((v1.x ** 2 + v1.y ** 2) * (v2.x ** 2 + v2.y ** 2));
  if (mag === 0) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI);
}

function isLShape(lm) {
  const wrist     = lm[LM.WRIST];
  const thumbTip  = lm[LM.THUMB_TIP];
  const indexTip  = lm[LM.INDEX_TIP];

  // Angle at the wrist between the two extended fingers
  const angle = angleDeg(wrist, thumbTip, indexTip);
  if (angle < 55 || angle > 125) return false;

  // Reference: how far the extended index tip is from the wrist
  const indexDist = dist2D(wrist, indexTip);

  // Middle / ring / pinky tips must be significantly closer to the wrist
  const CURL_RATIO = 0.8;
  const middleCurled = dist2D(wrist, lm[LM.MIDDLE_TIP]) < indexDist * CURL_RATIO;
  const ringCurled   = dist2D(wrist, lm[LM.RING_TIP])   < indexDist * CURL_RATIO;
  const pinkyCurled  = dist2D(wrist, lm[LM.PINKY_TIP])  < indexDist * CURL_RATIO;

  return middleCurled && ringCurled && pinkyCurled;
}

// Returns the smoothed active state after ticking the counter for this frame
function tickGesture(label, detected) {
  const s = gestureState[label];
  if (detected) {
    s.onCount  = Math.min(s.onCount + 1, HOLD_FRAMES);
    s.offCount = 0;
    if (s.onCount >= HOLD_FRAMES) s.active = true;
  } else {
    s.offCount = Math.min(s.offCount + 1, HOLD_FRAMES);
    s.onCount  = 0;
    if (s.offCount >= HOLD_FRAMES) s.active = false;
  }
  return s.active;
}

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

  // Draw mirrored video frame as the background
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(results.image, 0, 0, w, h);
  ctx.restore();

  const seenLabels = new Set();

  if (results.multiHandLandmarks && results.multiHandedness) {
    console.log('Hands detected:', results.multiHandLandmarks.length);

    results.multiHandLandmarks.forEach((landmarks, i) => {
      const label  = results.multiHandedness[i].label; // "Left" or "Right"
      seenLabels.add(label);

      const active = tickGesture(label, isLShape(landmarks));

      // Flip x so skeleton aligns with the mirrored video
      const mirrored = landmarks.map(lm => ({ x: 1 - lm.x, y: lm.y, z: lm.z }));

      const connectorColor = active ? '#00FF00' : '#888888';
      const dotColor       = active ? '#FFFF00' : '#FF4444';

      drawConnectors(ctx, mirrored, HAND_CONNECTIONS, { color: connectorColor, lineWidth: 2 });
      drawLandmarks(ctx, mirrored, { color: dotColor, lineWidth: 1, radius: 4 });

      if (active) {
        const wx = mirrored[LM.WRIST].x * w;
        const wy = mirrored[LM.WRIST].y * h;
        ctx.font = 'bold 32px sans-serif';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#000000';
        ctx.fillStyle   = '#00FF00';
        ctx.strokeText('L', wx + 14, wy - 14);
        ctx.fillText('L',   wx + 14, wy - 14);
      }
    });
  }

  // Tick off-counter for any hand label not present this frame
  for (const label of ['Left', 'Right']) {
    if (!seenLabels.has(label)) tickGesture(label, false);
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
