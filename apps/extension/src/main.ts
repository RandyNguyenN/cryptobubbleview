import {
  buildApiUrl,
  buildBubbleNodes,
  calcBubbleColor,
  clamp,
  formatPercent,
  formatPrice,
  hasPriceChanged,
  MIN_RADIUS,
  MAX_RADIUS,
  selectChangeByTimeframe,
  update2DPhysics
} from "@cryptobubble/core";
import type { BubbleNode, CoinMarket, Timeframe } from "@cryptobubble/core";

const bubbleContainer = document.getElementById("bubble-container")!;
const lastUpdateSpan = document.getElementById("last-update")!;
const refreshBtn = document.getElementById("refresh-btn")!;
const tooltip = document.getElementById("tooltip")!;
const timeframeSelect = document.getElementById("timeframe") as HTMLSelectElement;
const limitBtn = document.getElementById("limit-btn")!;
const backgroundPicker = document.getElementById("background-picker") as HTMLInputElement;
const fullscreenBtn = document.getElementById("fullscreen-btn");
const rotateBtn = document.getElementById("rotate-btn");
const limitPopup = document.getElementById("limit-popup");
const limitOptionsEl = document.getElementById("limit-options");
const limitClose = document.getElementById("limit-close");
const limitBackdrop = document.getElementById("limit-backdrop");
const favoriteFilterBtn = document.getElementById("favorite-filter");
const settingsBtn = document.getElementById("settings-btn");
const settingsPopup = document.getElementById("settings-popup");
const settingsBackdrop = document.getElementById("settings-backdrop");
const settingsClose = document.getElementById("settings-close");
const viewToggleSettings = document.getElementById("view-toggle-settings");
const sizeToggleButtons = document.querySelectorAll<HTMLButtonElement>("[data-size-mode]");
const styleToggleButtons = document.querySelectorAll<HTMLButtonElement>("[data-bubble-style]");
const labelToggleButtons = document.querySelectorAll<HTMLButtonElement>("[data-label-mode]");
const coinModal = document.getElementById("coin-modal");
const coinBackdrop = document.getElementById("coin-backdrop");
const coinClose = document.getElementById("coin-close");
const coinTitle = document.getElementById("coin-title");
const coinMeta = document.getElementById("coin-meta");
const coinGrid = document.getElementById("coin-grid");
const coinLink = document.getElementById("coin-link") as HTMLAnchorElement | null;
const coinFavBtn = document.getElementById("coin-fav-btn");

type BubbleViewMode = "2d" | "3d";
type SizeMode = "cap" | "percent" | "volume";
type BubbleStyle = "glass" | "basic";
type LabelMode = "both" | "name" | "logo";

type BubbleDomNode = BubbleNode & {
  dom: HTMLDivElement;
  hover: boolean;
  grow?: { progress: number; speed: number; delay: number; elapsed: number };
};

let coinsData: CoinMarket[] = [];
let nodes: BubbleDomNode[] = [];
let animationId: number | null = null;
let angleY = 0;
let angleX = 0.25;
let lastFrameTime = 0;
let rotationPaused = false;
let viewMode: BubbleViewMode = "2d";
let selectedRange = { label: "1 - 100", page: 1, perPage: 100 };
let showFavoritesOnly = false;
let favoriteIds = new Set<string>();
let currentCoinInModal: CoinMarket | null = null;
let sizeMode: SizeMode = "percent";
let bubbleStyle: BubbleStyle = "glass";
let backgroundColor = "#0b0f1a";
let labelMode: LabelMode = "both";

const ranges = Array.from({ length: 10 }, (_, i) => {
  const start = i * 100 + 1;
  const end = start + 99;
  return { label: `${start} - ${end}`, page: i + 1, perPage: 100 };
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

function loadFavorites() {
  try {
    const raw = localStorage.getItem("cryptoBubblesFavorites");
    if (raw) favoriteIds = new Set(JSON.parse(raw));
  } catch {
    favoriteIds = new Set();
  }
}

function saveFavorites() {
  try {
    localStorage.setItem("cryptoBubblesFavorites", JSON.stringify([...favoriteIds]));
  } catch {
    // ignore
  }
}

function toggleFavorite(coin: CoinMarket) {
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
    const mode = btn.getAttribute("data-size-mode") as SizeMode | null;
    btn.classList.toggle("active", mode === sizeMode);
  });
}

function updateStyleToggleUI() {
  styleToggleButtons.forEach((btn) => {
    const mode = btn.getAttribute("data-bubble-style") as BubbleStyle | null;
    btn.classList.toggle("active", mode === bubbleStyle);
  });
}

function updateLabelToggleUI() {
  labelToggleButtons.forEach((btn) => {
    const mode = btn.getAttribute("data-label-mode") as LabelMode | null;
    btn.classList.toggle("active", mode === labelMode);
  });
}

function setBackground(color: string) {
  if (!color) return;
  backgroundColor = color;
  document.body.style.background = color;
  if (backgroundPicker && backgroundPicker.value !== color) {
    backgroundPicker.value = color;
  }
  try {
    localStorage.setItem("cryptoBubblesBg", color);
  } catch {
    // ignore
  }
}

