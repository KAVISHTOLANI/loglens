export const LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'UNKNOWN'] as const;
export type Level = (typeof LEVELS)[number];

export interface Entry {
  line: number;
  ts: number | null;
  level: Level;
  source: string | null;
  message: string;
  raw: string;
}

const ALIASES: Record<string, Level> = {
  trace: 'TRACE', debug: 'DEBUG', dbg: 'DEBUG', info: 'INFO', information: 'INFO', notice: 'INFO',
  warn: 'WARN', warning: 'WARN', error: 'ERROR', err: 'ERROR', critical: 'FATAL', crit: 'FATAL', fatal: 'FATAL', panic: 'FATAL', emerg: 'FATAL',
};

export function normaliseLevel(s: string | undefined | null): Level {
  if (!s) return 'UNKNOWN';
  return ALIASES[s.toLowerCase()] ?? 'UNKNOWN';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseTime(s: string, year: number): number | null {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = s.replace(',', '.').replace(' ', 'T');
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
    return Number.isNaN(t) ? null : t;
  }
  const m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    if (mi >= 0) return Date.UTC(year, mi, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  }
  return null;
}

const RE_TEXT = /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\]?\s+\[?([A-Za-z]+)\]?\s*(?:\[([^\]]+)\]|([\w.-]+):)?\s*(.*)$/;
const RE_SYSLOG = /^([A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2})\s+\S+\s+([\w./-]+)(?:\[\d+\])?:\s*(.*)$/;

/** Parses one line in a common text, JSON-lines or syslog format. Unrecognised lines are kept as UNKNOWN. */
export function parseLine(raw: string, line: number, year = new Date().getUTCFullYear()): Entry {
  const s = raw.trim();
  if (s.startsWith('{')) {
    try {
      const o = JSON.parse(s) as Record<string, unknown>;
      const tsRaw = (o.time ?? o.timestamp ?? o.ts ?? o['@timestamp']) as string | number | undefined;
      const ts = typeof tsRaw === 'number' ? (tsRaw < 1e12 ? tsRaw * 1000 : tsRaw) : typeof tsRaw === 'string' ? parseTime(tsRaw, year) : null;
      return { line, raw, ts, level: normaliseLevel((o.level ?? o.severity ?? o.lvl) as string), source: ((o.logger ?? o.service ?? o.source) as string) ?? null, message: String(o.msg ?? o.message ?? s) };
    } catch {
      /* fall through */
    }
  }
  let m = s.match(RE_TEXT);
  if (m && normaliseLevel(m[2]) !== 'UNKNOWN') return { line, raw, ts: parseTime(m[1], year), level: normaliseLevel(m[2]), source: m[3] ?? m[4] ?? null, message: m[5] };
  m = s.match(RE_SYSLOG);
  if (m) {
    const lv = m[3].match(/\b(error|warn(?:ing)?|fatal|critical|debug|info)\b/i);
    return { line, raw, ts: parseTime(m[1], year), level: lv ? normaliseLevel(lv[1]) : 'INFO', source: m[2], message: m[3] };
  }
  return { line, raw, ts: null, level: 'UNKNOWN', source: null, message: s };
}

export function parseLog(text: string, year?: number): Entry[] {
  const out: Entry[] = [];
  text.split(/\r?\n/).forEach((l, i) => {
    if (!l.trim()) return;
    // Continuation lines (stack traces) attach to the previous entry.
    if (/^\s+(at |\.\.\.|Caused by)/.test(l) && out.length) {
      out[out.length - 1] = { ...out[out.length - 1], raw: out[out.length - 1].raw + '\n' + l, message: out[out.length - 1].message + '\n' + l.trim() };
      return;
    }
    out.push(parseLine(l, i + 1, year));
  });
  return out;
}

export interface Filters {
  levels: Level[];
  query: string;
  source: string;
  from: number | null;
  to: number | null;
}

export function buildMatcher(query: string): { test: (s: string) => boolean; error: string | null } {
  const q = query.trim();
  if (!q) return { test: () => true, error: null };
  const re = q.match(/^\/(.+)\/([gimsuy]*)$/);
  if (re) {
    try {
      const r = new RegExp(re[1], re[2].replace('g', ''));
      return { test: (s) => r.test(s), error: null };
    } catch (e) {
      return { test: () => false, error: `Invalid pattern: ${(e as Error).message}` };
    }
  }
  const lower = q.toLowerCase();
  return { test: (s) => s.toLowerCase().includes(lower), error: null };
}

export function filterEntries(entries: Entry[], f: Filters) {
  const m = buildMatcher(f.query);
  const list = entries.filter(
    (e) => f.levels.includes(e.level) && (!f.source || e.source === f.source) && (f.from == null || (e.ts != null && e.ts >= f.from)) && (f.to == null || (e.ts != null && e.ts < f.to)) && m.test(e.message + ' ' + (e.source ?? '')),
  );
  return { list, error: m.error };
}

export function countLevels(entries: Entry[]): Record<Level, number> {
  const c = Object.fromEntries(LEVELS.map((l) => [l, 0])) as Record<Level, number>;
  for (const e of entries) c[e.level]++;
  return c;
}

/** Groups similar error messages by replacing numbers, ids and quoted values. */
export function errorGroups(entries: Entry[], top = 6) {
  const map = new Map<string, { sample: Entry; count: number }>();
  for (const e of entries) {
    if (e.level !== 'ERROR' && e.level !== 'FATAL') continue;
    const key = e.message
      .split('\n')[0]
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
      .replace(/"[^"]*"|'[^']*'/g, '<str>')
      .replace(/\b\d+(\.\d+)?\b/g, '<n>');
    const g = map.get(key);
    if (g) g.count++;
    else map.set(key, { sample: e, count: 1 });
  }
  return [...map.entries()].map(([pattern, g]) => ({ pattern, ...g })).sort((a, b) => b.count - a.count).slice(0, top);
}

const STEPS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 3600_000, 86_400_000];

/** Buckets timestamped entries into ~12–60 bars, choosing a sensible step. */
export function timeline(entries: Entry[]) {
  const ts = entries.filter((e) => e.ts != null).map((e) => e.ts!);
  if (ts.length === 0) return null;
  const min = Math.min(...ts), max = Math.max(...ts);
  const step = STEPS.find((s) => (max - min) / s <= 60) ?? 86_400_000;
  const start = Math.floor(min / step) * step;
  const n = Math.max(1, Math.floor((max - start) / step) + 1);
  const buckets = Array.from({ length: n }, (_, i) => ({ from: start + i * step, to: start + (i + 1) * step, counts: Object.fromEntries(LEVELS.map((l) => [l, 0])) as Record<Level, number>, total: 0 }));
  for (const e of entries) {
    if (e.ts == null) continue;
    const b = buckets[Math.floor((e.ts - start) / step)];
    b.counts[e.level]++;
    b.total++;
  }
  return { step, buckets, untimed: entries.length - ts.length };
}
