export const ENDPOINT_COSTS = {
  "/v1/articles": 1,
  "/v1/search": 5,
} as const;

export type PricedEndpoint = keyof typeof ENDPOINT_COSTS;

export const CREDITS_PER_PURCHASE = 500;

export const PRICE_CHF = 5;
export const CURRENCY = "CHF";
