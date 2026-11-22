/** Deterministic demo log: three hours of a fictional web service with an incident in the middle. */
export function demoLog(): string {
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const base = Date.UTC(2026, 2, 4, 9, 0, 0);
  const lines: string[] = [];
  const iso = (t: number) => new Date(t).toISOString().replace('.000', '');
  const paths = ['/api/orders', '/api/cart', '/api/search?q=mug', '/login', '/api/orders/8812', '/health'];
  for (let i = 0; i < 340; i++) {
    const t = base + Math.floor(i * 32_000 + r() * 20_000);
    const incident = i > 150 && i < 200;
    const roll = r();
    if (i % 41 === 0) {
      lines.push(JSON.stringify({ time: iso(t), level: 'info', service: 'worker', msg: `Processed batch ${100 + i} (${Math.floor(r() * 400)} emails queued)` }));
    } else if (incident && roll < 0.45) {
      const q = Math.floor(r() * 900);
      lines.push(`${iso(t)} ERROR [db] Connection pool exhausted after 3000 ms (query ${q})`);
      if (roll < 0.08) lines.push(`    at Pool.acquire (pool.js:212:11)`, `    at OrdersRepo.find (orders.js:48:20)`);
    } else if (incident && roll < 0.6) {
      lines.push(`${iso(t)} WARN [api] Slow response ${800 + Math.floor(r() * 2400)} ms for GET ${paths[Math.floor(r() * paths.length)]}`);
    } else if (roll < 0.03) {
      lines.push(`${iso(t)} ERROR [payments] Card declined for order ${4000 + i}: insufficient funds`);
    } else if (roll < 0.06) {
      lines.push(`${iso(t)} WARN [auth] 3 failed login attempts for user id ${1000 + Math.floor(r() * 50)}`);
    } else if (roll < 0.1) {
      lines.push(`${iso(t)} DEBUG [cache] Miss for key product:${Math.floor(r() * 300)}`);
    } else {
      lines.push(`${iso(t)} INFO [api] GET ${paths[Math.floor(r() * paths.length)]} 200 ${20 + Math.floor(r() * 180)} ms`);
    }
    if (i === 199) lines.push(`${iso(t + 1000)} INFO [db] Pool recovered — 40 connections available`);
    if (i === 170) lines.push(`${iso(t + 500)} FATAL [db] Replica db-2 unreachable, failing over to db-1`);
    if (i === 90) lines.push('--- log rotated by logrotate ---');
  }
  return lines.join('\n');
}
