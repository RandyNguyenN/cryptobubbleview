import { selectChangeByTimeframe } from "./metrics";
import {
  BubbleMetric,
  BubbleNode,
  CoinMarket,
  Layout2DState,
  SizeMode,
  Timeframe
} from "./types.js";

export const MIN_RADIUS = 18;
export const MAX_RADIUS = 54;

export interface BuildBubbleOptions {
  timeframe?: Timeframe;
  sizeMode?: SizeMode;
  depthRange?: { min: number; max: number };
  width?: number;
  height?: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calcRadius(metric: BubbleMetric, ranges: {
  minCap: number;
  maxCap: number;
  minChange: number;
  maxChange: number;
  minVolume?: number;
  maxVolume?: number;
  mode?: SizeMode;
}): number {
  const mode = ranges.mode ?? "cap";
  const mapArea = (norm: number, anchorScale = 1.55) => {
    const minArea = Math.pow(MIN_RADIUS * 0.75, 2);
    const maxArea = Math.pow(MAX_RADIUS * anchorScale, 2);
    return minArea + clamp(norm, 0, 1) * (maxArea - minArea);
  };

  if (mode === "percent") {
    // Revert to simpler proportional sizing for percent change
    const val = metric.change;
    const minV = ranges.minChange ?? 0;
    const maxV = ranges.maxChange ?? 1;
    const norm = (val - minV) / ((maxV - minV) || 1);
    return MIN_RADIUS + clamp(norm, 0, 1) * (MAX_RADIUS - MIN_RADIUS);
  }

  if (mode === "volume") {
    const vol = metric.volume || ranges.minVolume || 1;
    const minVol = Math.max(1, ranges.minVolume || 1);
    const maxVol = Math.max(minVol + 1, ranges.maxVolume || minVol + 1);
    const effMinVol = Math.max(minVol, maxVol / 25); // keep contrast but avoid extreme flattening
    const volClamped = clamp(vol, effMinVol, maxVol);
    const norm = clamp(
      Math.log(volClamped / effMinVol) / (Math.log(maxVol / effMinVol) || 1),
      0,
      1
    );
    const eased = Math.pow(norm, 1.1);
    const area = mapArea(eased, 1.55);
    return Math.sqrt(area);
  }

  // cap
  const cap = metric.cap || ranges.minCap || 1;
  const minCap = ranges.minCap || 1;
  const maxCap = ranges.maxCap || minCap + 1;
  const effMinCap = Math.max(minCap, maxCap / 25);
  const capClamped = clamp(cap, effMinCap, maxCap);
  const norm = clamp(
    Math.log(capClamped / effMinCap) / (Math.log(maxCap / effMinCap) || 1),
    0,
    1
  );
  const eased = Math.pow(norm, 1.1);
  const area = mapArea(eased, 1.55);
  return Math.sqrt(area);
}

export function computeMetrics(coins: CoinMarket[], timeframe: Timeframe): BubbleMetric[] {
  const tf = timeframe ?? "24h";
  return coins.map((coin) => ({
    coin,
    cap: coin.market_cap ?? 0,
    change: Math.abs(selectChangeByTimeframe(coin, tf) ?? 0),
    volume: coin.total_volume ?? 1
  }));
}

export function scatterPosition(index: number, total: number, depthRange = { min: -1, max: 1 }) {
  const phi = Math.acos(2 * (index + 0.5) / total - 1);
  const theta = Math.PI * (1 + Math.sqrt(5)) * (index + 0.5);
  const r = 1.0;
  const x = r * Math.cos(theta) * Math.sin(phi);
  const y = r * Math.sin(theta) * Math.sin(phi);
  const z = r * Math.cos(phi);
  const depth = depthRange.min + (depthRange.max - depthRange.min) * ((z + 1) / 2);

  const norm = (index + 0.5) / total;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const angle = golden * (index + 0.5);
  const r2d = Math.sqrt(norm) * 0.9;
  const x2d = Math.cos(angle) * r2d;
  const y2d = Math.sin(angle) * r2d;

  return { x, y, z, depth, x2d, y2d };
}

export function buildBubbleNodes(
  coins: CoinMarket[],
  options: BuildBubbleOptions = {}
): BubbleNode[] {
  const { timeframe = "24h", sizeMode = "cap", depthRange = { min: -1, max: 1 } } = options;
  if (!coins.length) return [];

  const metrics = computeMetrics(coins, timeframe);
  const caps = metrics.map((m) => m.cap).filter((v) => v > 0);
  const changes = metrics.map((m) => m.change);
  const volumes = metrics.map((m) => m.volume).filter((v) => v > 0);
  const minCap = caps.length ? Math.min(...caps) : 0;
  const maxCap = caps.length ? Math.max(...caps) : 1;
  const minChange = changes.length ? Math.min(...changes) : 0;
  const maxChange = changes.length ? Math.max(...changes) : 1;
  const minVolume = volumes.length ? Math.min(...volumes) : 0;
  const maxVolume = volumes.length ? Math.max(...volumes) : 1;

  let radiusByIndex: number[] | null = null;
  if (sizeMode === "volume" || sizeMode === "cap") {
    // Derive radii sequentially: largest bubble anchors size, next bubble scales from previous by volume ratio
    // with a bias to reduce drop-off (so a 3x smaller volume is not 3x smaller area).
    const sorted = metrics
      .map((m, i) => {
        const val =
          sizeMode === "volume"
            ? Math.max(m.volume, 1)
            : Math.max(m.cap, 1);
        return { i, val };
      })
      .sort((a, b) => b.val - a.val);
    const maxVal = sorted[0]?.val ?? 1;
    const minVal = sorted[sorted.length - 1]?.val ?? 1;
    const spread = maxVal / Math.max(minVal, 1);
    // When cap/volume values are very close (mid/low pages), compress sizes so the canvas is not flooded.
    const tightness = clamp((spread - 2) / 10, 0, 1); // spread <=2 => tightness 0, >=12 => 1
    const globalScale = 0.72 + 0.28 * tightness;
    const baseMax = MAX_RADIUS * 1.55; // anchor bubble
    const minR = MIN_RADIUS * 0.65;
    radiusByIndex = new Array(coins.length).fill(MIN_RADIUS);
    if (sorted.length) {
      radiusByIndex[sorted[0].i] = baseMax;
      for (let k = 1; k < sorted.length; k++) {
        const prev = sorted[k - 1];
        const current = sorted[k];
        const ratio = clamp(current.val / Math.max(prev.val, 1), 0, 1);
        // Blend raw ratio with a moderate floor to lessen shrink; ratio^0.5 keeps ordering, bias lifts small volumes.
        const easedRatio = Math.pow(ratio, 0.5);
        const weighted = 0.5 + 0.5 * easedRatio;
        const r = Math.max(minR, radiusByIndex[prev.i] * weighted);
        radiusByIndex[current.i] = r;
      }
      radiusByIndex = radiusByIndex.map((r) => Math.max(MIN_RADIUS * 0.7, r * globalScale));
    }
  }

  const total = coins.length || 1;
  const nodes = coins.map((coin, index) => {
    const metric = metrics[index];
    const radius =
      radiusByIndex !== null
        ? radiusByIndex[index]
        : calcRadius(metric, {
            minCap,
            maxCap,
            minChange,
            maxChange,
            minVolume,
            maxVolume,
            mode: sizeMode
          });
    const sizeFactor = (radius - MIN_RADIUS) / (MAX_RADIUS - MIN_RADIUS || 1);
    const pos = scatterPosition(index, total, depthRange);

    return {
      coin,
      radius,
      sizeFactor,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      depth: pos.depth,
      x2d: pos.x2d,
      y2d: pos.y2d
    } satisfies BubbleNode;
  });

  const width = Math.max(200, options.width ?? 0);
  const height = Math.max(200, options.height ?? 0);
  if (width && height) {
    compute2DLayout(nodes, width, height);
    resolveInitialOverlaps(nodes, width, height);
  }

  return nodes;
}

export function compute2DLayout(nodes: BubbleNode[], width: number, height: number): void {
  if (!nodes.length) return;
  const w = Math.max(200, width);
  const h = Math.max(200, height);
  const sorted = [...nodes].sort((a, b) => b.radius - a.radius);
  const count = nodes.length || 1;
  const avgRadius = sorted.reduce((acc, node) => acc + node.radius, 0) / count;

  const baseArea = sorted.reduce((acc, node) => {
    const baseScale = 0.75 + node.sizeFactor * 0.45;
    return acc + Math.PI * Math.pow(node.radius * baseScale, 2);
  }, 0);

  const baseCoverage = count > 80 ? 0.75 : count > 60 ? 0.78 : 0.82;
  // If average radius is large (happens when sizes are close), reduce coverage so initial layout has more breathing room.
  const radiusInflation = clamp((avgRadius - 30) / 18, 0, 1); // kicks in when avg radius >30
  const coverageTarget = clamp(baseCoverage - radiusInflation * 0.12, 0.62, baseCoverage);
  const targetArea = w * h * coverageTarget;
  const areaScale = clamp(Math.sqrt((targetArea || 1) / (baseArea || 1)), 0.85, 1.35);

  sorted.forEach((node) => {
    const targetScale = (0.75 + node.sizeFactor * 0.45) * areaScale;
    const rPx = node.radius * targetScale;
    if (node.layout2d) {
      node.layout2d.scale = targetScale;
      return;
    }

    const margin = 8;
    const x = margin + rPx + Math.random() * (w - 2 * (margin + rPx));
    const y = margin + rPx + Math.random() * (h - 2 * (margin + rPx));

    node.layout2d = {
      x,
      y,
      scale: targetScale,
      vx: (Math.random() - 0.5) * 10,
      vy: (Math.random() - 0.5) * 10,
      seed: Math.random() * Math.PI * 2,
      t: Math.random() * Math.PI * 2
    };
  });
}

export function resolveInitialOverlaps(nodes: BubbleNode[], width: number, height: number): void {
  const margin = 12;
  const w = Math.max(width, 200);
  const h = Math.max(height, 200);
  const iterations = 14;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (!a.layout2d || !b.layout2d) continue;
        const ar = a.radius * a.layout2d.scale;
        const br = b.radius * b.layout2d.scale;
        const dx = b.layout2d.x - a.layout2d.x;
        const dy = b.layout2d.y - a.layout2d.y;
        const distSq = dx * dx + dy * dy;
        const minDist = ar + br + 8;
        if (distSq < minDist * minDist && distSq > 0.0001) {
          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          const push = overlap * 0.5;
          a.layout2d.x -= nx * push;
          a.layout2d.y -= ny * push;
          b.layout2d.x += nx * push;
          b.layout2d.y += ny * push;
        }
      }
    }

    nodes.forEach((node) => {
      const p = node.layout2d;
      if (!p) return;
      const r = node.radius * p.scale;
      const maxX = w - margin - r;
      const minX = margin + r;
      const maxY = h - margin - r;
      const minY = margin + r;
      p.x = clamp(p.x, minX, maxX);
      p.y = clamp(p.y, minY, maxY);
    });
  }
}

