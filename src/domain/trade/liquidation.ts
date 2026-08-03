export interface LiquidationResult {
  price?: string;
  reliable: boolean;
}

export function calculateLiquidationPrice(): LiquidationResult {
  return {
    price: undefined,
    reliable: false
  };
}
