/**
 * A small in-memory stand-in for the Supabase client, for server modules whose queries are plain
 * filters (select … eq/is/in … order/limit/range … maybeSingle/single), inserts and rpc calls.
 * Every query returns whole rows whatever columns it selected (a superset is fine for the code
 * under test). `rpc` records its calls and answers nothing, so a test can assert what was saved.
 */
export type FakeRow = Record<string, unknown>;

export interface FakeDb {
  from(table: string): unknown;
  rpc(name: string, args: unknown): Promise<{ data: unknown; error: null }>;
  /** Every rpc call, in order. */
  rpcCalls: Array<{ name: string; args: unknown }>;
  tables: Record<string, FakeRow[]>;
}

export function fakeDb(tables: Record<string, FakeRow[]>, rpcAnswers: Record<string, (args: unknown) => unknown> = {}): FakeDb {
  const rpcCalls: FakeDb["rpcCalls"] = [];
  function from(table: string) {
    const rows = () => (tables[table] ??= []);
    const filters: Array<(r: FakeRow) => boolean> = [];
    let order: { key: string; ascending: boolean } | null = null;
    let range: [number, number] | null = null;
    let limit: number | null = null;
    let one: "maybe" | "single" | null = null;
    let inserted: FakeRow[] | null = null;
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      is: (k: string, v: unknown) => (filters.push((r) => r[k] === v || (v === null && r[k] === undefined)), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
      order: (k: string, o?: { ascending?: boolean }) => ((order ??= { key: k, ascending: o?.ascending ?? true }), q),
      limit: (n: number) => ((limit = n), q),
      range: (a: number, b: number) => ((range = [a, b]), q),
      maybeSingle: () => ((one = "maybe"), q),
      single: () => ((one = "single"), q),
      insert: (value: FakeRow | FakeRow[]) => {
        inserted = Array.isArray(value) ? value : [value];
        rows().push(...inserted);
        return q;
      },
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => {
        let hit = inserted ?? rows().filter((r) => filters.every((f) => f(r)));
        if (order) {
          const { key, ascending } = order;
          hit = [...hit].sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0) * (ascending ? 1 : -1));
        }
        if (range) hit = hit.slice(range[0], range[1] + 1);
        if (limit !== null) hit = hit.slice(0, limit);
        const result = one === "maybe" ? { data: hit[0] ?? null, error: null } : one === "single" ? (hit[0] ? { data: hit[0], error: null } : { data: null, error: { message: "no rows" } }) : { data: hit, error: null };
        return Promise.resolve(result).then(ok, fail);
      },
    };
    return q;
  }
  return {
    from,
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: rpcAnswers[name]?.(args) ?? null, error: null };
    },
    rpcCalls,
    tables,
  };
}
