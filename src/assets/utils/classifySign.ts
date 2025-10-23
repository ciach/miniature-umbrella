// classifySign.ts
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type SignMetrics = {
  // normalized distances (scale = hand bbox diagonal)
  gapIM: number;    // index–middle
  gapMR: number;    // middle–ring
  gapRP: number;    // ring–pinky
  spockRatio: number; // gapMR / average(gapIM, gapRP)
  cv: number;         // spread uniformity for paper
  thumbToIndexMCP: number;
  thumbOut: boolean;
  thumbAlong: boolean;

  // extension flags and counts
  indexExt: boolean;
  middleExt: boolean;
  ringExt: boolean;
  pinkyExt: boolean;
  extendedCount: number;

  // directional similarity for scissors
  cosIM: number; // cosine similarity of index/middle direction vectors (tip←pip)
};

const clamp = (v: number, a = -1e9, b = 1e9) => Math.max(a, Math.min(b, v));

export function classifySign(landmarks: NormalizedLandmark[]): { label: string; metrics: SignMetrics } {
  const WRIST = 0;
  const TIP = { i: 8, m: 12, r: 16, p: 20, t: 4 };
  const PIP = { i: 6, m: 10, r: 14, p: 18 };
  const INDEX_MCP = 5;

  const dist = (a: number, b: number) => {
    const dx = landmarks[a].x - landmarks[b].x;
    const dy = landmarks[a].y - landmarks[b].y;
    return Math.hypot(dx, dy);
  };

  // Hand scale: bbox diagonal (robust to zoom)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const lm of landmarks) {
    if (lm.x < minX) minX = lm.x;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.y > maxY) maxY = lm.y;
  }
  const scale = Math.hypot(Math.max(maxX - minX, 1e-6), Math.max(maxY - minY, 1e-6));
  const norm = (v: number) => v / scale;

  // Extension: tip further from wrist than PIP
  const fartherThan = (tip: number, pip: number) => norm(dist(tip, WRIST) - dist(pip, WRIST)) > 0.07;
  const indexExt  = fartherThan(TIP.i, PIP.i);
  const middleExt = fartherThan(TIP.m, PIP.m);
  const ringExt   = fartherThan(TIP.r, PIP.r);
  const pinkyExt  = fartherThan(TIP.p, PIP.p);
  const extendedCount = Number(indexExt) + Number(middleExt) + Number(ringExt) + Number(pinkyExt);

  // Thumb openness
  const thumbToIndexMCP = norm(dist(TIP.t, INDEX_MCP));
  const thumbOut   = thumbToIndexMCP > 0.34;  // away from hand
  const thumbAlong = thumbToIndexMCP < 0.28;  // tucked/along the hand

  // Fingertip gaps
  const gapIM = norm(dist(TIP.i, TIP.m));
  const gapMR = norm(dist(TIP.m, TIP.r));
  const gapRP = norm(dist(TIP.r, TIP.p));

  // Paper uniformity
  const mean = (gapIM + gapMR + gapRP) / 3;
  const stdev = Math.sqrt(((gapIM - mean) ** 2 + (gapMR - mean) ** 2 + (gapRP - mean) ** 2) / 3);
  const cv = mean > 0 ? stdev / mean : 1;

  // Spock “V”
  const pairAvg = (gapIM + gapRP) / 2;
  const spockRatio = gapMR / Math.max(1e-6, pairAvg);

  // Direction vectors for scissors (tip - pip), cosine similarity
  const v = (tip: number, pip: number) => {
    const dx = landmarks[tip].x - landmarks[pip].x;
    const dy = landmarks[tip].y - landmarks[pip].y;
    const len = Math.hypot(dx, dy) || 1e-6;
    return { dx: dx / len, dy: dy / len };
  };
  const vi = v(TIP.i, PIP.i);
  const vm = v(TIP.m, PIP.m);
  const cosIM = clamp(vi.dx * vm.dx + vi.dy * vm.dy, -1, 1); // 1 means same direction

  const metrics: SignMetrics = {
    gapIM, gapMR, gapRP, spockRatio, cv, thumbToIndexMCP, thumbOut, thumbAlong,
    indexExt, middleExt, ringExt, pinkyExt, extendedCount, cosIM
  };

  const bent = (tip: number, pip: number) =>
    // negative or tiny margin => clearly not extended
    norm(dist(tip, WRIST) - dist(pip, WRIST)) < 0.03;

  // Thresholds (tune if needed)
  const T = {
    scissorsIMMaxGap: 0.28, // index & middle should be near each other
    scissorsCosMin: 0.80,   // pointing roughly same direction
    paperCV: 0.22,          // uniform spread
    spockRatio: 1.6,        // strong V
    spockGapMR: 0.23,
    pairTight: 0.24
  };



  // Order matters

  // SCISSORS: index+middle extended, ring+pinky bent (allow one stray), IM gap small-ish and directions aligned
  if (
    // exactly two extended: index + middle
    indexExt && middleExt && !ringExt && !pinkyExt &&

    // ring + pinky clearly bent (extra safety)
    bent(TIP.r, PIP.r) && bent(TIP.p, PIP.p) &&

    // index & middle are near each other and aimed the same way
    gapIM <= T.scissorsIMMaxGap &&
    cosIM >= T.scissorsCosMin

    // NOTE: removed the spockRatio gate entirely
  ) {
    return { label: "scissors", metrics };
  }

  // SPOCK: all extended, strong V, pairs tight, thumb out
  if (
    extendedCount === 4 &&
    spockRatio > T.spockRatio &&
    gapIM < T.pairTight && gapRP < T.pairTight &&
    gapMR > T.spockGapMR &&
    thumbOut
  ) {
    return { label: "spock", metrics };
  }

  // PAPER: all extended, uniform spread, no big V, thumb along the hand
  if (
    extendedCount === 4 &&
    cv < T.paperCV &&
    spockRatio <= T.spockRatio &&
    thumbAlong
  ) {
    return { label: "paper", metrics };
  }

  // ROCK: none/one extended and thumb not out
  if (extendedCount <= 1 && !thumbOut) {
    return { label: "rock", metrics };
  }

  // LIZARD: thumb out, middle+ring bent; index/pinky may vary
  if (thumbOut && !middleExt && !ringExt && (indexExt || pinkyExt)) {
    return { label: "lizard", metrics };
  }

  // Tie-breakers
  if (extendedCount === 4 && thumbOut && spockRatio > 1.35 && gapMR > 0.20) {
    return { label: "spock", metrics };
  }
  if (extendedCount <= 2 && thumbOut) {
    return { label: "lizard", metrics };
  }

  return { label: "unknown", metrics };
}
