// Minimal Monday.com GraphQL client for the Sync API.
// The token is read from the server environment — it never ships to a client.

// Overridable so tests can point the client at a fake server.
const MONDAY_URL = process.env.MONDAY_API_URL ?? 'https://api.monday.com/v2';

export interface MondayColumn {
  id: string;
  title: string;
  type: string;
  settings: any;
}

export class Monday {
  private token: string;
  constructor(token = process.env.MONDAY_API_TOKEN ?? '') {
    if (!token) throw new Error('MONDAY_API_TOKEN is not set (server environment only).');
    this.token = token;
  }

  async gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(MONDAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.token,
        'API-Version': '2024-10',
      },
      body: JSON.stringify({ query, variables }),
    });
    const json: any = await res.json();
    if (json.errors) throw new Error('Monday API error: ' + JSON.stringify(json.errors));
    return json.data as T;
  }

  /** The token's Monday account slug (e.g. "ace189144") — the subdomain in board/item URLs. */
  async getAccountSlug(): Promise<string | null> {
    const d = await this.gql<{ account: { slug: string | null } }>(`query { account { slug } }`);
    return d.account?.slug ?? null;
  }

  /** Board columns, with settings parsed — used to match survey fields by title. */
  async getColumns(boardId: string): Promise<MondayColumn[]> {
    const d = await this.gql<{ boards: { columns: any[] }[] }>(
      `query ($b: [ID!]) { boards(ids: $b) { columns { id title type settings_str } } }`,
      { b: [boardId] },
    );
    return (d.boards?.[0]?.columns ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
      settings: c.settings_str ? JSON.parse(c.settings_str) : {},
    }));
  }

  /** Idempotency: find an existing item on the board by its (exact) name = full code.
   *  Scans the board and matches in JS — robust across Monday schema versions.
   *  (In production we store monday_item_id after the first create, so this is only a fallback.) */
  async findItemIdByName(boardId: string, name: string): Promise<string | null> {
    const d = await this.gql<{ boards: { items_page: { items: { id: string; name: string }[] } }[] }>(
      `query ($b: [ID!]) { boards(ids: $b) { items_page(limit: 500) { items { id name } } } }`,
      { b: [boardId] },
    );
    const items = d.boards?.[0]?.items_page?.items ?? [];
    const hit = items.find((i) => i.name === name);
    return hit ? hit.id : null;
  }

  /** Read one column's text for every item on a board (paged). Used to pull the Fitters
   *  (team) assignment back from Monday. Returns each item's id, name (= full code) and the
   *  column's display text (e.g. "Team P01"), or null when unset. */
  async getColumnTextForItems(boardId: string, columnId: string): Promise<{ id: string; name: string; text: string | null }[]> {
    const out: { id: string; name: string; text: string | null }[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
      const d: any = cursor
        ? await this.gql(
            `query ($c: String!, $col: [String!]) { next_items_page(cursor: $c, limit: 200) { cursor items { id name column_values(ids: $col) { text } } } }`,
            { c: cursor, col: [columnId] },
          )
        : await this.gql(
            `query ($b: [ID!], $col: [String!]) { boards(ids: $b) { items_page(limit: 200) { cursor items { id name column_values(ids: $col) { text } } } } }`,
            { b: [boardId], col: [columnId] },
          );
      const pageData: any = cursor ? d.next_items_page : d.boards?.[0]?.items_page;
      const items = pageData?.items ?? [];
      for (const i of items) out.push({ id: i.id, name: i.name, text: i.column_values?.[0]?.text ?? null });
      cursor = pageData?.cursor ?? null;
      if (!cursor || items.length === 0) break;
    }
    return out;
  }

  /** Every item's id, name and group title on a board (paged). Used to derive cost centres
   *  from the Enquiries board names ("EQ - L2025 17525 - <description>"). */
  async listItemNames(boardId: string): Promise<{ id: string; name: string; group: string | null }[]> {
    const out: { id: string; name: string; group: string | null }[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 60; page++) {
      const d: any = cursor
        ? await this.gql(`query ($c: String!) { next_items_page(cursor: $c, limit: 250) { cursor items { id name group { title } } } }`, { c: cursor })
        : await this.gql(`query ($b: [ID!]) { boards(ids: $b) { items_page(limit: 250) { cursor items { id name group { title } } } } }`, { b: [boardId] });
      const pageData: any = cursor ? d.next_items_page : d.boards?.[0]?.items_page;
      const items = pageData?.items ?? [];
      for (const i of items) out.push({ id: i.id, name: i.name, group: i.group?.title ?? null });
      cursor = pageData?.cursor ?? null;
      if (!cursor || items.length === 0) break;
    }
    return out;
  }

  /** Every item's id, name and the text of the given columns (paged). Used to import
   *  the Approved Suppliers board (name + contact/email/phone). */
  async listItemsWithColumnText(boardId: string, columnIds: string[]): Promise<{ id: string; name: string; cols: Record<string, string | null> }[]> {
    const out: { id: string; name: string; cols: Record<string, string | null> }[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 40; page++) {
      const d: any = cursor
        ? await this.gql(`query ($c: String!, $col: [String!]) { next_items_page(cursor: $c, limit: 200) { cursor items { id name column_values(ids: $col) { id text } } } }`, { c: cursor, col: columnIds })
        : await this.gql(`query ($b: [ID!], $col: [String!]) { boards(ids: $b) { items_page(limit: 200) { cursor items { id name column_values(ids: $col) { id text } } } } }`, { b: [boardId], col: columnIds });
      const pageData: any = cursor ? d.next_items_page : d.boards?.[0]?.items_page;
      const items = pageData?.items ?? [];
      for (const i of items) { const cols: Record<string, string | null> = {}; for (const cv of (i.column_values ?? [])) cols[cv.id] = cv.text ?? null; out.push({ id: i.id, name: i.name, cols }); }
      cursor = pageData?.cursor ?? null;
      if (!cursor || items.length === 0) break;
    }
    return out;
  }

  /** Every item with its group, last-updated time and the text of the given columns (500 per page).
   *  Used by the Fin&Ops cost sync (thousands of invoices). */
  async listItemsDetailed(boardId: string, columnIds: string[], onProgress?: (n: number) => void): Promise<{ id: string; name: string; group: string | null; updated_at: string | null; cols: Record<string, string | null> }[]> {
    const out: { id: string; name: string; group: string | null; updated_at: string | null; cols: Record<string, string | null> }[] = [];
    const fields = `cursor items { id name updated_at group { title } column_values(ids: $col) { id text } }`;
    let cursor: string | null = null;
    for (let page = 0; page < 200; page++) {
      const d: any = cursor
        ? await this.gqlRetry(`query ($c: String!, $col: [String!]) { next_items_page(cursor: $c, limit: 500) { ${fields} } }`, { c: cursor, col: columnIds })
        : await this.gqlRetry(`query ($b: [ID!], $col: [String!]) { boards(ids: $b) { items_page(limit: 500) { ${fields} } } }`, { b: [boardId], col: columnIds });
      const pageData: any = cursor ? d.next_items_page : d.boards?.[0]?.items_page;
      const items = pageData?.items ?? [];
      for (const i of items) { const cols: Record<string, string | null> = {}; for (const cv of (i.column_values ?? [])) cols[cv.id] = cv.text ?? null; out.push({ id: i.id, name: i.name, group: i.group?.title ?? null, updated_at: i.updated_at ?? null, cols }); }
      onProgress?.(out.length);
      cursor = pageData?.cursor ?? null;
      if (!cursor || items.length === 0) break;
    }
    return out;
  }

  /** The board's groups (on the invoices board: one per month). */
  async listGroups(boardId: string): Promise<{ id: string; title: string }[]> {
    const d: any = await this.gqlRetry(`query ($b: [ID!]) { boards(ids: $b) { groups { id title } } }`, { b: [boardId] });
    return d.boards?.[0]?.groups ?? [];
  }

  /** Like listItemsDetailed, but only the items of one group. */
  async listGroupItemsDetailed(boardId: string, groupId: string, columnIds: string[]): Promise<{ id: string; name: string; group: string | null; updated_at: string | null; cols: Record<string, string | null> }[]> {
    const out: { id: string; name: string; group: string | null; updated_at: string | null; cols: Record<string, string | null> }[] = [];
    const fields = `cursor items { id name updated_at group { title } column_values(ids: $col) { id text } }`;
    let cursor: string | null = null;
    for (let page = 0; page < 200; page++) {
      const d: any = cursor
        ? await this.gqlRetry(`query ($c: String!, $col: [String!]) { next_items_page(cursor: $c, limit: 500) { ${fields} } }`, { c: cursor, col: columnIds })
        : await this.gqlRetry(`query ($b: [ID!], $g: [String], $col: [String!]) { boards(ids: $b) { groups(ids: $g) { items_page(limit: 500) { ${fields} } } } }`, { b: [boardId], g: [groupId], col: columnIds });
      const pageData: any = cursor ? d.next_items_page : d.boards?.[0]?.groups?.[0]?.items_page;
      const items = pageData?.items ?? [];
      for (const i of items) { const cols: Record<string, string | null> = {}; for (const cv of (i.column_values ?? [])) cols[cv.id] = cv.text ?? null; out.push({ id: i.id, name: i.name, group: i.group?.title ?? null, updated_at: i.updated_at ?? null, cols }); }
      cursor = pageData?.cursor ?? null;
      if (!cursor || items.length === 0) break;
    }
    return out;
  }

  /** Set one text column on many items in a single request (aliased mutations). Keep batches small (≤ 25). */
  async setTextColumnBatch(boardId: string, columnId: string, pairs: { itemId: string; value: string }[]): Promise<void> {
    if (!pairs.length) return;
    if (!/^\d+$/.test(boardId) || pairs.some((p) => !/^\d+$/.test(p.itemId))) throw new Error('Invalid monday id.');
    const body = pairs.map((p, i) => `m${i}: change_simple_column_value(board_id: ${boardId}, item_id: ${p.itemId}, column_id: ${JSON.stringify(columnId)}, value: ${JSON.stringify(p.value)}) { id }`).join('\n');
    await this.gqlRetry(`mutation { ${body} }`);
  }

  /** gql() that waits and retries when monday rate-limits (complexity budget / too many requests). */
  gqlRetry<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return withMondayRetry(() => this.gql<T>(query, variables));
  }

  async createItem(boardId: string, name: string, columnValues: Record<string, unknown>): Promise<string> {
    const d = await this.gql<{ create_item: { id: string } }>(
      `mutation ($b: ID!, $n: String!, $cv: JSON!) {
         create_item(board_id: $b, item_name: $n, column_values: $cv, create_labels_if_missing: false) { id }
       }`,
      { b: boardId, n: name, cv: JSON.stringify(columnValues) },
    );
    return d.create_item.id;
  }

  /** Create a new column on a board (used to auto-provision required columns on link). */
  async createColumn(boardId: string, title: string, columnType: string): Promise<string> {
    const d = await this.gql<{ create_column: { id: string } }>(
      `mutation ($b: ID!, $t: String!, $ct: ColumnType!) {
         create_column(board_id: $b, title: $t, column_type: $ct) { id }
       }`,
      { b: boardId, t: title, ct: columnType },
    );
    return d.create_column.id;
  }

  /** Duplicate an item on the same board (used for snags); returns the new item id. */
  async duplicateItem(boardId: string, itemId: string, withUpdates = false): Promise<string> {
    const d = await this.gql<{ duplicate_item: { id: string } }>(
      `mutation ($b: ID!, $i: ID!, $u: Boolean) {
         duplicate_item(board_id: $b, item_id: $i, with_updates: $u) { id }
       }`,
      { b: boardId, i: itemId, u: withUpdates },
    );
    return d.duplicate_item.id;
  }

  async changeColumnValues(boardId: string, itemId: string, columnValues: Record<string, unknown>): Promise<void> {
    await this.gql(
      `mutation ($b: ID!, $i: ID!, $cv: JSON!) {
         change_multiple_column_values(board_id: $b, item_id: $i, column_values: $cv) { id }
       }`,
      { b: boardId, i: itemId, cv: JSON.stringify(columnValues) },
    );
  }

  /** Upload a file into a file column (e.g. Design Sketch). Uses Monday's multipart file endpoint. */
  async addFileToColumn(itemId: string, columnId: string, bytes: Uint8Array, fileName: string, contentType = 'image/png'): Promise<string> {
    const form = new FormData();
    form.append('query',
      `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) { id } }`);
    form.append('variables[file]', new Blob([bytes as BlobPart], { type: contentType }), fileName);
    const res = await fetch('https://api.monday.com/v2/file', {
      method: 'POST',
      headers: { Authorization: this.token },
      body: form,
    });
    const json: any = await res.json();
    if (json.errors) throw new Error('Monday file upload error: ' + JSON.stringify(json.errors));
    return json.data.add_file_to_column.id;
  }
}

/** Run a monday call, waiting and retrying when monday rate-limits it (complexity budget, 429, dropped connection). */
export async function withMondayRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (e: any) {
      const msg = String(e?.message ?? e);
      const limited = /complexity|rate.?limit|too many|budget exhausted|429|ECONNRESET|fetch failed/i.test(msg);
      if (!limited || attempt >= 6) throw e;
      const secs = Number(/reset in (\d+) seconds/i.exec(msg)?.[1] ?? 0) || 10 * (attempt + 1);
      await new Promise((r) => setTimeout(r, Math.min(60, secs + 1) * 1000));
    }
  }
}
