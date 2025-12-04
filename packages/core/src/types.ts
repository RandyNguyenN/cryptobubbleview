export type Timeframe = "1h" | "24h" | "7d" | "30d" | "365d";

export type SizeMode = "cap" | "percent" | "volume";

export interface RangeOption {
  label: string;
  page: number;
  perPage: number;
}

export interface CoinMarket {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  current_price?: number;
  market_cap?: number;
  total_volume?: number;
  market_cap_rank?: number;
  circulating_supply?: number;
  total_supply?: number;
  price_change_percentage_1h_in_currency?: number;
  price_change_percentage_24h?: number;
  price_change_percentage_7d_in_currency?: number;
  price_change_percentage_30d_in_currency?: number;
  price_change_percentage_1y_in_currency?: number;
}

export interface Layout2DState {
  x: number;
  y: number;
  scale: number;
  vx?: number;
  vy?: number;
  seed?: number;
  t?: number;
}

export interface BubbleNode {
  coin: CoinMarket;
  radius: number;
  sizeFactor: number;
  x: number;
  y: number;
  z: number;
  depth: number;
  x2d: number;
  y2d: number;
  layout2d?: Layout2DState;
}

export interface BubbleMetric {
  coin: CoinMarket;
  cap: number;
  change: number;
  volume: number;
}
