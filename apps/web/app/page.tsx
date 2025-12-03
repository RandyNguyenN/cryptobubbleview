"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
type LabelMode = "both" | "name" | "logo";
type BubbleStyle = "glass" | "basic";
type ModalState = { coin: CoinMarket; tf: Timeframe } | null;
const API_BASE = "https://api.coingecko.com/api/v3/coins/markets";

const ranges = Array.from({ length: 10 }, (_, i) => {
  const start = i * 100 + 1;
  const end = start + 99;
  return { label: `${start}-${end}`, page: i + 1, perPage: 100 };
});

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [coins, setCoins] = useState<CoinMarket[]>([]);
  const [nodes, setNodes] = useState<BubbleNode[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>("24h");
  const [sizeMode, setSizeMode] = useState<SizeMode>("cap");
  const [range, setRange] = useState(ranges[0]);
  const [viewMode, setViewMode] = useState<BubbleViewMode>("2d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [labelMode, setLabelMode] = useState<LabelMode>("both");
  const [bubbleStyle, setBubbleStyle] = useState<BubbleStyle>("glass");
  const [backgroundColor, setBackgroundColor] = useState<string>("#0b0f1a");
  const [modal, setModal] = useState<ModalState>(null);
  const spawnRef = useRef<Map<string, number>>(new Map());
  const dragRef = useRef<{ id: string; pointerId: number; dx: number; dy: number; startX: number; startY: number } | null>(null);
  const dragMovedRef = useRef(false);

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
          if (!favoriteIds.size) {
            setCoins([]);
            setLoading(false);
            return;
          }
          const params = new URLSearchParams({
            vs_currency: "usd",
            ids: [...favoriteIds].join(","),
            order: "market_cap_desc",
            per_page: String(Math.max(1, Math.min(250, favoriteIds.size))),
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
        const now = new Date();
        setLastUpdated(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      } catch (err) {
        console.error(err);
        setError("Failed to load market data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [range, reloadKey, showFavoritesOnly, favoriteIds]);

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
  }, [coins, timeframe, sizeMode, viewport, showFavoritesOnly, favoriteIds]);

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
      return next;
    });
  };

  // Animate 2D physics and 3D rotation similar to extension
  useEffect(() => {
    if (!nodesRef.current.length || !viewport.width || !viewport.height) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    lastFrameRef.current = performance.now();

    const loop = (timestamp: number) => {
      const dt = (timestamp - lastFrameRef.current) / 1000;
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

  return (
    <div className="page">
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
          <div className="pill-control split">
            <button
              className={sizeMode === "cap" ? "active" : ""}
              onClick={() => setSizeMode("cap")}
              title="Size by market cap (log-scaled)"
            >
              Cap
            </button>
            <button
              className={sizeMode === "percent" ? "active" : ""}
              onClick={() => setSizeMode("percent")}
              title="Size by percent change"
            >
              % Change
            </button>
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
          <button className="icon-pill" title="Settings" onClick={() => setSettingsOpen(true)}>
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

      <main className="viewport">
        <div
          className="bubble-container"
          ref={containerRef}
          style={{ background: backgroundColor || undefined }}
        >
          {loading && <div className="status">Loading market data…</div>}
          {error && <div className="status error">{error}</div>}
        {!loading &&
          !error &&
          nodes.map((node, idx) => {
            const tfChange = selectChangeByTimeframe(node.coin, timeframe);
            const gradient = calcBubbleColor(tfChange, timeframe);
            const scale = node.layout2d?.scale ?? 1;
            const x = node.layout2d?.x ?? (viewport.width || 0) / 2;
            const y = node.layout2d?.y ?? (viewport.height || 0) / 2;
            const changeText = formatPercent(tfChange);
            const symbolLen = Math.max(node.coin.symbol?.length || 0, 3);
            const changeLen = Math.max(changeText.length, 4);
            const radius = node.radius;
            const isTiny = radius < 26;
            const responsiveScale =
              viewport.width < 640 ? 0.9 : viewport.width < 768 ? 0.95 : 1;
            const fontBoost = viewport.width < 640 ? 1.18 : viewport.width < 768 ? 1.1 : 1.05;
            const displayRadius = radius * responsiveScale;
            const isTinyDisplay = displayRadius < 28;
            const padding = clamp(displayRadius * 0.04, 1.2, 4);
            const symbolSize = clamp(
              displayRadius * 0.26 * (3 / symbolLen) * fontBoost,
              isTinyDisplay ? 10 : 12,
              38
            );
            const changeSize = clamp(
              displayRadius * 0.18 * (5 / changeLen) * fontBoost,
              isTinyDisplay ? 9 : 11,
              22
            );
            const logoSize = clamp(displayRadius * (isTinyDisplay ? 0.4 : 0.5), 12, 44);
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
                    background:
                      bubbleStyle === "basic"
                        ? "rgba(0,0,0,0.7)"
                        : `
                    radial-gradient(circle at 35% 30%, rgba(255,255,255,0.14), rgba(255,255,255,0) 38%),
                    radial-gradient(circle at 50% 50%, ${gradient} 0%, rgba(0,0,0,0.8) 65%, rgba(0,0,0,0.95) 100%)
                  `,
                    boxShadow:
                      bubbleStyle === "basic"
                        ? "0 10px 22px rgba(0,0,0,0.5)"
                        : "0 12px 36px rgba(0,0,0,0.55)",
                    padding,
                    gap: isTinyDisplay ? 1 : 3,
                    ["--edge-color" as any]: gradient,
                    ["--edge-width" as any]: Math.abs(tfChange) >= 1.5 ? "2px" : "1.5px"
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
                  {labelMode !== "logo" && (
                    <div
                      className="bubble-symbol"
                      style={{ fontSize: symbolSize, lineHeight: "1", letterSpacing: "0.02em" }}
                    >
                      {node.coin.symbol.toUpperCase()}
                    </div>
                  )}
                  <div className="bubble-change" style={{
                    color: tfChange >= 0 ? "#a5ffb5" : "#ffb3b3",
                    fontSize: changeSize,
                    lineHeight: "1",
                    marginTop: isTiny ? 1 : 1.5
                  }}>
                    {changeText}
                  </div>
                </div>
            );
          })}
        </div>
      </main>

      {rangePopupOpen && (
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

      {settingsOpen && (
        <>
          <div className="popup-backdrop" onClick={() => setSettingsOpen(false)} />
          <div className="popup">
            <div className="popup-header">
              <div className="popup-title">Settings</div>
              <button className="popup-close" onClick={() => setSettingsOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="popup-body settings">
              <div className="settings-card">
                <div className="settings-row">
                  <span className="label">Status</span>
                  <span className="value">Last update: {lastUpdated || "—"}</span>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-row">
                  <span className="label">Background</span>
                  <input
                    type="color"
                    value={backgroundColor}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                    className="color-input"
                  />
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-row">
                  <span className="label">View</span>
                  <div className="slider-group">
                    <button
                      className={`slider-btn ${viewMode === "2d" ? "active" : ""}`}
                      onClick={() => setViewMode("2d")}
                    >
                      2D
                    </button>
                    <button
                      className={`slider-btn ${viewMode === "3d" ? "active" : ""}`}
                      onClick={() => setViewMode("3d")}
                    >
                      3D
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-row">
                  <span className="label">Refresh</span>
                  <button className="pill-control ghost-btn" onClick={() => setReloadKey((k) => k + 1)}>
                    Refresh
                  </button>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-row">
                  <span className="label">Bubble Label</span>
                  <div className="slider-group">
                    <button
                      className={`slider-btn ${labelMode === "both" ? "active" : ""}`}
                      onClick={() => setLabelMode("both")}
                    >
                      Name + Logo
                    </button>
                    <button
                      className={`slider-btn ${labelMode === "name" ? "active" : ""}`}
                      onClick={() => setLabelMode("name")}
                    >
                      Name
                    </button>
                    <button
                      className={`slider-btn ${labelMode === "logo" ? "active" : ""}`}
                      onClick={() => setLabelMode("logo")}
                    >
                      Logo
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-row">
                  <span className="label">Bubble Style</span>
                  <div className="slider-group">
                    <button
                      className={`slider-btn ${bubbleStyle === "glass" ? "active" : ""}`}
                      onClick={() => setBubbleStyle("glass")}
                    >
                      Glass
                    </button>
                    <button
                      className={`slider-btn ${bubbleStyle === "basic" ? "active" : ""}`}
                      onClick={() => setBubbleStyle("basic")}
                    >
                      Basic
                    </button>
                  </div>
                </div>
              </div>
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

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Market snapshot</h2>
            <p className="muted">
              Shared data and layout math from <code>@cryptobubble/core</code> powering both the extension
              and this page.
            </p>
          </div>
          <div className="chip">Last update {lastUpdated || "—"}</div>
        </div>
        <div className="grid">
          {coins.slice(0, 9).map((c) => (
            <div key={c.id} className="card">
              <div className="card-top">
                {c.image && <img src={c.image} alt={c.symbol} />}
                <div>
                  <div className="symbol">{c.symbol.toUpperCase()}</div>
                  <div className="name">{c.name}</div>
                </div>
              </div>
              <div className="row">
                <span>Price</span>
                <strong>${formatPrice(c.current_price)}</strong>
              </div>
              <div className="row">
                <span>24h</span>
                <strong className={(c.price_change_percentage_24h ?? 0) >= 0 ? "pos" : "neg"}>
                  {formatPercent(c.price_change_percentage_24h)}
                </strong>
              </div>
              <div className="row">
                <span>7d</span>
                <strong className={(c.price_change_percentage_7d_in_currency ?? 0) >= 0 ? "pos" : "neg"}>
                  {formatPercent(c.price_change_percentage_7d_in_currency)}
                </strong>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
