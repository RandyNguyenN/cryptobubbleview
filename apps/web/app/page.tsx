"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  buildApiUrl,
  buildBubbleNodes,
  calcBubbleColor,
  clamp,
  formatPercent,
  formatPrice,
  selectChangeByTimeframe,
  update2DPhysics
} from "@cryptobubble/core";
import type { BubbleNode, CoinMarket, SizeMode, Timeframe } from "@cryptobubble/core";

type BubbleViewMode = "2d" | "3d";
type HoverState = { coin: CoinMarket; x: number; y: number } | null;
type LabelMode = "both" | "name" | "logo" | "volume" | "cap" | "rank" | "price";
type BubbleStyle = "glass" | "basic" | "halo";
type HaloStrength = number;
type ModalState = { coin: CoinMarket; tf: Timeframe } | null;
const API_BASE = "https://api.coingecko.com/api/v3/coins/markets";
type SortField = "rank" | "price" | "cap" | "volume" | "ch1h" | "ch24h" | "ch7d";
type SortDir = "asc" | "desc";

const ranges = Array.from({ length: 10 }, (_, i) => {
  const start = i * 100 + 1;
  const end = start + 99;
  return { label: `${start}-${end}`, page: i + 1, perPage: 100 };
});

const sizeOptions: { key: SizeMode; title: string; desc: string }[] = [
  { key: "cap", title: "Market Cap", desc: "Emphasize established projects with larger caps." },
  { key: "percent", title: "% Change", desc: "Let recent momentum drive bubble size." },
  { key: "volume", title: "24h Volume", desc: "Scale with trading activity and liquidity." }
];

const labelOptions: { key: LabelMode; title: string; desc: string }[] = [
  { key: "both", title: "Name + Logo", desc: "Balanced identity and recognition." },
  { key: "name", title: "Name", desc: "Keep the canvas text-first." },
  { key: "logo", title: "Logo", desc: "Minimal look using symbols only." },
  { key: "volume", title: "24h Volume", desc: "Surface market activity directly." },
  { key: "cap", title: "Market Cap", desc: "Show size by capitalization." },
  { key: "rank", title: "Rank", desc: "Highlight market position quickly." },
  { key: "price", title: "Price", desc: "Show live pricing inside each bubble." }
];

const bubbleStyleOptions: { key: BubbleStyle; title: string; desc: string }[] = [
  { key: "glass", title: "Glass", desc: "Frosted, modern look with depth." },
  { key: "basic", title: "Basic", desc: "Clean, lightweight outlines." },
  { key: "halo", title: "Halo", desc: "Bold glow with color-coded rim." }
];

const parseTimeframeParam = (val: string | null): Timeframe => {
  if (val === "1h" || val === "24h" || val === "7d" || val === "30d" || val === "365d") return val;
  return "24h";
};

const parseSizeModeParam = (val: string | null): SizeMode => {
  if (val === "cap" || val === "percent" || val === "volume") return val;
  return "cap";
};

const parseLabelModeParam = (val: string | null): LabelMode => {
  if (val === "both" || val === "name" || val === "logo" || val === "volume" || val === "cap" || val === "rank" || val === "price") {
    return val;
  }
  return "both";
};

const parseBubbleStyleParam = (val: string | null): BubbleStyle => {
  if (val === "glass" || val === "basic" || val === "halo") return val;
  return "glass";
};

const parseRangeParam = (val: string | null) => {
  const num = Number(val);
  if (Number.isInteger(num)) {
    const match = ranges.find((r) => r.page === num);
    if (match) return match;
  }
  return ranges[0];
};

const parseHaloParam = (val: string | null): HaloStrength => {
  const num = Number.parseFloat(val ?? "");
  if (Number.isFinite(num)) return clamp(num, 0.4, 1.4);
  return 0.85;
};