export function update2DPhysics(nodes: BubbleNode[], width: number, height: number, dt: number): void {
  const margin = 12;
  const w = Math.max(width, 200);
  const h = Math.max(height, 200);

  nodes.forEach((node) => {
    const p = node.layout2d;
    if (!p) return;
    const r = node.radius * p.scale;
    p.x += (p.vx ?? 0) * dt;
    p.y += (p.vy ?? 0) * dt;

    const maxX = w - margin - r;
    const minX = margin + r;
    const maxY = h - margin - r;
    const minY = margin + r;

    if (p.x < minX) {
      p.x = minX;
      p.vx = Math.abs(p.vx ?? 0) * 0.85;
    } else if (p.x > maxX) {
      p.x = maxX;
      p.vx = -Math.abs(p.vx ?? 0) * 0.85;
    }
    if (p.y < minY) {
      p.y = minY;
      p.vy = Math.abs(p.vy ?? 0) * 0.85;
    } else if (p.y > maxY) {
      p.y = maxY;
      p.vy = -Math.abs(p.vy ?? 0) * 0.85;
    }
  });

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (!a.layout2d || !b.layout2d) continue;
      const ax = a.layout2d.x;
      const ay = a.layout2d.y;
      const bx = b.layout2d.x;
      const by = b.layout2d.y;
      const ar = a.radius * a.layout2d.scale;
      const br = b.radius * b.layout2d.scale;
      const dx = bx - ax;
      const dy = by - ay;
      const distSq = dx * dx + dy * dy;
      const minDist = ar + br + 8;
      if (distSq < minDist * minDist && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        const push = overlap * 0.5;
        a.layout2d.x -= nx * push;
        a.layout2d.y -= ny * push;
        b.layout2d.x += nx * push;
        b.layout2d.y += ny * push;

        const avx = a.layout2d.vx ?? 0;
        const avy = a.layout2d.vy ?? 0;
        const bvx = b.layout2d.vx ?? 0;
        const bvy = b.layout2d.vy ?? 0;
        const relVel = (bvx - avx) * nx + (bvy - avy) * ny;
        if (relVel < 0) {
          const impulse = -relVel * 0.45;
          a.layout2d.vx = (a.layout2d.vx ?? 0) - impulse * nx;
          a.layout2d.vy = (a.layout2d.vy ?? 0) - impulse * ny;
          b.layout2d.vx = (b.layout2d.vx ?? 0) + impulse * nx;
          b.layout2d.vy = (b.layout2d.vy ?? 0) + impulse * ny;
        }
      }
    }
  }

  nodes.forEach((node) => {
    const p = node.layout2d;
    if (!p) return;
    p.t = (p.t ?? 0) + dt;
    const seed = p.seed ?? 0;
    const wander = 14;
    p.vx = (p.vx ?? 0) * 0.992;
    p.vy = (p.vy ?? 0) * 0.992;
    p.vx += Math.cos(seed + p.t * 1.2) * wander * dt;
    p.vy += Math.sin(seed + p.t * 1.35) * wander * dt;
    p.vx += (Math.random() - 0.5) * 4 * dt;
    p.vy += (Math.random() - 0.5) * 4 * dt;
  });
}

export function hasPriceChanged(prev?: CoinMarket, next?: CoinMarket): boolean {
  if (!prev || !next) return true;
  const fields: (keyof CoinMarket)[] = [
    "current_price",
    "price_change_percentage_1h_in_currency",
    "price_change_percentage_24h",
    "price_change_percentage_7d_in_currency"
  ];
  return fields.some((field) => {
    const a = Number(prev[field] ?? 0);
    const b = Number(next[field] ?? 0);
    return Math.abs(a - b) > 0.0001;
  });
}
