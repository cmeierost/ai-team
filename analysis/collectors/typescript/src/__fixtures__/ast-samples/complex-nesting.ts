export function processData(data: unknown[]): string[] {
  const results: string[] = [];
  for (const item of data) {
    if (typeof item === 'string') {
      if (item.length > 0) {
        for (const char of item) {
          if (char === 'x') {
            results.push(item);
          }
        }
      }
    } else if (typeof item === 'number') {
      if (item > 0 && item < 100) {
        results.push(String(item));
      }
    }
  }
  return results;
}
