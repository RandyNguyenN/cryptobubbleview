"use strict";
(() => {
  // ../../packages/core/src/api.ts
  var API_BASE = "https://api.coingecko.com/api/v3/coins/markets";
  function buildApiUrl(params = {}) {
    const {
      vsCurrency = "usd",
      perPage = 60,
      page = 1,
      priceChangePercentages = ["1h", "24h", "7d", "30d", "365d"]
    } = params;
    const search = new URLSearchParams({
      vs_currency: vsCurrency,
      order: "market_cap_desc",
      per_page: String(perPage),
      page: String(page),
      price_change_percentage: priceChangePercentages.join(",")
    });
    return `${API_BASE}?${search.toString()}`;
  }

  // ../../packages/core/src/metrics.ts
  function selectChangeByTimeframe(coin, timeframe) {
    switch (timeframe) {
      case "1h":
        return coin.price_change_percentage_1h_in_currency ?? 0;
      case "7d":
        return coin.price_change_percentage_7d_in_currency ?? 0;
      case "30d":
        return coin.price_change_percentage_30d_in_currency ?? 0;
      case "365d":
        return coin.price_change_percentage_1y_in_currency ?? 0;
      case "24h":
      default:
        return coin.price_change_percentage_24h ?? 0;
    }
  }
  function formatPrice(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    if (num >= 1e3) return num.toLocaleString(void 0, { maximumFractionDigits: 0 });
    if (num >= 1) return num.toLocaleString(void 0, { maximumFractionDigits: 2 });
    return num.toLocaleString(void 0, { maximumFractionDigits: 6 });
  }
  function formatPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
  }
  function calcBubbleColor(change, timeframe) {
    const val = timeframe === "1h" ? change ?? 0 : change ?? 0;
    const strong = Math.abs(val) >= 1.5;
    if (val >= 0) {
      return strong ? "rgba(180, 229, 13, 0.95)" : "rgba(120, 200, 65, 0.9)";
    }
    return strong ? "rgba(255, 0, 0, 0.95)" : "rgba(215, 108, 130, 0.9)";
  }

  // ../../packages/core/src/layout.ts
  var MIN_RADIUS = 18;
  var MAX_RADIUS = 54;
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function calcRadius(metric, ranges2) {
    const mode = ranges2.mode ?? "cap";
    if (mode === "percent") {
      const val = metric.change;
      const minV = ranges2.minChange ?? 0;
      const maxV = ranges2.maxChange ?? 1;
      const norm2 = (val - minV) / (maxV - minV || 1);
      return MIN_RADIUS + clamp(norm2, 0, 1) * (MAX_RADIUS - MIN_RADIUS);
    }
    const cap = metric.cap || ranges2.minCap || 1;
    const minCap = ranges2.minCap || 1;
    const maxCap = ranges2.maxCap || minCap + 1;
    const logCap = Math.log(Math.max(cap, 1));
    const logMin = Math.log(Math.max(minCap, 1));
    const logMax = Math.log(Math.max(maxCap, minCap + 1));
    const norm = (logCap - logMin) / (logMax - logMin || 1);
    return MIN_RADIUS + clamp(norm, 0, 1) * (MAX_RADIUS - MIN_RADIUS);
  }
  function computeMetrics(coins, timeframe) {
    const tf = timeframe ?? "24h";
    return coins.map((coin) => ({
      coin,
      cap: coin.market_cap ?? 0,
      change: Math.abs(selectChangeByTimeframe(coin, tf) ?? 0)
    }));
  }
  function scatterPosition(index, total, depthRange = { min: -1, max: 1 }) {
    const phi = Math.acos(2 * (index + 0.5) / total - 1);
    const theta = Math.PI * (1 + Math.sqrt(5)) * (index + 0.5);
    const r = 1;
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
  function buildBubbleNodes(coins, options = {}) {
    const { timeframe = "24h", sizeMode: sizeMode2 = "cap", depthRange = { min: -1, max: 1 } } = options;
    if (!coins.length) return [];
    const metrics = computeMetrics(coins, timeframe);
    const caps = metrics.map((m) => m.cap).filter((v) => v > 0);
    const changes = metrics.map((m) => m.change);
    const minCap = caps.length ? Math.min(...caps) : 0;
    const maxCap = caps.length ? Math.max(...caps) : 1;
    const minChange = changes.length ? Math.min(...changes) : 0;
    const maxChange = changes.length ? Math.max(...changes) : 1;
    const total = coins.length || 1;
    const nodes2 = coins.map((coin, index) => {
      const metric = metrics[index];
      const radius = calcRadius(metric, { minCap, maxCap, minChange, maxChange, mode: sizeMode2 });
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
      };
    });
    const width = Math.max(200, options.width ?? 0);
    const height = Math.max(200, options.height ?? 0);
    if (width && height) {
      compute2DLayout(nodes2, width, height);
      resolveInitialOverlaps(nodes2, width, height);
    }
    return nodes2;
  }
  function compute2DLayout(nodes2, width, height) {
    if (!nodes2.length) return;
    const w = Math.max(200, width);
    const h = Math.max(200, height);
    const sorted = [...nodes2].sort((a, b) => b.radius - a.radius);
    const count = nodes2.length || 1;
    const baseArea = sorted.reduce((acc, node) => {
      const baseScale = 0.75 + node.sizeFactor * 0.45;
      return acc + Math.PI * Math.pow(node.radius * baseScale, 2);
    }, 0);
    const coverageTarget = count > 80 ? 0.75 : count > 60 ? 0.78 : 0.82;
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
  function resolveInitialOverlaps(nodes2, width, height) {
    const margin = 12;
    const w = Math.max(width, 200);
    const h = Math.max(height, 200);
    const iterations = 14;
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < nodes2.length; i++) {
        for (let j = i + 1; j < nodes2.length; j++) {
          const a = nodes2[i];
          const b = nodes2[j];
          if (!a.layout2d || !b.layout2d) continue;
          const ar = a.radius * a.layout2d.scale;
          const br = b.radius * b.layout2d.scale;
          const dx = b.layout2d.x - a.layout2d.x;
          const dy = b.layout2d.y - a.layout2d.y;
          const distSq = dx * dx + dy * dy;
          const minDist = ar + br + 8;
          if (distSq < minDist * minDist && distSq > 1e-4) {
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
      nodes2.forEach((node) => {
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
  function update2DPhysics(nodes2, width, height, dt) {
    const margin = 12;
    const w = Math.max(width, 200);
    const h = Math.max(height, 200);
    nodes2.forEach((node) => {
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
    for (let i = 0; i < nodes2.length; i++) {
      for (let j = i + 1; j < nodes2.length; j++) {
        const a = nodes2[i];
        const b = nodes2[j];
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
        if (distSq < minDist * minDist && distSq > 1e-4) {
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
    nodes2.forEach((node) => {
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
  function hasPriceChanged(prev, next) {
    if (!prev || !next) return true;
    const fields = [
      "current_price",
      "price_change_percentage_1h_in_currency",
      "price_change_percentage_24h",
      "price_change_percentage_7d_in_currency"
    ];
    return fields.some((field) => {
      const a = Number(prev[field] ?? 0);
      const b = Number(next[field] ?? 0);
      return Math.abs(a - b) > 1e-4;
    });
  }

  // src/main.ts
  var bubbleContainer = document.getElementById("bubble-container");
  var lastUpdateSpan = document.getElementById("last-update");
  var refreshBtn = document.getElementById("refresh-btn");
  var tooltip = document.getElementById("tooltip");
  var timeframeSelect = document.getElementById("timeframe");
  var limitBtn = document.getElementById("limit-btn");
  var backgroundPicker = document.getElementById("background-picker");
  var fullscreenBtn = document.getElementById("fullscreen-btn");
  var rotateBtn = document.getElementById("rotate-btn");
  var limitPopup = document.getElementById("limit-popup");
  var limitOptionsEl = document.getElementById("limit-options");
  var limitClose = document.getElementById("limit-close");
  var limitBackdrop = document.getElementById("limit-backdrop");
  var favoriteFilterBtn = document.getElementById("favorite-filter");
  var settingsBtn = document.getElementById("settings-btn");
  var settingsPopup = document.getElementById("settings-popup");
  var settingsBackdrop = document.getElementById("settings-backdrop");
  var settingsClose = document.getElementById("settings-close");
  var viewToggleSettings = document.getElementById("view-toggle-settings");
  var sizeToggleButtons = document.querySelectorAll("[data-size-mode]");
  var styleToggleButtons = document.querySelectorAll("[data-bubble-style]");
  var labelToggleButtons = document.querySelectorAll("[data-label-mode]");
  var coinModal = document.getElementById("coin-modal");
  var coinBackdrop = document.getElementById("coin-backdrop");
  var coinClose = document.getElementById("coin-close");
  var coinTitle = document.getElementById("coin-title");
  var coinMeta = document.getElementById("coin-meta");
  var coinGrid = document.getElementById("coin-grid");
  var coinLink = document.getElementById("coin-link");
  var coinFavBtn = document.getElementById("coin-fav-btn");
  var coinsData = [];
  var nodes = [];
  var animationId = null;
  var angleY = 0;
  var angleX = 0.25;
  var lastFrameTime = 0;
  var rotationPaused = false;
  var viewMode = "2d";
  var selectedRange = { label: "1 - 100", page: 1, perPage: 100 };
  var showFavoritesOnly = false;
  var favoriteIds = /* @__PURE__ */ new Set();
  var currentCoinInModal = null;
  var sizeMode = "percent";
  var bubbleStyle = "glass";
  var backgroundColor = "#0b0f1a";
  var labelMode = "both";
  var ranges = Array.from({ length: 10 }, (_, i) => {
    const start = i * 100 + 1;
    const end = start + 99;
    return { label: `${start} - ${end}`, page: i + 1, perPage: 100 };
  });
  function loadFavorites() {
    try {
      const raw = localStorage.getItem("cryptoBubblesFavorites");
      if (raw) favoriteIds = new Set(JSON.parse(raw));
    } catch {
      favoriteIds = /* @__PURE__ */ new Set();
    }
  }
  function saveFavorites() {
    try {
      localStorage.setItem("cryptoBubblesFavorites", JSON.stringify([...favoriteIds]));
    } catch {
    }
  }
  function toggleFavorite(coin) {
    if (!coin?.id) return;
    if (favoriteIds.has(coin.id)) {
      favoriteIds.delete(coin.id);
    } else {
      favoriteIds.add(coin.id);
    }
    saveFavorites();
    updateFavoriteUI();
    if (showFavoritesOnly) {
      initNodes({ reuseExisting: false });
    } else {
      updateBubbleDomContent(coin.id);
    }
    if (currentCoinInModal && currentCoinInModal.id === coin.id) {
      updateCoinModalFavoriteState(coin);
    }
  }
  function updateFavoriteUI() {
    if (favoriteFilterBtn) {
      favoriteFilterBtn.classList.toggle("active", showFavoritesOnly);
      favoriteFilterBtn.title = `Favorites (${favoriteIds.size})`;
    }
  }
  function updateSizeToggleUI() {
    sizeToggleButtons.forEach((btn) => {
      const mode = btn.getAttribute("data-size-mode");
      btn.classList.toggle("active", mode === sizeMode);
    });
  }
  function updateStyleToggleUI() {
    styleToggleButtons.forEach((btn) => {
      const mode = btn.getAttribute("data-bubble-style");
      btn.classList.toggle("active", mode === bubbleStyle);
    });
  }
  function updateLabelToggleUI() {
    labelToggleButtons.forEach((btn) => {
      const mode = btn.getAttribute("data-label-mode");
      btn.classList.toggle("active", mode === labelMode);
    });
  }
  function setBackground(color) {
    if (!color) return;
    backgroundColor = color;
    document.body.style.background = color;
    if (backgroundPicker && backgroundPicker.value !== color) {
      backgroundPicker.value = color;
    }
    try {
      localStorage.setItem("cryptoBubblesBg", color);
    } catch {
    }
  }
  function loadBackground() {
    let stored = null;
    try {
      stored = localStorage.getItem("cryptoBubblesBg");
    } catch {
      stored = null;
    }
    if (stored) {
      setBackground(stored);
    } else if (backgroundPicker?.value) {
      setBackground(backgroundPicker.value);
    } else {
      setBackground(backgroundColor);
    }
  }
  function updateCoinModalFavoriteState(coin) {
    if (!coinFavBtn) return;
    const isFav = favoriteIds.has(coin.id);
    coinFavBtn.textContent = isFav ? "Remove favorite" : "Add to favorite";
  }
  function updateBubbleDomContent(coinId) {
    const node = nodes.find((n) => n.coin.id === coinId);
    if (!node) return;
    updateBubbleDom(node.dom, node.coin, node.radius);
  }
  function buildApi(perPage, page) {
    return buildApiUrl({
      perPage,
      page,
      vsCurrency: "usd",
      priceChangePercentages: ["1h", "24h", "7d", "30d", "365d"]
    });
  }
  async function fetchCoins() {
    try {
      lastUpdateSpan.textContent = "Loading data...";
      const { perPage, page } = selectedRange;
      const url = buildApi(perPage, page);
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`API error ${res.status}`);
      }
      const data = await res.json();
      coinsData = data;
      initNodes({ reuseExisting: true });
      const now = /* @__PURE__ */ new Date();
      lastUpdateSpan.textContent = "Last update: " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (err) {
      console.error(err);
      lastUpdateSpan.textContent = "Error loading data. Click Refresh.";
    }
  }
  function initNodes(options = {}) {
    const reuseExisting = options.reuseExisting ?? false;
    const oldMap = reuseExisting ? new Map(nodes.map((n) => [n.coin.id, n])) : /* @__PURE__ */ new Map();
    if (!bubbleContainer) return;
    const width = bubbleContainer.clientWidth || window.innerWidth;
    const height = bubbleContainer.clientHeight || window.innerHeight;
    if (!width || !height) return;
    const filtered = showFavoritesOnly ? coinsData.filter((c) => favoriteIds.has(c.id)) : coinsData.slice();
    if (!filtered.length) {
      lastUpdateSpan.textContent = "No favorites in this range";
      nodes = [];
      return;
    }
    const tf = timeframeSelect.value || "24h";
    const baseNodes = buildBubbleNodes(filtered, {
      timeframe: tf,
      sizeMode,
      width,
      height,
      depthRange: { min: -1, max: 1 }
    });
    nodes = baseNodes.map((base, index) => {
      const existing = oldMap.get(base.coin.id);
      const changed = hasPriceChanged(existing?.coin, base.coin);
      const dom = changed || !existing ? createBubbleDom(base.coin, base.radius) : existing.dom;
      if (existing && !changed) {
        updateBubbleDom(dom, base.coin, base.radius);
      }
      return {
        ...base,
        dom,
        hover: false,
        layout2d: base.layout2d ?? existing?.layout2d,
        grow: changed || !existing ? { progress: 0, speed: 1.5 + Math.random() * 1.2, delay: Math.random() * 0.7, elapsed: 0 } : existing.grow ?? { progress: 1, speed: 0, delay: 0, elapsed: 1 }
      };
    });
    while (bubbleContainer.firstChild) bubbleContainer.removeChild(bubbleContainer.firstChild);
    nodes.forEach((node) => bubbleContainer.appendChild(node.dom));
    if (animationId !== null) cancelAnimationFrame(animationId);
    lastFrameTime = performance.now();
    animationId = requestAnimationFrame(loop);
  }
  function updateBubbleDom(dom, coin, radius) {
    const symEl = dom.querySelector(".bubble-symbol");
    const chEl = dom.querySelector(".bubble-change");
    const logoEl = dom.querySelector(".bubble-logo");
    if (symEl) symEl.textContent = coin.symbol.toUpperCase();
    if (chEl) {
      const tf = timeframeSelect.value || "24h";
      const changeVal = selectChangeByTimeframe(coin, tf) ?? 0;
      const changeText = (changeVal >= 0 ? "+" : "") + changeVal.toFixed(2) + "%";
      chEl.textContent = changeText;
      chEl.style.color = changeVal >= 0 ? "#a5ffb5" : "#ffb3b3";
    }
    dom.style.width = radius * 2 + "px";
    dom.style.height = radius * 2 + "px";
    dom.style.marginLeft = -radius + "px";
    dom.style.marginTop = -radius + "px";
    if (logoEl && coin.image) {
      logoEl.src = coin.image;
      logoEl.alt = coin.symbol;
    }
    dom.onclick = () => showCoinModal(coin);
  }
  function createBubbleDom(coin, radius) {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    const symbolDiv = document.createElement("div");
    symbolDiv.className = "bubble-symbol";
    symbolDiv.textContent = coin.symbol.toUpperCase();
    const logoImg = document.createElement("img");
    logoImg.className = "bubble-logo";
    if (coin.image) {
      logoImg.src = coin.image;
      logoImg.alt = coin.symbol;
    }
    const changeDiv = document.createElement("div");
    changeDiv.className = "bubble-change";
    const tf = timeframeSelect.value || "24h";
    const changeVal = selectChangeByTimeframe(coin, tf);
    const changeText = (changeVal >= 0 ? "+" : "") + changeVal.toFixed(2) + "%";
    changeDiv.textContent = changeText;
    changeDiv.style.color = changeVal >= 0 ? "#a5ffb5" : "#ffb3b3";
    bubble.append(logoImg, symbolDiv, changeDiv);
    bubble.style.width = radius * 2 + "px";
    bubble.style.height = radius * 2 + "px";
    bubble.style.marginLeft = -radius + "px";
    bubble.style.marginTop = -radius + "px";
    const setHover = (state) => {
      bubble.classList.toggle("hovered", state);
    };
    bubble.addEventListener("mousemove", (e) => showTooltip(e, coin));
    bubble.addEventListener("mouseleave", () => {
      hideTooltip();
      setHover(false);
    });
    bubble.addEventListener("mouseenter", () => setHover(true));
    bubble.addEventListener("pointerenter", () => setHover(true));
    bubble.addEventListener("pointerleave", () => setHover(false));
    bubble.addEventListener("click", () => showCoinModal(coin));
    return bubble;
  }
  function loop(timestamp) {
    const dt = (timestamp - lastFrameTime) / 1e3;
    lastFrameTime = timestamp;
    if (!rotationPaused) {
      angleY += 0.12 * dt;
      angleX += 0.02 * dt;
    }
    const width = bubbleContainer.clientWidth || 1;
    const height = bubbleContainer.clientHeight || 1;
    const cx = width / 2;
    const cy = height / 2;
    const perspective = Math.min(width, height) * 0.8;
    const planeScale = Math.min(width, height) * 0.48;
    const cosY = Math.cos(angleY);
    const sinY = Math.sin(angleY);
    const cosX = Math.cos(angleX);
    const sinX = Math.sin(angleX);
    if (viewMode === "2d") {
      update2DPhysics(nodes, width, height, dt);
    }
    nodes.forEach((node) => {
      const { x, y, z, radius, dom, coin, x2d, y2d, sizeFactor, layout2d, grow } = node;
      if (grow) {
        grow.elapsed += dt;
        const t = Math.max(0, grow.elapsed - (grow.delay || 0));
        grow.progress = Math.min(1, t * (grow.speed || 1));
      }
      const growScale = grow ? 0.2 + 0.8 * Math.pow(grow.progress, 0.85) : 1;
      const tf = timeframeSelect.value || "24h";
      const changeUse = selectChangeByTimeframe(coin, tf);
      const gradient = calcBubbleColor(changeUse, tf);
      if (viewMode === "3d") {
        const xz = x * cosY - z * sinY;
        const zz = x * sinY + z * cosY;
        const yz = y * cosX - zz * sinX;
        const zz2 = y * sinX + zz * cosX;
        const depth = (zz2 + 2) / 4;
        const scale = 0.3 + depth * 0.9;
        const screenX = cx + xz * perspective * 0.5;
        const screenY = cy + yz * perspective * 0.5;
        const opacity = 0.35 + depth * 0.65;
        dom.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) scale(${scale * growScale})`;
        dom.style.opacity = String(opacity);
        dom.style.zIndex = String(Math.floor(depth * 1e3));
      } else {
        const pos = layout2d || { x: cx, y: cy, scale: 0.65 + sizeFactor * 0.4 };
        const screenX = pos.x;
        const screenY = pos.y;
        const bubbleScale = pos.scale;
        const opacity = 0.9;
        dom.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) scale(${bubbleScale * growScale})`;
        dom.style.opacity = String(opacity);
        dom.style.zIndex = String(500 + Math.floor(sizeFactor * 400));
      }
      const isHover = dom.classList.contains("hovered");
      if (bubbleStyle === "basic") {
        dom.style.background = "rgba(0,0,0,0.7)";
        dom.style.boxShadow = isHover ? `0 12px 28px rgba(0,0,0,0.6)` : `0 10px 22px rgba(0,0,0,0.5)`;
        dom.style.borderColor = isHover ? "#ffffff" : gradient;
      } else {
        dom.style.background = `
        radial-gradient(circle at 35% 30%, rgba(255,255,255,0.14), rgba(255,255,255,0) 38%),
        radial-gradient(circle at 50% 50%, ${gradient} 0%, rgba(0,0,0,0.8) 65%, rgba(0,0,0,0.95) 100%)
      `;
        dom.style.boxShadow = isHover ? `0 14px 40px rgba(0,0,0,0.7)` : `0 12px 36px rgba(0,0,0,0.55)`;
        dom.style.borderColor = isHover ? "rgba(255,255,255,0.95)" : gradient;
      }
      const changeRender = changeUse ?? 0;
      const changeTextLocal = (changeRender >= 0 ? "+" : "") + changeRender.toFixed(2) + "%";
      const symbolLen = Math.max(coin.symbol?.length || 0, 3);
      const changeLen = Math.max(changeTextLocal.length, 4);
      const isTiny = radius < 26;
      const padding = clamp(radius * 0.18, 2, 8);
      dom.style.padding = `${padding}px`;
      const symbolSize = clamp(radius * 0.32 * (3 / symbolLen), isTiny ? 8 : 11, 44);
      const changeSize = clamp(radius * 0.22 * (5 / changeLen), isTiny ? 8 : 11, 30);
      const symbolEl = dom.querySelector(".bubble-symbol");
      const changeEl = dom.querySelector(".bubble-change");
      const logoEl = dom.querySelector(".bubble-logo");
      if (symbolEl) {
        symbolEl.style.fontSize = `${symbolSize}px`;
        symbolEl.style.lineHeight = "1.05";
      }
      if (changeEl) {
        changeEl.style.fontSize = `${changeSize}px`;
        changeEl.style.lineHeight = "1.05";
        changeEl.style.marginTop = isTiny ? "2px" : "3px";
      }
      if (logoEl) {
        const logoSize = clamp(radius * (isTiny ? 0.48 : 0.6), isTiny ? 12 : 18, 56);
        logoEl.style.width = `${logoSize}px`;
        logoEl.style.height = `${logoSize}px`;
      }
      if (labelMode === "logo") {
        symbolEl && (symbolEl.style.display = "none");
        changeEl && (changeEl.style.display = "block");
        logoEl && (logoEl.style.display = "block");
      } else if (labelMode === "name") {
        symbolEl && (symbolEl.style.display = "block");
        changeEl && (changeEl.style.display = "block");
        logoEl && (logoEl.style.display = "none");
      } else {
        symbolEl && (symbolEl.style.display = "block");
        changeEl && (changeEl.style.display = "block");
        logoEl && (logoEl.style.display = "block");
      }
    });
    animationId = requestAnimationFrame(loop);
  }
  function showCoinModal(coin) {
    if (!coinModal) return;
    const tf = timeframeSelect.value || "24h";
    const change = selectChangeByTimeframe(coin, tf);
    const changeClass = change >= 0 ? "change-positive" : "change-negative";
    const changeColorClass = change >= 0 ? "positive" : "negative";
    currentCoinInModal = coin;
    const fields = [
      { label: "Price", value: "$" + formatPrice(coin.current_price), cls: changeColorClass },
      {
        label: "1h",
        value: formatPercent(coin.price_change_percentage_1h_in_currency),
        cls: (coin.price_change_percentage_1h_in_currency ?? 0) >= 0 ? "positive" : "negative"
      },
      {
        label: "24h",
        value: formatPercent(coin.price_change_percentage_24h),
        cls: (coin.price_change_percentage_24h ?? 0) >= 0 ? "positive" : "negative"
      },
      {
        label: "7d",
        value: formatPercent(coin.price_change_percentage_7d_in_currency),
        cls: (coin.price_change_percentage_7d_in_currency ?? 0) >= 0 ? "positive" : "negative"
      },
      { label: "Market Cap", value: "$" + (coin.market_cap?.toLocaleString() || "-"), cls: "" },
      { label: "Volume 24h", value: "$" + (coin.total_volume?.toLocaleString() || "-"), cls: "" },
      { label: "Circulating", value: coin.circulating_supply ? coin.circulating_supply.toLocaleString() : "-", cls: "" },
      { label: "Total Supply", value: coin.total_supply ? coin.total_supply.toLocaleString() : "-", cls: "" }
    ];
    if (coinTitle) coinTitle.textContent = `${coin.name} (${coin.symbol.toUpperCase()})`;
    const imgHtml = coin.image ? `<img src="${coin.image}" alt="${coin.symbol}" class="coin-avatar" />` : "";
    if (coinMeta) {
      coinMeta.innerHTML = `
    ${imgHtml}
    <span class="chip">Rank ${coin.market_cap_rank ?? "-"}</span>
    <span class="chip ${changeClass}">${tf} ${formatPercent(change)}</span>
  `;
    }
    if (coinGrid) {
      coinGrid.innerHTML = fields.map(
        (f) => `
        <div class="coin-cell">
          <div class="label">${f.label}</div>
          <div class="value ${f.cls || ""}">${f.value}</div>
        </div>
      `
      ).join("");
    }
    if (coinLink) coinLink.href = `https://www.coingecko.com/en/coins/${coin.id}`;
    coinBackdrop?.classList.remove("hidden");
    coinModal.classList.remove("hidden");
    if (coinFavBtn) {
      coinFavBtn.onclick = () => toggleFavorite(coin);
      updateCoinModalFavoriteState(coin);
    }
  }
  function hideCoinModal() {
    coinBackdrop?.classList.add("hidden");
    coinModal?.classList.add("hidden");
    currentCoinInModal = null;
  }
  function openSettingsPopup() {
    settingsPopup?.classList.remove("hidden");
    settingsBackdrop?.classList.remove("hidden");
  }
  function closeSettingsPopup() {
    settingsPopup?.classList.add("hidden");
    settingsBackdrop?.classList.add("hidden");
  }
  function showTooltip(event, coin) {
    const tf = timeframeSelect.value || "24h";
    const change1h = coin.price_change_percentage_1h_in_currency;
    const change24h = coin.price_change_percentage_24h;
    const change7d = coin.price_change_percentage_7d_in_currency;
    tooltip.classList.remove("hidden");
    tooltip.style.left = event.clientX + 14 + "px";
    tooltip.style.top = event.clientY + 14 + "px";
    tooltip.innerHTML = `
    <div><strong>${coin.name} (${coin.symbol.toUpperCase()})</strong></div>
    <div class="line"><span class="label">Price</span><span>$${formatPrice(coin.current_price)}</span></div>
    <div class="line"><span class="label">Market cap</span><span>$${coin.market_cap?.toLocaleString() || "-"}</span></div>
    <div class="line"><span class="label">1h</span><span>${formatPercent(change1h)}</span></div>
    <div class="line"><span class="label">24h</span><span>${formatPercent(change24h)}</span></div>
    <div class="line"><span class="label">7d</span><span>${formatPercent(change7d)}</span></div>
  `;
  }
  function hideTooltip() {
    tooltip.classList.add("hidden");
  }
  function toggleViewMode() {
    viewMode = viewMode === "2d" ? "3d" : "2d";
    updateViewButton();
  }
  function updateViewButton() {
    const is3D = viewMode === "3d";
    const label = is3D ? "Switch to 2D" : "Switch to 3D";
    if (viewToggleSettings) {
      viewToggleSettings.textContent = is3D ? "3D" : "2D";
      viewToggleSettings.setAttribute("aria-label", label);
      viewToggleSettings.title = label;
    }
  }
  function toggleRotation() {
    rotationPaused = !rotationPaused;
    if (rotateBtn) rotateBtn.classList.toggle("active", rotationPaused);
    const label = rotationPaused ? "Resume rotation" : "Pause rotation";
    rotateBtn?.setAttribute("aria-label", label);
    rotateBtn && (rotateBtn.title = label);
  }
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }
  function syncFullscreenButton() {
    const isFull = Boolean(document.fullscreenElement);
    const label = isFull ? "Exit fullscreen" : "Fullscreen";
    fullscreenBtn?.classList.toggle("active", isFull);
    fullscreenBtn?.setAttribute("aria-label", label);
    fullscreenBtn && (fullscreenBtn.title = label);
  }
  function openLimitPopup() {
    limitPopup?.classList.remove("hidden");
    limitBackdrop?.classList.remove("hidden");
  }
  function closeLimitPopup() {
    limitPopup?.classList.add("hidden");
    limitBackdrop?.classList.add("hidden");
  }
  function renderLimitOptions() {
    if (!limitOptionsEl) return;
    limitOptionsEl.innerHTML = "";
    ranges.forEach((range) => {
      const item = document.createElement("div");
      item.className = "popup-option" + (range.label === selectedRange.label ? " active" : "");
      const radio = document.createElement("div");
      radio.className = "popup-radio";
      const label = document.createElement("div");
      label.className = "popup-label";
      label.textContent = range.label;
      const change = document.createElement("div");
      change.className = "popup-change";
      change.textContent = "\u2014";
      item.append(radio, label, change);
      item.addEventListener("click", () => {
        selectedRange = range;
        limitBtn.textContent = range.label;
        closeLimitPopup();
        renderLimitOptions();
        fetchCoins();
      });
      limitOptionsEl.appendChild(item);
    });
  }
  refreshBtn.addEventListener("click", () => fetchCoins());
  timeframeSelect.addEventListener("change", () => initNodes());
  fullscreenBtn?.addEventListener("click", toggleFullscreen);
  rotateBtn?.addEventListener("click", toggleRotation);
  limitBtn?.addEventListener("click", () => {
    if (limitPopup?.classList.contains("hidden")) openLimitPopup();
    else closeLimitPopup();
  });
  limitClose?.addEventListener("click", closeLimitPopup);
  document.addEventListener("click", (e) => {
    if (!limitPopup || !limitBtn) return;
    if (limitPopup.classList.contains("hidden")) return;
    const target = e.target;
    if (limitPopup.contains(target) || limitBtn.contains(target) || limitBackdrop?.contains(target)) return;
    closeLimitPopup();
  });
  document.addEventListener("fullscreenchange", syncFullscreenButton);
  window.addEventListener("resize", () => initNodes());
  coinClose?.addEventListener("click", hideCoinModal);
  coinBackdrop?.addEventListener("click", hideCoinModal);
  favoriteFilterBtn?.addEventListener("click", () => {
    showFavoritesOnly = !showFavoritesOnly;
    updateFavoriteUI();
    initNodes({ reuseExisting: false });
  });
  settingsBtn?.addEventListener("click", openSettingsPopup);
  settingsClose?.addEventListener("click", closeSettingsPopup);
  settingsBackdrop?.addEventListener("click", closeSettingsPopup);
  viewToggleSettings?.addEventListener("click", toggleViewMode);
  sizeToggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-size-mode");
      if (!mode || mode === sizeMode) return;
      sizeMode = mode;
      updateSizeToggleUI();
      initNodes({ reuseExisting: false });
    });
  });
  styleToggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-bubble-style");
      if (!mode || mode === bubbleStyle) return;
      bubbleStyle = mode;
      updateStyleToggleUI();
      initNodes({ reuseExisting: true });
    });
  });
  backgroundPicker?.addEventListener("input", (e) => {
    const target = e.target;
    setBackground(target.value);
  });
  labelToggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-label-mode");
      if (!mode || mode === labelMode) return;
      labelMode = mode;
      updateLabelToggleUI();
      initNodes({ reuseExisting: true });
    });
  });
  syncFullscreenButton();
  updateViewButton();
  renderLimitOptions();
  loadFavorites();
  updateFavoriteUI();
  updateSizeToggleUI();
  updateStyleToggleUI();
  updateLabelToggleUI();
  loadBackground();
  fetchCoins();
  setInterval(fetchCoins, 6e4);
})();
//# sourceMappingURL=main.js.map
