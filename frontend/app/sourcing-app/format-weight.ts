/** "до кожного товару ще додати вагу" (2026-11-11) — up to 2 decimals, trailing zeros trimmed (0.5 кг, not 0.50 кг). */
export function formatWeightKg(weightKg: number): string {
  return `${Number(weightKg.toFixed(2))} кг`;
}
