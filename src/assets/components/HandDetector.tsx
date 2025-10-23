// HandDetector.tsx
import { useEffect, useRef, useState } from "react";
import {
  HandLandmarker,
  FilesetResolver
} from "@mediapipe/tasks-vision";
import { classifySign, type SignMetrics } from "../utils/classifySign";
import "./HandDetector.css";

// same HAND_CONNECTIONS as before
const HAND_CONNECTIONS: ReadonlyArray<[number, number]> = [
  [0,1],  [1,2],  [2,3],  [3,4],
  [0,5],  [5,6],  [6,7],  [7,8],
  [0,9],  [9,10], [10,11], [11,12],
  [0,13], [13,14],[14,15], [15,16],
  [0,17], [17,18],[18,19], [19,20]
];

export default function HandDetector() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [handLandmarker, setHandLandmarker] = useState<HandLandmarker | null>(null);
  const [running, setRunning] = useState(false);
  const [gesture, setGesture] = useState<string>("");
  const [metrics, setMetrics] = useState<SignMetrics | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  // small stability buffer
  const bufferRef = useRef<string[]>([]);
  const stableGesture = (label: string, n = 5) => {
    bufferRef.current.push(label);
    if (bufferRef.current.length > n) bufferRef.current.shift();
    const freq: Record<string, number> = {};
    for (const l of bufferRef.current) freq[l] = (freq[l] || 0) + 1;
    return Object.entries(freq).sort((a,b) => b[1]-a[1])[0][0];
  };

  useEffect(() => {
    const init = async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
      );
      const detector = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1
      });
      setHandLandmarker(detector);
    };
    init();
  }, []);

  const startCamera = async () => {
    if (!videoRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    videoRef.current.srcObject = stream;
    videoRef.current.onloadeddata = () => setRunning(true);
  };

  useEffect(() => {
    if (!handLandmarker || !running) return;

    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const loop = async () => {
      // reset transform each frame
      ctx.setTransform(1,0,0,1,0,0);

      // Hi-DPI scale
      const dpr = window.devicePixelRatio || 1;
      canvas.width = video.videoWidth * dpr;
      canvas.height = video.videoHeight * dpr;
      canvas.style.width = `${video.videoWidth}px`;
      canvas.style.height = `${video.videoHeight}px`;
      ctx.scale(dpr, dpr);

      const startTime = performance.now();
      const result = await handLandmarker.detectForVideo(video, startTime);

      // clear
      ctx.clearRect(0, 0, video.videoWidth, video.videoHeight);

      if (result.landmarks && result.landmarks.length > 0) {
        const landmarks = result.landmarks[0];

        // mirror drawing to match mirrored video
        ctx.save();
        ctx.translate(video.videoWidth, 0);
        ctx.scale(-1, 1);

        // Draw connections
        ctx.strokeStyle = "#00FF00";
        ctx.lineWidth = 3;
        for (const [i, j] of HAND_CONNECTIONS) {
          const x1 = landmarks[i].x * video.videoWidth;
          const y1 = landmarks[i].y * video.videoHeight;
          const x2 = landmarks[j].x * video.videoWidth;
          const y2 = landmarks[j].y * video.videoHeight;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        // Draw landmarks
        ctx.fillStyle = "#FF0000";
        for (const lm of landmarks) {
          const x = lm.x * video.videoWidth;
          const y = lm.y * video.videoHeight;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();

        // classify + collect metrics
        const { label, metrics } = classifySign(landmarks);
        setMetrics(metrics);
        setGesture(stableGesture(label));
      }

      requestAnimationFrame(loop);
    };

    loop();

    return () => {
      if (video.srcObject) (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      setRunning(false);
      handLandmarker.close();
    };
  }, [handLandmarker, running]);

  return (
    <div className="hand-detector">
      <div className="hand-detector__viewer">
        <h2 className="hand-detector__gesture">Gesture: {gesture || "None"}</h2>

        <div className="hand-detector__controls">
          <button onClick={startCamera}>Start Camera</button>
          <label className="hand-detector__debug-toggle">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
            />
            Debug
          </label>
        </div>

        <div className="hand-detector__video-wrapper">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="hand-detector__video"
          />
          <canvas
            ref={canvasRef}
            className="hand-detector__canvas"
          />
          {showDebug && metrics && (
            <div className="hand-detector__debug-overlay">
              <div><b>Gaps</b> IM={metrics.gapIM.toFixed(3)} MR={metrics.gapMR.toFixed(3)} RP={metrics.gapRP.toFixed(3)}</div>
              <div>spockRatio={metrics.spockRatio.toFixed(3)}  cv={metrics.cv.toFixed(3)}</div>
              <div>thumb={metrics.thumbToIndexMCP.toFixed(3)}  out={String(metrics.thumbOut)}  along={String(metrics.thumbAlong)}</div>
              <div>ext: I={String(metrics.indexExt)} M={String(metrics.middleExt)} R={String(metrics.ringExt)} P={String(metrics.pinkyExt)}  cnt={metrics.extendedCount}</div>
              <div>cosIM={metrics.cosIM.toFixed(3)}  (scissors aim)</div>
            </div>
          )}
        </div>
      </div>

      <div className="hand-detector__rules">
        <h3>It's very simple.</h3>
        <div className="hand-detector__rules-content">
          <div><strong>Scissors</strong> cuts <strong>Paper</strong>,</div>
          <div><strong>Paper</strong> covers <strong>Rock</strong>,</div>
          <div><strong>Rock</strong> crushes <strong>Lizard</strong>,</div>
          <div><strong>Lizard</strong> poisons <strong>Spock</strong>,</div>
          <div><strong>Spock</strong> smashes <strong>Scissors</strong>,</div>
          <div><strong>Scissors</strong> decapitates <strong>Lizard</strong>,</div>
          <div><strong>Lizard</strong> eats <strong>Paper</strong>,</div>
          <div><strong>Paper</strong> disproves <strong>Spock</strong>,</div>
          <div><strong>Spock</strong> vaporizes <strong>Rock</strong>,</div>
          <div>and as it always has,</div>
          <div><strong>Rock</strong> crushes <strong>Scissors</strong>.</div>
        </div>
      </div>
    </div>
  );
}
