import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type SignMetrics = {
  gapIM: number; gapMR: number; gapRP: number;
  spockRatio: number; cv: number;
  thumbToIndexMCP: number; thumbOut: boolean; thumbAlong: boolean;
  indexExt: boolean; middleExt: boolean; ringExt: boolean; pinkyExt: boolean; extendedCount: number;
  cosIM: number;
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

  // Hand scale via bbox diagonal
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const lm of landmarks) {
    if (lm.x < minX) minX = lm.x;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.y > maxY) maxY = lm.y;
  }
  const scale = Math.hypot(Math.max(maxX - minX, 1e-6), Math.max(maxY - minY, 1e-6));
  const norm = (v: number) => v / scale;

  // Extension using wrist distance
  const fartherThan = (tip: number, pip: number) => norm(dist(tip, WRIST) - dist(pip, WRIST)) > 0.07;
  const bent = (tip: number, pip: number) => norm(dist(tip, WRIST) - dist(pip, WRIST)) < 0.03;

  const indexExt  = fartherThan(TIP.i, PIP.i);
  const middleExt = fartherThan(TIP.m, PIP.m);
  const ringExt   = fartherThan(TIP.r, PIP.r);
  const pinkyExt  = fartherThan(TIP.p, PIP.p);
  const extendedCount = Number(indexExt) + Number(middleExt) + Number(ringExt) + Number(pinkyExt);

  // Thumb metrics
  const thumbToIndexMCP = norm(dist(TIP.t, INDEX_MCP));
  const THUMB_OUT_HARD = 0.33;
  const THUMB_OUT_SOFT = 0.31;  // new: borderline “out” still counts if V is strong
  const THUMB_ALONG    = 0.28;
  const thumbOutHard = thumbToIndexMCP > THUMB_OUT_HARD;
  const thumbOutSoft = thumbToIndexMCP > THUMB_OUT_SOFT;
  const thumbAlong = thumbToIndexMCP < THUMB_ALONG;

  // Gaps
  const gapIM = norm(dist(TIP.i, TIP.m));
  const gapMR = norm(dist(TIP.m, TIP.r));
  const gapRP = norm(dist(TIP.r, TIP.p));
  const pairAvg = (gapIM + gapRP) / 2;
  const spockRatio = gapMR / Math.max(pairAvg, 1e-6);

  // “paper” uniformity
  const mean = (gapIM + gapMR + gapRP) / 3;
  const stdev = Math.sqrt(((gapIM - mean) ** 2 + (gapMR - mean) ** 2 + (gapRP - mean) ** 2) / 3);
  const cv = mean > 0 ? stdev / mean : 1;

  // Direction alignment for scissors
  const v = (tip: number, pip: number) => {
    const dx = landmarks[tip].x - landmarks[pip].x;
    const dy = landmarks[tip].y - landmarks[pip].y;
    const len = Math.hypot(dx, dy) || 1e-6;
    return { dx: dx / len, dy: dy / len };
  };
  const vi = v(TIP.i, PIP.i);
  const vm = v(TIP.m, PIP.m);
  const cosIM = clamp(vi.dx * vm.dx + vi.dy * vm.dy, -1, 1);

  const metrics: SignMetrics = {
    gapIM, gapMR, gapRP, spockRatio, cv,
    thumbToIndexMCP, thumbOut: thumbOutHard, thumbAlong,
    indexExt, middleExt, ringExt, pinkyExt, extendedCount, cosIM
  };

  // Tunables — adjusted for your screenshots
  const T = {
    scissorsIMMaxGap: 0.28,   // loosened for real-world spacing
    scissorsCosMin: 0.80,
    paperCV: 0.35,
    spockRatio: 1.45,         // lowered: your 1.55–1.78 now qualifies
    spockGapMR: 0.18,         // lowered absolute split floor
    pairTight: 0.22           // keep IM and RP modest to avoid “paper”
  };

  // SCISSORS: exactly index+middle extended, others bent; fingers aligned & near
  if (
    indexExt && middleExt && !ringExt && !pinkyExt &&
    bent(TIP.r, PIP.r) && bent(TIP.p, PIP.p) &&
    gapIM <= T.scissorsIMMaxGap &&
    cosIM >= T.scissorsCosMin
  ) {
    return { label: "scissors", metrics };
  }

  // SPOCK (primary): 4 extended, strong V, pairs tight, thumb out (hard)
  if (
    extendedCount === 4 &&
    spockRatio > T.spockRatio &&
    gapIM < T.pairTight && gapRP < T.pairTight &&
    (gapMR > T.spockGapMR) &&
    thumbOutHard
  ) {
    return { label: "spock", metrics };
  }

  // SPOCK (soft/borderline): strong V OR very strong ratio, pairs tight,
  // thumb at least softly out
  if (
    extendedCount === 4 &&
    ((spockRatio > T.spockRatio && gapMR > T.spockGapMR - 0.02) || spockRatio > 1.70) &&
    gapIM < T.pairTight + 0.02 && gapRP < T.pairTight + 0.02 &&
    thumbOutSoft
  ) {
    return { label: "spock", metrics };
  }

  // PAPER: all extended, uniform spread, no big V, thumb along the hand
// --- PAPER (strict) ---
  if (
    extendedCount === 4 &&
    thumbAlong &&                  // thumb tucked/along the hand
    spockRatio <= 1.35 &&          // not a V split
    cv < T.paperCV &&              // reasonably uniform
    gapIM < 0.30 && gapMR < 0.30 && gapRP < 0.30
  ) {
    return { label: "paper", metrics };
  }

  // --- PAPER (loose fallback) ---
  // if strict uniformity fails, still accept "flat hand"
  // as long as there's no V and spread isn't wildly uneven
  const maxGap = Math.max(gapIM, gapMR, gapRP);
  const minGap = Math.min(gapIM, gapMR, gapRP);
  if (
    extendedCount === 4 &&
    thumbAlong &&
    spockRatio <= 1.25 &&          // clearly not Spock
    maxGap <= 0.32 &&              // prevent wide splay impersonating Spock
    (maxGap - minGap) <= 0.18      // tolerate some asymmetry
  ) {
    return { label: "paper", metrics };
  }

  // ROCK
  if (extendedCount <= 1 && !thumbOutSoft) {
    return { label: "rock", metrics };
  }

  // LIZARD
  if (thumbOutSoft && !middleExt && !ringExt && (indexExt || pinkyExt)) {
    return { label: "lizard", metrics };
  }

  // Tie-breakers
  if (extendedCount === 4 && thumbOutSoft && spockRatio > 1.35 && gapMR > 0.16) {
    return { label: "spock", metrics };
  }
  if (extendedCount <= 2 && thumbOutSoft) {
    return { label: "lizard", metrics };
  }

  return { label: "unknown", metrics };
}