function loadBackground() {
  let stored: string | null = null;
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

function updateCoinModalFavoriteState(coin: CoinMarket) {
  if (!coinFavBtn) return;
  const isFav = favoriteIds.has(coin.id);
  coinFavBtn.textContent = isFav ? "Remove favorite" : "Add to favorite";
}

function updateBubbleDomContent(coinId: string) {
  const node = nodes.find((n) => n.coin.id === coinId);
  if (!node) return;
  updateBubbleDom(node.dom, node.coin, node.radius);
}

function buildApi(perPage: number, page: number) {
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
    const res = await fetchWithRetry(url);
    const data = (await res.json()) as CoinMarket[];
    coinsData = data;
    initNodes({ reuseExisting: true });
    const now = new Date();
    lastUpdateSpan.textContent =
      "Last update: " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (err) {
    console.error(err);
    lastUpdateSpan.textContent = "Error loading data. Click Refresh.";
  }
}

function initNodes(options: { reuseExisting?: boolean } = {}) {
  const reuseExisting = options.reuseExisting ?? false;
  const oldMap = reuseExisting ? new Map(nodes.map((n) => [n.coin.id, n])) : new Map();

  if (!bubbleContainer) return;
  const width = bubbleContainer.clientWidth || window.innerWidth;
  const height = bubbleContainer.clientHeight || window.innerHeight;
  if (!width || !height) return;

  const filtered = showFavoritesOnly
    ? coinsData.filter((c) => favoriteIds.has(c.id))
    : coinsData.slice();
  if (!filtered.length) {
    lastUpdateSpan.textContent = "No favorites in this range";
    nodes = [];
    return;
  }

  const tf = (timeframeSelect.value || "24h") as Timeframe;
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
      grow:
        changed || !existing
          ? { progress: 0, speed: 1.5 + Math.random() * 1.2, delay: Math.random() * 0.7, elapsed: 0 }
          : existing.grow ?? { progress: 1, speed: 0, delay: 0, elapsed: 1 }
    };
  });

  while (bubbleContainer.firstChild) bubbleContainer.removeChild(bubbleContainer.firstChild);
  nodes.forEach((node) => bubbleContainer.appendChild(node.dom));

  if (animationId !== null) cancelAnimationFrame(animationId);
  lastFrameTime = performance.now();
  animationId = requestAnimationFrame(loop);
}

function updateBubbleDom(dom: HTMLElement, coin: CoinMarket, radius: number) {
  const symEl = dom.querySelector<HTMLElement>(".bubble-symbol");
  const chEl = dom.querySelector<HTMLElement>(".bubble-change");
  const logoEl = dom.querySelector<HTMLImageElement>(".bubble-logo");
  if (symEl) symEl.textContent = coin.symbol.toUpperCase();
  if (chEl) {
    const tf = (timeframeSelect.value || "24h") as Timeframe;
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

function createBubbleDom(coin: CoinMarket, radius: number) {
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
  const tf = (timeframeSelect.value || "24h") as Timeframe;
  const changeVal = selectChangeByTimeframe(coin, tf);
  const changeText = (changeVal >= 0 ? "+" : "") + changeVal.toFixed(2) + "%";
  changeDiv.textContent = changeText;
  changeDiv.style.color = changeVal >= 0 ? "#a5ffb5" : "#ffb3b3";

  bubble.append(logoImg, symbolDiv, changeDiv);

  bubble.style.width = radius * 2 + "px";
  bubble.style.height = radius * 2 + "px";
  bubble.style.marginLeft = -radius + "px";
  bubble.style.marginTop = -radius + "px";

  const setHover = (state: boolean) => {
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

function loop(timestamp: number) {
  const rawDt = (timestamp - lastFrameTime) / 1000;
  const dt = Math.min(rawDt, 0.05); // clamp large gaps (e.g., when tab was hidden)
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

    const tf = (timeframeSelect.value || "24h") as Timeframe;
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
      dom.style.zIndex = String(Math.floor(depth * 1000));
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
    const symbolEl = dom.querySelector<HTMLElement>(".bubble-symbol");
    const changeEl = dom.querySelector<HTMLElement>(".bubble-change");
    const logoEl = dom.querySelector<HTMLImageElement>(".bubble-logo");
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

function showCoinModal(coin: CoinMarket) {
  if (!coinModal) return;
  const tf = (timeframeSelect.value || "24h") as Timeframe;
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
    coinGrid.innerHTML = fields
      .map(
        (f) => `
        <div class="coin-cell">
          <div class="label">${f.label}</div>
          <div class="value ${f.cls || ""}">${f.value}</div>
        </div>
      `
      )
      .join("");
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

function showTooltip(event: MouseEvent, coin: CoinMarket) {
  const tf = (timeframeSelect.value || "24h") as Timeframe;
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
    change.textContent = "—";

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
  const target = e.target as HTMLElement;
  if (limitPopup.contains(target) || limitBtn.contains(target) || limitBackdrop?.contains(target)) return;
  closeLimitPopup();
});
document.addEventListener("fullscreenchange", syncFullscreenButton);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    lastFrameTime = performance.now();
  }
});
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
    const mode = btn.getAttribute("data-size-mode") as SizeMode | null;
    if (!mode || mode === sizeMode) return;
    sizeMode = mode;
    updateSizeToggleUI();
    initNodes({ reuseExisting: false });
  });
});
styleToggleButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.getAttribute("data-bubble-style") as BubbleStyle | null;
    if (!mode || mode === bubbleStyle) return;
    bubbleStyle = mode;
    updateStyleToggleUI();
    initNodes({ reuseExisting: true });
  });
});
backgroundPicker?.addEventListener("input", (e) => {
  const target = e.target as HTMLInputElement;
  setBackground(target.value);
});
labelToggleButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.getAttribute("data-label-mode") as LabelMode | null;
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
setInterval(fetchCoins, 60000);
