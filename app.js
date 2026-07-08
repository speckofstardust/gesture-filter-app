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

// Smoothed wrist positions in canvas pixel space, one per hand label
const smoothWrist = {
  Left:  { x: 0, y: 0 },
  Right: { x: 0, y: 0 },
};
const WRIST_LERP = 0.25; // fraction to move toward target each frame

function lerpWrist(label, targetX, targetY) {
  const s = smoothWrist[label];
  // Snap on first contact so the box doesn't slide in from (0,0)
  if (s.x === 0 && s.y === 0) { s.x = targetX; s.y = targetY; return; }
  s.x += (targetX - s.x) * WRIST_LERP;
  s.y += (targetY - s.y) * WRIST_LERP;
}

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

// lm = mirrored landmarks (x already flipped to match screen)
// label = 'Left' | 'Right' (assigned by screen position, leftmost hand = 'Left')
function isLShape(lm, label) {
  const wrist    = lm[LM.WRIST];
  const thumbTip = lm[LM.THUMB_TIP];
  const indexTip = lm[LM.INDEX_TIP];

  // Thumb must point inward toward the center of the frame.
  // Left hand (screen left)  → thumb tip must be to the RIGHT of the wrist (higher x)
  // Right hand (screen right) → thumb tip must be to the LEFT  of the wrist (lower x)
  const thumbDx = thumbTip.x - wrist.x;
  if (label === 'Left'  && thumbDx <= 0) return false;
  if (label === 'Right' && thumbDx >= 0) return false;

  // Angle at the wrist between thumb and index must look like an L
  const angle = angleDeg(wrist, thumbTip, indexTip);
  if (angle < 55 || angle > 125) return false;

  // Middle / ring / pinky must be curled relative to the extended index
  const indexDist = dist2D(wrist, indexTip);
  const CURL_RATIO = 0.7;
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
  ctx.scale(-1, 1); //to mirror the output video
  ctx.drawImage(results.image, 0, 0, w, h);
  ctx.restore();

  const seenLabels = new Set();

  if (results.multiHandLandmarks) {
    // Assign Left/Right by screen x-position rather than MediaPipe's handedness label.
    // MediaPipe's label can flip between frames for the same hand on a front-facing camera,
    // which would spuriously activate both gestureState objects from a single hand.
    const handList = results.multiHandLandmarks.map(landmarks => ({
      landmarks,
      mirrored: landmarks.map(lm => ({ x: 1 - lm.x, y: lm.y, z: lm.z })),
    }));
    handList.sort((a, b) => a.mirrored[LM.WRIST].x - b.mirrored[LM.WRIST].x);

    console.log('Hands detected:', handList.length);

    handList.forEach(({ mirrored }, idx) => {
      // With two hands, assign by sort order. With one hand, assign by which
      // side of the screen it's on — otherwise a lone right hand always gets
      // labeled 'Left' and fails the inward-thumb direction check.
      const label = handList.length === 2
        ? (idx === 0 ? 'Left' : 'Right')
        : (mirrored[LM.WRIST].x < 0.5 ? 'Left' : 'Right');
      seenLabels.add(label);

      const active = tickGesture(label, isLShape(mirrored, label));

      // Update smoothed wrist whenever this hand is visible (not just when active)
      lerpWrist(label, mirrored[LM.WRIST].x * w, mirrored[LM.WRIST].y * h);

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

  // Draw the live selection rectangle when both hands are holding the L-gesture
  if (gestureState.Left.active && gestureState.Right.active) {
    const x1 = smoothWrist.Left.x,  y1 = smoothWrist.Left.y;
    const x2 = smoothWrist.Right.x, y2 = smoothWrist.Right.y;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 255, 180, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    ctx.restore();
  } else {
    // Reset smoothed positions when a hand leaves so there's no stale snap on re-entry
    if (!gestureState.Left.active)  { smoothWrist.Left.x  = 0; smoothWrist.Left.y  = 0; }
    if (!gestureState.Right.active) { smoothWrist.Right.x = 0; smoothWrist.Right.y = 0; }
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
