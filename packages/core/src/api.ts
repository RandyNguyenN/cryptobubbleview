import { Timeframe } from "./types.js";

export interface ApiParams {
  vsCurrency?: string;
  perPage?: number;
  page?: number;
  priceChangePercentages?: Timeframe[];
}

const API_BASE = "https://api.coingecko.com/api/v3/coins/markets";

export function buildApiUrl(params: ApiParams = {}): string {
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
