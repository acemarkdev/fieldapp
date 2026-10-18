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
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private filters: { col: string; val: any }[] = [];
  private preds: ((r: Row) => boolean)[] = [];   // .not / .is / .in
  private rels: string[] = [];                    // embedded relations in select("…, jobs(code,name)")
  private orderCol: string | null = null;
  private orderAsc = true;
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
    return this.tbl().filter((r) => this.filters.every((f) => r[f.col] === f.val) && this.preds.every((p) => p(r)));
  }

  select(cols?: string) {
    this.wantSelect = true;
    for (const m of String(cols ?? '').matchAll(/(\w+)\(/g)) this.rels.push(m[1]);
    return this;
  }
  eq(col: string, val: any) { this.filters.push({ col, val }); return this; }
  not(col: string, op: string, val: any) { if (op === 'is' && val === null) this.preds.push((r) => r[col] != null); else this.preds.push((r) => r[col] !== val); return this; }
  is(col: string, val: any) { this.preds.push((r) => (val === null ? r[col] == null : r[col] === val)); return this; }
  in(col: string, vals: any[]) { this.preds.push((r) => vals.includes(r[col])); return this; }
  delete() { this.op = 'delete'; return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orderCol = col; this.orderAsc = opts?.ascending !== false; return this; }
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
    if (this.op === 'delete') {
      const hits = new Set(this.matched());
      const db = demoDb as any; db[this.table] = this.tbl().filter((r) => !hits.has(r));
      return { data: null, error: null };
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
      const dir = this.orderAsc ? 1 : -1;
      rows = rows.slice().sort((a, b) => (a[c] > b[c] ? dir : a[c] < b[c] ? -dir : 0));
    }
    // embedded relation, e.g. survey_items → jobs(...) through job_id
    if (this.rels.length) {
      const db = demoDb as any;
      rows = rows.map((r) => { const x = { ...r }; for (const rel of this.rels) { const fk = rel.replace(/s$/, '') + '_id'; x[rel] = (db[rel] ?? []).find((t: Row) => t.id === r[fk]) ?? null; } return x; });
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
  rpc(name: string, args?: any) { return Promise.resolve(demoRpc(name, args ?? {})); },
};

// The production-time functions, played out on the demo data (the demo user is the worker).
export function demoRpc(name: string, a: any): Result {
  const db = demoDb as any, me = 'demo-user', now = new Date().toISOString();
  const entries: Row[] = db.time_entries ?? (db.time_entries = []);
  const stopRunning = () => entries.filter((e) => e.user_id === me && !e.ended_at).forEach((e) => { e.ended_at = now; });
  if (name === 'prod_start') {
    const t = (db.prod_tasks ?? []).find((x: Row) => x.id === a.p_task && x.active);
    if (!t) return { data: null, error: { message: 'Task not found.' } };
    stopRunning();
    const id = genId('time');
    entries.push({ id, user_id: me, task_id: t.id, task_name: t.export_name, job_key: t.job_key, started_at: now, ended_at: null, note: null });
    return { data: id, error: null };
  }
  if (name === 'prod_stop') { stopRunning(); return { data: 1, error: null }; }
  if (name === 'prod_edit_entry') {
    const e = entries.find((x) => x.id === a.p_entry);
    if (!e) return { data: null, error: { message: 'Entry not found.' } };
    Object.assign(e, { started_at: a.p_start, ended_at: a.p_end ?? null, note: (String(a.p_note ?? '').trim() || null) });
    return { data: null, error: null };
  }
  return { data: null, error: null };
}
