/**
 * A stand-in Supabase client for testing the functions' data layer.
 *
 * The Edge Functions take `db` as a parameter rather than reaching for a
 * module-level client, which is what makes them testable without a database.
 * This supplies canned rows per table and records every query, so a test can
 * assert both what came back and what was asked for — a filter silently
 * dropped is the kind of bug that only shows up as wrong data much later.
 *
 * It is not a database. It does not evaluate filters, and it does not enforce
 * constraints; RLS and unique indexes are the database's job and only a live
 * run proves those. What it proves is the code's own reasoning: which tables it
 * reads, what it asks of them, and what it derives from the answers.
 */

export interface Recorded {
  table: string;
  schema?: string;
  select?: string;
  /** Filters in the order they were applied, as `method:column=value`. */
  filters: string[];
  /** Rows handed to insert, update or upsert. */
  payload?: unknown;
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
}

type Rows = Record<string, unknown[]>;

export interface StubDb {
  from(table: string): Builder;
  schema(name: string): { from(table: string): Builder };
  /** Every query this client received, oldest first. */
  calls: Recorded[];
  /** Queries against one table, for a focused assertion. */
  callsTo(table: string): Recorded[];
}

class Builder implements PromiseLike<{ data: unknown; error: null }> {
  /** Set by `single()` / `maybeSingle()`: resolve to one row, not a list. */
  private one = false;
  private rows: unknown[];
  // Written out rather than declared as constructor parameters: Node's
  // strip-only type stripping, which runs these tests, does not support them.
  private record: Recorded;

  constructor(record: Recorded, rows: unknown[]) {
    this.record = record;
    this.rows = rows;
  }

  select(select?: string) {
    this.record.select = select;
    return this;
  }

  eq(column: string, value: unknown) {
    this.record.filters.push(`eq:${column}=${String(value)}`);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.record.filters.push(`in:${column}=${values.join(',')}`);
    return this;
  }

  not(column: string, op: string, value: unknown) {
    this.record.filters.push(`not:${column} ${op} ${String(value)}`);
    return this;
  }

  gte(column: string, value: unknown) {
    this.record.filters.push(`gte:${column}=${String(value)}`);
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.record.filters.push(`order:${column}=${opts?.ascending === false ? 'desc' : 'asc'}`);
    return this;
  }

  limit(n: number) {
    this.record.filters.push(`limit:${n}`);
    return this;
  }

  maybeSingle() {
    this.one = true;
    return this;
  }

  /** Like `maybeSingle`, but the caller treats an empty result as an error. */
  single() {
    this.one = true;
    return this;
  }

  insert(payload: unknown) {
    this.record.op = 'insert';
    this.record.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.record.op = 'update';
    this.record.payload = payload;
    return this;
  }

  upsert(payload: unknown) {
    this.record.op = 'upsert';
    this.record.payload = payload;
    return this;
  }

  delete() {
    this.record.op = 'delete';
    return this;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const data = this.one ? (this.rows[0] ?? null) : this.rows;
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

/**
 * `rows` maps table name to the rows that table returns. A table with no entry
 * returns an empty list, which is what an athlete with no history looks like.
 */
export function stubDb(rows: Rows = {}): StubDb {
  const calls: Recorded[] = [];

  const make = (table: string, schema?: string) => {
    const record: Recorded = { table, schema, filters: [], op: 'select' };
    calls.push(record);
    return new Builder(record, rows[table] ?? []);
  };

  return {
    from: (table: string) => make(table),
    schema: (name: string) => ({ from: (table: string) => make(table, name) }),
    calls,
    callsTo: (table: string) => calls.filter(c => c.table === table),
  };
}

