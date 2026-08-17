// Minimal Monday.com GraphQL client for the Sync API.
// The token is read from the server environment — it never ships to a client.

const MONDAY_URL = 'https://api.monday.com/v2';

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
      const pageData = cursor ? d.next_items_page : d.boards?.[0]?.items_page;
      const items = pageData?.items ?? [];
      for (const i of items) out.push({ id: i.id, name: i.name, text: i.column_values?.[0]?.text ?? null });
      cursor = pageData?.cursor ?? null;
      if (!cursor || items.length === 0) break;
    }
    return out;
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
    form.append('variables[file]', new Blob([bytes], { type: contentType }), fileName);
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
