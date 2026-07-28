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

  async createItem(boardId: string, name: string, columnValues: Record<string, unknown>): Promise<string> {
    const d = await this.gql<{ create_item: { id: string } }>(
      `mutation ($b: ID!, $n: String!, $cv: JSON!) {
         create_item(board_id: $b, item_name: $n, column_values: $cv, create_labels_if_missing: false) { id }
       }`,
      { b: boardId, n: name, cv: JSON.stringify(columnValues) },
    );
    return d.create_item.id;
  }

  async changeColumnValues(boardId: string, itemId: string, columnValues: Record<string, unknown>): Promise<void> {
    await this.gql(
      `mutation ($b: ID!, $i: ID!, $cv: JSON!) {
         change_multiple_column_values(board_id: $b, item_id: $i, column_values: $cv) { id }
       }`,
      { b: boardId, i: itemId, cv: JSON.stringify(columnValues) },
    );
  }
}
