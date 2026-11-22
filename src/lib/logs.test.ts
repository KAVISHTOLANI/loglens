import { describe, expect, it } from 'vitest';
import { buildMatcher, countLevels, errorGroups, filterEntries, LEVELS, normaliseLevel, parseLine, parseLog, timeline } from './logs';

describe('parsing', () => {
  it('reads common text formats', () => {
    const a = parseLine('2026-03-04T10:12:01Z ERROR [payments] Card declined for order 1234', 1);
    expect(a).toMatchObject({ level: 'ERROR', source: 'payments', message: 'Card declined for order 1234', ts: Date.UTC(2026, 2, 4, 10, 12, 1) });
    const b = parseLine('2026-03-04 10:12:01,250 WARNING api: slow query took 812ms', 2);
    expect(b).toMatchObject({ level: 'WARN', source: 'api', message: 'slow query took 812ms' });
    expect(b.ts).toBe(Date.UTC(2026, 2, 4, 10, 12, 1, 250));
  });
  it('reads JSON lines and syslog', () => {
    expect(parseLine('{"time":"2026-03-04T10:00:00Z","level":"info","msg":"started","service":"web"}', 1)).toMatchObject({ level: 'INFO', source: 'web', message: 'started' });
    expect(parseLine('{"timestamp":1772618400,"severity":"critical","message":"disk full"}', 1)).toMatchObject({ level: 'FATAL', ts: 1772618400000 });
    expect(parseLine('Mar  4 10:12:01 host1 sshd[812]: error: authentication failure', 1, 2026)).toMatchObject({ level: 'ERROR', source: 'sshd', ts: Date.UTC(2026, 2, 4, 10, 12, 1) });
  });
  it('keeps unknown lines and attaches stack traces', () => {
    expect(parseLine('something odd', 1)).toMatchObject({ level: 'UNKNOWN', ts: null });
    const log = parseLog('2026-03-04T10:00:00Z ERROR boom\n    at handler (app.js:10)\n    at run (app.js:20)\n2026-03-04T10:00:01Z INFO ok');
    expect(log).toHaveLength(2);
    expect(log[0].message).toContain('at run');
    expect(normaliseLevel('Notice')).toBe('INFO');
  });
});

describe('analysis', () => {
  const entries = parseLog([
    '2026-03-04T10:00:00Z INFO [web] request 1',
    '2026-03-04T10:01:00Z ERROR [db] timeout after 3000 ms on query 17',
    '2026-03-04T10:02:00Z ERROR [db] timeout after 2500 ms on query 92',
    '2026-03-04T10:30:00Z WARN [web] slow',
    'garbage line',
  ].join('\n'));
  it('counts levels', () => {
    const c = countLevels(entries);
    expect(c.ERROR).toBe(2);
    expect(c.UNKNOWN).toBe(1);
  });
  it('filters by level, source, text, regex and time', () => {
    const all = { levels: [...LEVELS], query: '', source: '', from: null, to: null };
    expect(filterEntries(entries, { ...all, levels: ['ERROR'] }).list).toHaveLength(2);
    expect(filterEntries(entries, { ...all, source: 'web' }).list).toHaveLength(2);
    expect(filterEntries(entries, { ...all, query: 'TIMEOUT' }).list).toHaveLength(2);
    expect(filterEntries(entries, { ...all, query: '/query 9\\d/' }).list).toHaveLength(1);
    expect(filterEntries(entries, { ...all, query: '/(/' }).error).toMatch(/Invalid pattern/);
    expect(filterEntries(entries, { ...all, from: Date.UTC(2026, 2, 4, 10, 1), to: Date.UTC(2026, 2, 4, 10, 3) }).list).toHaveLength(2);
    expect(buildMatcher('').test('x')).toBe(true);
  });
  it('groups similar errors and builds a timeline', () => {
    const g = errorGroups(entries);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ count: 2, pattern: 'timeout after <n> ms on query <n>' });
    const t = timeline(entries)!;
    expect(t.step).toBe(60_000);
    expect(t.buckets).toHaveLength(31);
    expect(t.buckets[1].counts.ERROR).toBe(1);
    expect(t.untimed).toBe(1);
    expect(timeline(parseLog('no times here'))).toBeNull();
  });
});
