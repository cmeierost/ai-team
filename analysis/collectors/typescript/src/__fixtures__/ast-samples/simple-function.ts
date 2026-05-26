export function calculateTotal(items: number[], tax: number): number {
  let total = 0;
  for (const item of items) {
    if (item > 0) {
      total += item;
    }
  }
  if (tax > 0) {
    total *= (1 + tax);
  }
  return total;
}
