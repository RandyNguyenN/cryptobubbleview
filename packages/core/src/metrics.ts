import { CoinMarket, Timeframe } from "./types.js";

export function selectChangeByTimeframe(coin: CoinMarket, timeframe: Timeframe): number {
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

export function formatPrice(value?: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  if (num >= 1000) return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (num >= 1) return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function formatPercent(value?: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
}

export function calcBubbleColor(change: number, timeframe: Timeframe): string {
  const val = timeframe === "1h" ? change ?? 0 : change ?? 0;
  const strong = Math.abs(val) >= 1.5;
  if (val >= 0) {
    return strong ? "rgba(180, 229, 13, 0.95)" : "rgba(120, 200, 65, 0.9)";
  }
  return strong ? "rgba(255, 0, 0, 0.95)" : "rgba(215, 108, 130, 0.9)";
}