async function fetchWithRetry(url: string, attempts = 3, delayMs = 1200): Promise<Response> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt < attempts) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastError = new Error(`API error ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    attempt += 1;
    if (attempt < attempts) {
      const jitter = Math.random() * 400;
      await new Promise((r) => setTimeout(r, delayMs + jitter));
    }
  }
  throw lastError ?? new Error("API request failed");
}

export default function Home() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isEmbed = pathname?.startsWith("/embed");
  const initialTimeframe = useMemo(() => parseTimeframeParam(searchParams.get("timeframe")), [searchParams]);
  const initialSizeMode = useMemo(() => parseSizeModeParam(searchParams.get("size")), [searchParams]);
  const initialLabelMode = useMemo(() => parseLabelModeParam(searchParams.get("label")), [searchParams]);
  const initialBubbleStyle = useMemo(() => parseBubbleStyleParam(searchParams.get("style")), [searchParams]);
  const initialRange = useMemo(() => parseRangeParam(searchParams.get("range")), [searchParams]);
  const initialHalo = useMemo(() => parseHaloParam(searchParams.get("halo")), [searchParams]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [coins, setCoins] = useState<CoinMarket[]>([]);
  const [nodes, setNodes] = useState<BubbleNode[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  const [sizeMode, setSizeMode] = useState<SizeMode>(initialSizeMode);
  const [range, setRange] = useState(initialRange);
  const [viewMode] = useState<BubbleViewMode>("2d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [reloadKey, setReloadKey] = useState(0);
  const nodesRef = useRef<BubbleNode[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const angleRef = useRef({ x: 0.25, y: 0 });
  const [hover, setHover] = useState<HoverState>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [rangePopupOpen, setRangePopupOpen] = useState(false);
  const [bubbleOptionsOpen, setBubbleOptionsOpen] = useState(false);
  const [labelMode, setLabelMode] = useState<LabelMode>(initialLabelMode);
  const [bubbleStyle, setBubbleStyle] = useState<BubbleStyle>(initialBubbleStyle);
  const [haloStrength, setHaloStrength] = useState<HaloStrength>(initialHalo);
  const [modal, setModal] = useState<ModalState>(null);
  const [bubbleTab, setBubbleTab] = useState<"controls" | "embed">(isEmbed ? "embed" : "controls");
  const [embedCopied, setEmbedCopied] = useState(false);
  const spawnRef = useRef<Map<string, number>>(new Map());
  const dragRef = useRef<{ id: string; pointerId: number; dx: number; dy: number; startX: number; startY: number } | null>(null);
  const dragMovedRef = useRef(false);
  const favoriteIdsRef = useRef<Set<string>>(new Set());
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: "rank", dir: "asc" });

  useEffect(() => {
    if (!isEmbed) return;
    setTimeframe(initialTimeframe);
    setSizeMode(initialSizeMode);
    setLabelMode(initialLabelMode);
    setBubbleStyle(initialBubbleStyle);
    setRange(initialRange);
    setHaloStrength(initialHalo);
  }, [isEmbed, initialTimeframe, initialSizeMode, initialLabelMode, initialBubbleStyle, initialRange, initialHalo]);

  useEffect(() => {
    const updateSize = () => {
      const el = containerRef.current;
      setViewport({
        width: el?.clientWidth || window.innerWidth || 1200,
        height: el?.clientHeight || window.innerHeight || 800
      });
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (showFavoritesOnly) {
          const favArray = [...favoriteIdsRef.current];
          if (!favArray.length) {
            setCoins([]);
            setLoading(false);
            return;
          }
          const params = new URLSearchParams({
            vs_currency: "usd",
            ids: favArray.join(","),
            order: "market_cap_desc",
            per_page: String(Math.max(1, Math.min(250, favArray.length))),
            page: "1",
            price_change_percentage: "1h,24h,7d,30d,365d"
          });
          const res = await fetchWithRetry(`${API_BASE}?${params.toString()}`);
          const json = (await res.json()) as CoinMarket[];
          setCoins(json);
        } else {
          const url = buildApiUrl({
            perPage: range.perPage,
            page: range.page,
            vsCurrency: "usd",
            priceChangePercentages: ["1h", "24h", "7d", "30d", "365d"]
          });
          const res = await fetchWithRetry(url);
          const json = (await res.json()) as CoinMarket[];
          setCoins(json);
        }
      } catch (err) {
        console.error(err);
        setError("Failed to load market data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [range, reloadKey, showFavoritesOnly]);

  useEffect(() => {
    favoriteIdsRef.current = favoriteIds;
  }, [favoriteIds]);

  useEffect(() => {
    if (!viewport.width || !viewport.height) return;
    const filtered = showFavoritesOnly ? coins.filter((c) => favoriteIds.has(c.id)) : coins;
    if (!filtered.length) {
      nodesRef.current = [];
      setNodes([]);
      return;
    }
    const computed = buildBubbleNodes(filtered, {
      timeframe,
      sizeMode,
      width: viewport.width,
      height: viewport.height
    });
    nodesRef.current = computed;
    setNodes(computed);
  }, [coins, timeframe, sizeMode, viewport, showFavoritesOnly]);

  // Load favorites from storage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("cryptoBubblesFavorites");
      if (raw) setFavoriteIds(new Set(JSON.parse(raw)));
    } catch {
      setFavoriteIds(new Set());
    }
  }, []);

  const toggleFavorite = (coin: CoinMarket) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      const removing = next.has(coin.id);
      if (removing) next.delete(coin.id);
      else next.add(coin.id);
      try {
        localStorage.setItem("cryptoBubblesFavorites", JSON.stringify([...next]));
      } catch {
        // ignore
      }
      if (showFavoritesOnly && removing) {
        nodesRef.current = nodesRef.current.filter((n) => next.has(n.coin.id));
        setNodes([...nodesRef.current]);
        setCoins((prevCoins) => prevCoins.filter((c) => next.has(c.id)));
      }
      return next;
    });
  };

  // Animate 2D physics and 3D rotation similar to extension
  useEffect(() => {
    if (!nodesRef.current.length || !viewport.width || !viewport.height) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    lastFrameRef.current = performance.now();

    const loop = (timestamp: number) => {
      const rawDt = (timestamp - lastFrameRef.current) / 1000;
      const dt = Math.min(rawDt, 0.05); // clamp to avoid burst after tab switches
      lastFrameRef.current = timestamp;

      if (viewMode === "2d") {
        update2DPhysics(nodesRef.current, viewport.width, viewport.height, dt);
      } else {
        angleRef.current.y += 0.12 * dt;
        angleRef.current.x += 0.02 * dt;
      }

      setNodes([...nodesRef.current]);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [viewMode, viewport, nodes.length]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        lastFrameRef.current = performance.now();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current || viewMode !== "2d") return;
      const drag = dragRef.current;
      if (e.pointerId !== drag.pointerId) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left - drag.dx;
      const y = e.clientY - rect.top - drag.dy;
      const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      if (dist > 4) dragMovedRef.current = true;
      const updated = nodesRef.current.map((n) => {
        if (n.coin.id !== drag.id || !n.layout2d) return n;
        return {
          ...n,
          layout2d: { ...n.layout2d, x, y, vx: 0, vy: 0 }
        };
      });
      nodesRef.current = updated;
      setNodes([...updated]);
    };
    const onUp = (e: PointerEvent) => {
      if (!dragRef.current) return;
      if (e.pointerId !== dragRef.current.pointerId) return;
      dragRef.current = null;
      setTimeout(() => {
        dragMovedRef.current = false;
      }, 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [viewMode]);

  const heroTitle = useMemo(
    () => (viewMode === "3d" ? "3D Bubble Galaxy" : "2D Floating Bubbles"),
    [viewMode]
  );

  const sortedCoins = useMemo(() => {
    const getVal = (c: CoinMarket, field: SortField) => {
      switch (field) {
        case "rank":
          return c.market_cap_rank ?? Number.POSITIVE_INFINITY;
        case "price":
          return c.current_price ?? 0;
        case "cap":
          return c.market_cap ?? 0;
        case "volume":
          return c.total_volume ?? 0;
        case "ch1h":
          return c.price_change_percentage_1h_in_currency ?? 0;
        case "ch24h":
          return c.price_change_percentage_24h ?? 0;
        case "ch7d":
          return c.price_change_percentage_7d_in_currency ?? 0;
        default:
          return 0;
      }
    };
    const arr = [...coins];
    arr.sort((a, b) => {
      const va = getVal(a, sort.field);
      const vb = getVal(b, sort.field);
      const diff = va === vb ? (a.market_cap_rank ?? 99999) - (b.market_cap_rank ?? 99999) : va - vb;
      return sort.dir === "asc" ? diff : -diff;
    });
    return arr;
  }, [coins, sort]);

  const handleSort = (field: SortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { field, dir: field === "rank" ? "asc" : "desc" };
    });
  };

  const formatVolume = (val?: number) =>
    new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(val ?? 0);

  const formatCap = (val?: number) =>
    new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(val ?? 0);

  const formatPriceCompact = (val?: number) =>
    new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(val ?? 0);

  const backgroundColor = "#0b0f1a";

  const sortSymbol = (field: SortField) => {
    if (sort.field === field) return sort.dir === "asc" ? "▲" : "▼";
    return "⇅";
  };

  const renderTooltip = () => {
    if (!hover || !containerRef.current) return null;
    const tf = timeframe;
    const change = selectChangeByTimeframe(hover.coin, tf);
    const style: React.CSSProperties = {
      left: hover.x + 12,
      top: hover.y + 12
    };
    return (
      <div className="tooltip" style={style}>
        <div className="tooltip-title">
          {hover.coin.name} ({hover.coin.symbol.toUpperCase()})
        </div>
        <div className="tooltip-row">
          <span>Price</span>
          <span>${formatPrice(hover.coin.current_price)}</span>
        </div>
        <div className="tooltip-row">
          <span>Market Cap</span>
          <span>${hover.coin.market_cap?.toLocaleString() || "-"}</span>
        </div>
        <div className="tooltip-row">
          <span>1h</span>
          <span>{formatPercent(hover.coin.price_change_percentage_1h_in_currency)}</span>
        </div>
        <div className="tooltip-row">
          <span>24h</span>
          <span>{formatPercent(hover.coin.price_change_percentage_24h)}</span>
        </div>
        <div className="tooltip-row">
          <span>7d</span>
          <span>{formatPercent(hover.coin.price_change_percentage_7d_in_currency)}</span>
        </div>
      </div>
    );
  };

  const sizeLabel = sizeOptions.find((o) => o.key === sizeMode)?.title ?? "Size";
  const labelLabel = labelOptions.find((o) => o.key === labelMode)?.title ?? "Content";
  const styleLabel = bubbleStyleOptions.find((o) => o.key === bubbleStyle)?.title ?? "Style";
  const embedUrl = useMemo(() => {
    const params = new URLSearchParams({
      timeframe,
      size: sizeMode,
      label: labelMode,
      style: bubbleStyle,
      range: String(range.page),
      halo: haloStrength.toFixed(1)
    });
    return `https://www.cryptobubbleview.com/embed?${params.toString()}`;
  }, [timeframe, sizeMode, labelMode, bubbleStyle, range.page, haloStrength]);
  const embedCode = `<iframe src="${embedUrl}" width="100%" height="640" style="border:0; background:#0b0f1a;" loading="lazy"></iframe>`;

  const copyEmbed = async () => {
    try {
      await navigator.clipboard?.writeText(embedCode);
      setEmbedCopied(true);
      setTimeout(() => setEmbedCopied(false), 1500);
    } catch {
      setEmbedCopied(false);
    }
  };

  return (
    <div className={`page ${isEmbed ? "embed-page" : ""}`}>
      {!isEmbed && (
        <header className="top-bar">
          <div className="top-actions">
            <div className="pill-control">
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)}>
                <option value="24h">Day</option>
                <option value="1h">Hour</option>
                <option value="7d">Week</option>
                <option value="30d">Month</option>
                <option value="365d">Year</option>
              </select>
            </div>
            <button className="pill-control ghost-btn" onClick={() => setRangePopupOpen(true)}>
              <span className="range-label">{range.label}</span>
            </button>
            <button
              className={`icon-pill ${showFavoritesOnly ? "active" : ""}`}
              title="Toggle favorites"
              onClick={() => setShowFavoritesOnly((v) => !v)}
            >
              ★
            </button>
            <button
              className="icon-pill icon-pill--settings"
              title="Bubble settings"
              aria-label="Bubble settings"
              onClick={() => setBubbleOptionsOpen(true)}
            >
              ⚙
            </button>
            <button className="icon-pill" title="Toggle fullscreen" onClick={() => {
              if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
              else document.exitFullscreen?.();
            }}>
              ⛶
            </button>
          </div>
        </header>
      )}

      <main className="viewport">
        <div
          className="bubble-container"
          ref={containerRef}
          style={{ background: backgroundColor || undefined }}
        >
          {loading && <div className="status">Loading market data…</div>}
          {error && <div className="status error">{error}</div>}
          {showFavoritesOnly && !loading && !error && nodes.length === 0 && (
            <div className="status">No favorites yet. Add coins to favorites to see them here.</div>
          )}
        {!loading &&
          !error &&
          nodes.map((node, idx) => {
            const tfChange = selectChangeByTimeframe(node.coin, timeframe);
            const gradient = calcBubbleColor(tfChange, timeframe);
            const scale = node.layout2d?.scale ?? 1;
            const x = node.layout2d?.x ?? (viewport.width || 0) / 2;
            const y = node.layout2d?.y ?? (viewport.height || 0) / 2;
            const changeText = formatPercent(tfChange);
            const volumeText = `$${formatVolume(node.coin.total_volume)}`;
            const capText = `$${formatCap(node.coin.market_cap)}`;
            const rankText = `#${node.coin.market_cap_rank ?? "-"}`;
            const priceText = `$${formatPriceCompact(node.coin.current_price)}`;
            const secondaryText =
              labelMode === "volume"
                ? volumeText
                : labelMode === "cap"
                  ? capText
                  : labelMode === "rank"
                    ? rankText
                    : labelMode === "price"
                      ? priceText
                      : changeText;
            const symbolLen = Math.max(node.coin.symbol?.length || 0, 3);
            const changeLen = Math.max(secondaryText.length, 4);
            const radius = node.radius;
            const isTiny = radius < 26;
            const isMini = radius < 16;
            const isMicro = radius < 10;
            const responsiveScale =
              viewport.width < 640 ? 0.9 : viewport.width < 768 ? 0.95 : 1;
            const isHalo = bubbleStyle === "halo";
            const haloIntensity = clamp(haloStrength, 0.4, 1.4);
            const ringStart = clamp(60 - (haloIntensity - 1) * 10, 52, 64);
            const ringPeak = clamp(74 + (haloIntensity - 1) * 8, 68, 82);
            const outerAlpha = clamp(0.88 * Math.pow(haloIntensity, 0.6), 0.52, 0.95);
            const innerShadowAlpha = clamp(0.74 + (haloIntensity - 1) * 0.18, 0.6, 0.92);
            const bubbleBackground =
              bubbleStyle === "basic"
                ? "rgba(0,0,0,0.7)"
                : bubbleStyle === "halo"
                  ? `
              radial-gradient(circle at 50% 50%, rgba(0,0,0,0) ${ringStart}%, ${gradient} ${ringPeak}%, rgba(0,0,0,${outerAlpha.toFixed(2)}) 100%),
              radial-gradient(circle at 35% 30%, rgba(255,255,255,0.16), rgba(255,255,255,0) 42%),
              radial-gradient(circle at 50% 50%, rgba(0,0,0,0.42) 0%, rgba(0,0,0,${innerShadowAlpha.toFixed(2)}) 58%, rgba(0,0,0,0.9) 100%)
            `
                  : `
                    radial-gradient(circle at 35% 30%, rgba(255,255,255,0.14), rgba(255,255,255,0) 38%),
                    radial-gradient(circle at 50% 50%, ${gradient} 0%, rgba(0,0,0,0.8) 65%, rgba(0,0,0,0.95) 100%)
                  `;
            const bubbleShadow =
              bubbleStyle === "basic"
                ? "0 10px 22px rgba(0,0,0,0.5)"
                : bubbleStyle === "halo"
                  ? `0 0 0 1.6px rgba(0,0,0,0.28), 0 0 ${12 + haloIntensity * 6}px ${4 + haloIntensity * 3}px ${gradient}, 0 11px 20px rgba(0,0,0,0.42)`
                  : "0 12px 36px rgba(0,0,0,0.55)";
            const edgeWidth = isHalo ? `${1.5 + haloIntensity * 0.6}px` : Math.abs(tfChange) >= 1.5 ? "2px" : "1.5px";
            const fontBoost = viewport.width < 640 ? 1.18 : viewport.width < 768 ? 1.1 : 1.05;
            const displayRadius = radius * responsiveScale;
            const isTinyDisplay = displayRadius < 28;
            const padding = clamp(displayRadius * 0.04, 1.2, 4);
            const symbolSize = clamp(
              displayRadius * 0.26 * (3 / symbolLen) * fontBoost,
              isMicro ? 5 : isTinyDisplay ? 8 : 12,
              38
            );
            const changeSize = clamp(
              displayRadius * 0.18 * (5 / changeLen) * fontBoost,
              isMicro ? 5 : isTinyDisplay ? 7 : 11,
              22
            );
            const logoSize = clamp(displayRadius * (isTinyDisplay ? 0.4 : 0.5), isMicro ? 6 : 10, 44);
            const now = performance.now();
            let spawn = spawnRef.current.get(node.coin.id);
            if (!spawn) {
              spawn = now + Math.random() * 400;
              spawnRef.current.set(node.coin.id, spawn);
            }
            const grow = Math.min(1, Math.max(0, (now - spawn) / 700));
            const growEase = 0.2 + 0.8 * Math.pow(grow, 0.85);

            let depthStyles: React.CSSProperties = {};
            if (viewMode === "3d") {
              const perspective = Math.min(viewport.width, viewport.height) * 0.8;
              const { x: angX, y: angY } = angleRef.current;
                const cosY = Math.cos(angY);
                const sinY = Math.sin(angY);
                const cosX = Math.cos(angX);
                const sinX = Math.sin(angX);

                const xz = node.x * cosY - node.z * sinY;
                const zz = node.x * sinY + node.z * cosY;
                const yz = node.y * cosX - zz * sinX;
                const zz2 = node.y * sinX + zz * cosX;

                const depth = (zz2 + 2) / 4;
                const scale3d = (0.3 + depth * 0.9) * growEase * responsiveScale;
                depthStyles = {
                  transform: `translate3d(${viewport.width / 2 + xz * perspective * 0.5}px, ${
                    viewport.height / 2 + yz * perspective * 0.5
                  }px, 0) scale(${scale3d})`,
                  opacity: 0.35 + depth * 0.65,
                  zIndex: Math.floor(depth * 1000)
                };
              }

            return (
              <div
                key={node.coin.id}
                className="bubble"
                style={{
                    width: displayRadius * 2,
                    height: displayRadius * 2,
                    marginLeft: -displayRadius,
                    marginTop: -displayRadius,
                    transform:
                      viewMode === "2d"
                        ? `translate(${x}px, ${y}px) scale(${scale * growEase * responsiveScale})`
                        : depthStyles.transform,
                    opacity: viewMode === "2d" ? 0.9 : depthStyles.opacity,
                    zIndex:
                      viewMode === "2d" ? 400 + Math.floor(node.sizeFactor * 400) : depthStyles.zIndex,
                    background: bubbleBackground,
                    boxShadow: bubbleShadow,
                    padding,
                    gap: isMini ? 0 : isTinyDisplay ? 1 : 3,
                    ["--edge-color" as any]: gradient,
                    ["--edge-width" as any]: edgeWidth
                  }}
                  onPointerDown={(e) => {
                    if (viewMode !== "2d") return;
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const cx = node.layout2d?.x ?? x;
                    const cy = node.layout2d?.y ?? y;
                    dragRef.current = {
                      id: node.coin.id,
                      pointerId: e.pointerId,
                      dx: e.clientX - rect.left - cx,
                      dy: e.clientY - rect.top - cy,
                      startX: e.clientX,
                      startY: e.clientY
                    };
                    dragMovedRef.current = false;
                  }}
                  onClick={() => {
                    if (dragMovedRef.current) return;
                    setModal({ coin: node.coin, tf: timeframe });
                  }}
                >
                  {node.coin.image && labelMode !== "name" && (
                    <img
                      className="bubble-logo"
                      src={node.coin.image}
                      alt={node.coin.symbol}
                      style={{ width: logoSize, height: logoSize }}
                    />
                  )}
                  {labelMode !== "logo" &&
                    !(
                      isMini &&
                      labelMode !== "price" &&
                      labelMode !== "volume" &&
                      labelMode !== "cap" &&
                      labelMode !== "rank"
                    ) &&
                    !isMicro && (
                    <div
                      className="bubble-symbol"
                      style={{ fontSize: symbolSize, lineHeight: "1", letterSpacing: "0.02em" }}
                    >
                      {node.coin.symbol.toUpperCase()}
                    </div>
                  )}
                  {!isMicro &&
                    (labelMode === "price" ||
                      labelMode === "volume" ||
                      labelMode === "cap" ||
                      labelMode === "rank" ||
                      !isMini) && (
                    <div
                      className="bubble-change"
                      style={{
                        color:
                          labelMode === "volume" || labelMode === "cap" || labelMode === "rank" || labelMode === "price"
                            ? "#f5f7fb"
                            : tfChange >= 0
                              ? "#a5ffb5"
                              : "#ffb3b3",
                        fontSize: changeSize,
                        lineHeight: "1",
                        marginTop: isTiny ? 1 : 1.5
                      }}
                    >
                      {secondaryText}
                    </div>
                  )}
                </div>
            );
          })}
        </div>
      </main>

      {!isEmbed && rangePopupOpen && (
        <>
          <div className="popup-backdrop" onClick={() => setRangePopupOpen(false)} />
          <div className="popup">
            <div className="popup-header">
              <div className="popup-title">Pages</div>
              <button className="popup-close" onClick={() => setRangePopupOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="popup-body">
              {ranges.map((r) => (
                <div
                  key={r.label}
                  className={`popup-option ${range.label === r.label ? "active" : ""}`}
                  onClick={() => {
                    setRange(r);
                    setRangePopupOpen(false);
                    setReloadKey((k) => k + 1);
                  }}
                >
                  <div className="popup-radio" />
                  <div className="popup-label">{r.label}</div>
                  <div className="popup-change">—</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {modal && (
        <>
          <div className="popup-backdrop" onClick={() => setModal(null)} />
          <div className="popup coin-modal">
            <div className="popup-header">
              <div className="popup-title">
                {modal.coin.name} ({modal.coin.symbol.toUpperCase()})
              </div>
              <button className="popup-close" onClick={() => setModal(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="popup-body coin-body">
              <div className="coin-top">
                {modal.coin.image && <img className="coin-avatar" src={modal.coin.image} alt={modal.coin.symbol} />}
                <div className="chip">Rank {modal.coin.market_cap_rank ?? "-"}</div>
                <div className={`chip ${selectChangeByTimeframe(modal.coin, modal.tf) >= 0 ? "positive" : "negative"}`}>
                  {modal.tf} {formatPercent(selectChangeByTimeframe(modal.coin, modal.tf))}
                </div>
              </div>
              <div className="coin-grid">
                <div className="coin-cell">
                  <div className="label">Price</div>
                  <div className="value">{`$${formatPrice(modal.coin.current_price)}`}</div>
                </div>
                <div className="coin-cell">
                  <div className="label">1h</div>
                  <div
                    className={`value ${(modal.coin.price_change_percentage_1h_in_currency ?? 0) >= 0 ? "positive" : "negative"}`}
                  >
                    {formatPercent(modal.coin.price_change_percentage_1h_in_currency)}
                  </div>
                </div>
                <div className="coin-cell">
                  <div className="label">24h</div>
                  <div
                    className={`value ${(modal.coin.price_change_percentage_24h ?? 0) >= 0 ? "positive" : "negative"}`}
                  >
                    {formatPercent(modal.coin.price_change_percentage_24h)}
                  </div>
                </div>
                <div className="coin-cell">
                  <div className="label">7d</div>
                  <div
                    className={`value ${(modal.coin.price_change_percentage_7d_in_currency ?? 0) >= 0 ? "positive" : "negative"}`}
                  >
                    {formatPercent(modal.coin.price_change_percentage_7d_in_currency)}
                  </div>
                </div>
                <div className="coin-cell">
                  <div className="label">Market Cap</div>
                  <div className="value">{`$${modal.coin.market_cap?.toLocaleString() || "-"}`}</div>
                </div>
                <div className="coin-cell">
                  <div className="label">Volume 24h</div>
                  <div className="value">{`$${modal.coin.total_volume?.toLocaleString() || "-"}`}</div>
                </div>
                <div className="coin-cell">
                  <div className="label">Circulating</div>
                  <div className="value">{modal.coin.circulating_supply?.toLocaleString() || "-"}</div>
                </div>
                <div className="coin-cell">
                  <div className="label">Total Supply</div>
                  <div className="value">{modal.coin.total_supply?.toLocaleString() || "-"}</div>
                </div>
              </div>
              <div className="coin-actions">
                <button className="pill-action" onClick={() => toggleFavorite(modal.coin)}>
                  {favoriteIds.has(modal.coin.id) ? "Remove favorite" : "Add to favorite"}
                </button>
                <a
                  className="pill-action primary"
                  href={`https://www.coingecko.com/en/coins/${modal.coin.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on CoinGecko
                </a>
              </div>
            </div>
          </div>
        </>
      )}

      {!isEmbed && bubbleOptionsOpen && (
        <>
          <div className="popup-backdrop" onClick={() => setBubbleOptionsOpen(false)} />
          <div className="popup">
          <div className="popup-header">
            <div className="popup-title">Bubble options</div>
            <button className="popup-close" onClick={() => setBubbleOptionsOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="popup-body bubble-options">
            <div className="bubble-tabs">
              <button
                className={`bubble-tab ${bubbleTab === "controls" ? "active" : ""}`}
                onClick={() => setBubbleTab("controls")}
              >
                Display
              </button>
              <button
                className={`bubble-tab ${bubbleTab === "embed" ? "active" : ""}`}
                onClick={() => setBubbleTab("embed")}
              >
                HTML widget
              </button>
            </div>

            {bubbleTab === "controls" && (
              <>
                <div className="bubble-options-head">
                  <div>
                    <div className="eyebrow">Display tuning</div>
                    <div className="bubble-options-heading">Customize your bubbles</div>
                    <p className="bubble-options-sub">Choose how bubbles size, what they show, and the finish you prefer.</p>
                  </div>
                  <div className="bubble-options-summary">
                    <span className="summary-pill">Size · {sizeLabel}</span>
                    <span className="summary-pill">Content · {labelLabel}</span>
                    <span className="summary-pill">Style · {styleLabel}</span>
                  </div>
                </div>

                <div className="bubble-options-grid">
                  <div className="settings-card bubble-card bubble-card--compact">
                    <div className="bubble-card-header">
                      <div>
                        <div className="eyebrow">Sizing logic</div>
                        <div className="bubble-card-title">Bubble size</div>
                        <p className="bubble-card-desc">How each bubble scales on the canvas.</p>
                      </div>
                    </div>
                    <div className="bubble-option-group">
                      {sizeOptions.map((opt) => (
                        <button
                          key={opt.key}
                          className={`bubble-option-btn ${sizeMode === opt.key ? "active" : ""}`}
                          onClick={() => setSizeMode(opt.key)}
                        >
                          <span className="bubble-option-title">{opt.title}</span>
                          <span className="bubble-option-sub">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="settings-card bubble-card">
                    <div className="bubble-card-header">
                      <div>
                        <div className="eyebrow">Finish</div>
                        <div className="bubble-card-title">Bubble style</div>
                        <p className="bubble-card-desc">Choose the aesthetic of the spheres.</p>
                      </div>
                    </div>
                    <div className="bubble-option-group bubble-option-group--tight">
                      {bubbleStyleOptions.map((opt) => (
                        <button
                          key={opt.key}
                          className={`bubble-option-btn ${bubbleStyle === opt.key ? "active" : ""}`}
                          onClick={() => setBubbleStyle(opt.key)}
                        >
                          <span className="bubble-option-title">{opt.title}</span>
                          <span className="bubble-option-sub">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                    <div className={`halo-slider ${bubbleStyle !== "halo" ? "disabled" : ""}`}>
                      <div className="halo-slider-row">
                        <span className="halo-slider-label">Halo strength</span>
                        <span className="halo-slider-value">{haloStrength.toFixed(1)}x</span>
                      </div>
                      <input
                        type="range"
                        min={0.4}
                        max={1.4}
                        step={0.1}
                        value={haloStrength}
                        onChange={(e) => setHaloStrength(parseFloat(e.target.value))}
                        disabled={bubbleStyle !== "halo"}
                      />
                    </div>
                  </div>

                  <div className="settings-card bubble-card bubble-card--wide">
                    <div className="bubble-card-header">
                      <div>
                        <div className="eyebrow">Labels</div>
                        <div className="bubble-card-title">Bubble content</div>
                        <p className="bubble-card-desc">Pick what appears inside each bubble.</p>
                      </div>
                    </div>
                    <div className="bubble-option-group bubble-option-group--dense">
                      {labelOptions.map((opt) => (
                        <button
                          key={opt.key}
                          className={`bubble-option-btn ${labelMode === opt.key ? "active" : ""}`}
                          onClick={() => setLabelMode(opt.key)}
                        >
                          <span className="bubble-option-title">{opt.title}</span>
                          <span className="bubble-option-sub">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {bubbleTab === "embed" && (
              <div className="settings-card bubble-card bubble-card--wide">
                <div className="bubble-card-header">
                  <div>
                    <div className="eyebrow">HTML widget</div>
                    <div className="bubble-card-title">Embed as iframe</div>
                    <p className="bubble-card-desc">
                      Copy this iframe to embed your current view on any site.
                    </p>
                  </div>
                  <div className="bubble-options-summary">
                    <span className="summary-pill">Size · {sizeLabel}</span>
                    <span className="summary-pill">Content · {labelLabel}</span>
                    <span className="summary-pill">Style · {styleLabel}</span>
                  </div>
                </div>
                <div className="embed-box">
                  <div className="embed-url">{embedUrl}</div>
                  <pre className="embed-code">
                    <code>{embedCode}</code>
                  </pre>
                  <div className="embed-actions">
                    <button className="pill-action" onClick={() => window.open(embedUrl, "_blank")}>
                      Open preview
                    </button>
                    <button className="pill-action primary" onClick={copyEmbed}>
                      {embedCopied ? "Copied!" : "Copy iframe"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          </div>
        </>
      )}

      {!isEmbed && (
        <section className="panel">
          <div className="market-table">
            <div className="market-head">
              <div className={`col rank sortable ${sort.field === "rank" ? "active" : ""}`} onClick={() => handleSort("rank")}>
                <span>#</span>
                <span className="sort-icon">{sortSymbol("rank")}</span>
              </div>
              <div className="col fav"></div>
              <div className="col coin">Coin</div>
              <div className={`col price sortable ${sort.field === "price" ? "active" : ""}`} onClick={() => handleSort("price")}>
                <span>Price</span>
                <span className="sort-icon">{sortSymbol("price")}</span>
              </div>
              <div className={`col cap sortable ${sort.field === "cap" ? "active" : ""}`} onClick={() => handleSort("cap")}>
                <span>Market Cap</span>
                <span className="sort-icon">{sortSymbol("cap")}</span>
              </div>
              <div className={`col volume sortable ${sort.field === "volume" ? "active" : ""}`} onClick={() => handleSort("volume")}>
                <span>24h Volume</span>
                <span className="sort-icon">{sortSymbol("volume")}</span>
              </div>
              <div className={`col change sortable ${sort.field === "ch1h" ? "active" : ""}`} onClick={() => handleSort("ch1h")}>
                <span>1h</span>
                <span className="sort-icon">{sortSymbol("ch1h")}</span>
              </div>
              <div className={`col change sortable ${sort.field === "ch24h" ? "active" : ""}`} onClick={() => handleSort("ch24h")}>
                <span>24h</span>
                <span className="sort-icon">{sortSymbol("ch24h")}</span>
              </div>
              <div className={`col change sortable ${sort.field === "ch7d" ? "active" : ""}`} onClick={() => handleSort("ch7d")}>
                <span>7d</span>
                <span className="sort-icon">{sortSymbol("ch7d")}</span>
              </div>
            </div>
            <div className="market-body">
              {sortedCoins.map((c) => {
                const ch1h = c.price_change_percentage_1h_in_currency ?? 0;
                const ch24h = c.price_change_percentage_24h ?? 0;
                const ch7d = c.price_change_percentage_7d_in_currency ?? 0;
                const chClass = (val: number) =>
                  val === 0 ? "change neutral fill" : val > 0 ? "change pos fill" : "change neg fill";
                const isFav = favoriteIds.has(c.id);
                return (
                  <div key={c.id} className="market-row">
                    <div className="col rank">{c.market_cap_rank ?? "-"}</div>
                    <div className="col fav">
                      <button
                        className={`star-btn ${isFav ? "on" : ""}`}
                        onClick={() => toggleFavorite(c)}
                        aria-label="Toggle favorite"
                      >
                        ★
                      </button>
                    </div>
                    <div className="col coin">
                      {c.image && <img src={c.image} alt={c.symbol} className="coin-icon" />}
                      <div className="coin-meta">
                        <div className="coin-name">
                          {c.name}
                          {c.symbol ? <span className="coin-symbol-inline">{c.symbol.toUpperCase()}</span> : null}
                        </div>
                      </div>
                    </div>
                    <div className="col price">${formatPrice(c.current_price)}</div>
                    <div className="col cap">${c.market_cap?.toLocaleString() || "-"}</div>
                    <div className="col volume">${c.total_volume?.toLocaleString() || "-"}</div>
                    <div className={`col ${chClass(ch1h)}`}>{formatPercent(ch1h)}</div>
                    <div className={`col ${chClass(ch24h)}`}>{formatPercent(ch24h)}</div>
                    <div className={`col ${chClass(ch7d)}`}>{formatPercent(ch7d)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
