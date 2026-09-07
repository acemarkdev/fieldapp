// In-memory stand-in for the Supabase client, used only in DEMO mode. It implements exactly
// the query surface the mobile screens use: from(table).select/eq/order/limit/single/maybeSingle,
// insert, update, plus a storage shim and no-op auth. No React Native imports so it is unit-testable.
//
// Data lives in `demoDb` and is reseeded by resetDemoDb() on every demo start; nothing is persisted.

import { seedDemoDb, type DemoDb } from './demoData';

export let demoDb: DemoDb = seedDemoDb();
export function resetDemoDb(): void { demoDb = seedDemoDb(); }

type Row = Record<string, any>;
type Result = { data: any; error: any };

let idSeq = 1;
const genId = (t: string) => `demo-${t}-${Date.now()}-${idSeq++}`;

class DemoQuery implements PromiseLike<Result> {
  private table: string;
  private op: 'select' | 'insert' | 'update' = 'select';
  private filters: { col: string; val: any }[] = [];
  private orderCol: string | null = null;
  private limitN: number | null = null;
  private _single: 'one' | 'maybe' | null = null;
  private rows: Row[] = [];      // for insert
  private patch: Row = {};       // for update
  private wantSelect = false;    // .select() after insert/update

  constructor(table: string) { this.table = table; }

  private tbl(): Row[] {
    const db = demoDb as any;
    if (!db[this.table]) db[this.table] = [];
    return db[this.table] as Row[];
  }
  private matched(): Row[] {
    return this.tbl().filter((r) => this.filters.every((f) => r[f.col] === f.val));
  }

  select(_cols?: string) { this.wantSelect = true; return this; }
  eq(col: string, val: any) { this.filters.push({ col, val }); return this; }
  order(col: string) { this.orderCol = col; return this; }
  limit(n: number) { this.limitN = n; return this; }
  single() { this._single = 'one'; return this; }
  maybeSingle() { this._single = 'maybe'; return this; }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch: Row) { this.op = 'update'; this.patch = patch; return this; }

  private run(): Result {
    if (this.op === 'insert') {
      const created = this.rows.map((r) => {
        const row: Row = { id: r.id ?? genId(this.table), created_at: r.created_at ?? new Date().toISOString(), ...r };
        this.tbl().push(row);
        return row;
      });
      if (!this.wantSelect) return { data: null, error: null };
      return { data: this._single ? (created[0] ?? null) : created, error: null };
    }
    if (this.op === 'update') {
      const hits = this.matched();
      hits.forEach((r) => Object.assign(r, this.patch));
      if (!this.wantSelect) return { data: null, error: null };
      return { data: this._single ? (hits[0] ?? null) : hits, error: null };
    }
    // select
    let rows = this.matched();
    if (this.orderCol) {
      const c = this.orderCol;
      rows = rows.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0));
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    if (this._single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  then<TR = Result, TE = never>(
    onF?: ((v: Result) => TR | PromiseLike<TR>) | null,
    onR?: ((reason: any) => TE | PromiseLike<TE>) | null,
  ): PromiseLike<TR | TE> {
    try { return Promise.resolve(this.run()).then(onF, onR); }
    catch (e) { return Promise.resolve({ data: null, error: { message: String(e) } } as Result).then(onF, onR); }
  }
}

const demoStorage = {
  from(_bucket: string) {
    return {
      // Seeded storage_path values are already full image URLs, so return them as-is.
      async createSignedUrl(path: string, _seconds?: number) { return { data: { signedUrl: path }, error: null }; },
      async upload(path: string, _data: any, _opts?: any) { return { data: { path }, error: null }; },
      async download(_path: string) { return { data: null, error: { message: 'download disabled in demo' } }; },
    };
  },
};

const demoAuth = {
  async getSession() { return { data: { session: null }, error: null }; },
  onAuthStateChange(_cb: any) { return { data: { subscription: { unsubscribe() {} } } }; },
  async signInWithPassword() { return { data: { session: null, user: null }, error: { message: 'Demo mode' } }; },
  async signInWithOAuth() { return { data: null, error: { message: 'Demo mode' } }; },
  async exchangeCodeForSession() { return { data: null, error: { message: 'Demo mode' } }; },
  async setSession() { return { data: null, error: { message: 'Demo mode' } }; },
  async signOut() { return { error: null }; },
};

export const demoClient: any = {
  from(table: string) { return new DemoQuery(table); },
  storage: demoStorage,
  auth: demoAuth,
  rpc(_name: string, _args?: any) { return Promise.resolve({ data: null, error: null }); },
};
