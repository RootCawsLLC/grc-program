import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Warehouse, render } from '../src/warehouse.mjs';

// ── the dbt shim ─────────────────────────────────────────────────────────────────────────────
// These pin the exact constructs the real model files use. If render() stops resolving one of
// them the models fail at run time with a SQL syntax error, which is a much worse place to find out.

test('render resolves ref, source and var', () => {
  const sql = render(
    "select * from {{ ref('stg_x') }} a join {{ source('aws','org_accounts') }} b on true where a.as_of = '{{ var(\"as_of\") }}'::timestamp",
    { asOf: '2026-08-15T00:00:00Z' },
  );
  assert.match(sql, /from stg_x a/);
  assert.match(sql, /join landing_aws_org_accounts b/);
  assert.match(sql, /'2026-08-15T00:00:00Z'::timestamp/);
});

test('render drops config() — materialisation is the runner\'s decision, not the model\'s', () => {
  const sql = render("{{ config(materialized='incremental', unique_key=['as_of','subject_id']) }}\nselect 1", { asOf: '2026-08-15T00:00:00Z' });
  assert.doesNotMatch(sql, /config/);
  assert.match(sql, /select 1/);
});

test('is_incremental() is false and its guarded block is dropped', () => {
  // Keeping the block would filter out exactly the rows snapshotControls() needs to append.
  const sql = render(
    "select 1 where true\n{% if is_incremental() %}\n  and as_of > (select max(as_of) from x)\n{% endif %}",
    { asOf: '2026-08-15T00:00:00Z' },
  );
  assert.doesNotMatch(sql, /max\(as_of\)/);
  assert.match(sql, /where true/);
});

test('an unsupported dbt expression fails loudly rather than rendering to something surprising', () => {
  assert.throws(
    () => render("select {{ dbt_utils.star(from=ref('x')) }} from y", { asOf: '2026-08-15T00:00:00Z' }),
    /unsupported dbt expression/,
  );
});

test('render refuses to run without an as_of', () => {
  // The runner's wall clock is not an evidence timestamp.
  assert.throws(() => render('select 1', {}), /requires an as_of/);
});

// ── SQL construction ─────────────────────────────────────────────────────────────────────────

test('values reach SQL as bound parameters, not string interpolation', async () => {
  const w = await Warehouse.open(':memory:');
  await w.createTables();
  await w.loadCycle('landing_aws_org_accounts', '2026-08-15T00:00:00Z', [
    // The kind of string that ends a naive query and starts a new one. An IAM principal name is
    // attacker-influencable, so this is not a hypothetical once real collectors are wired.
    { account_id: "1'); drop table landing_aws_org_accounts; --", account_name: "O'Brien", account_status: 'ACTIVE', is_production_org: true },
  ]);
  const rows = await w.all('select account_id, account_name from landing_aws_org_accounts');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account_id, "1'); drop table landing_aws_org_accounts; --");
  assert.equal(rows[0].account_name, "O'Brien");
  await w.close();
});

test('an identifier that is not an allowlisted table is refused', async () => {
  const w = await Warehouse.open(':memory:');
  await w.createTables();
  await assert.rejects(() => w.loadCycle('landing_aws_org_accounts; drop table x', '2026-08-15T00:00:00Z', []), /unknown landing table/);
  await assert.rejects(() => w.insertRows('bad name', ['a'], [{ a: 1 }]), /unsafe table name/);
  await assert.rejects(() => w.insertRows('landing_aws_org_accounts', ['a; drop'], [{ a: 1 }]), /unsafe column name/);
  await w.close();
});

// ── time indexing ────────────────────────────────────────────────────────────────────────────

test('landing is append-only across cycles and idempotent within one', async () => {
  const w = await Warehouse.open(':memory:');
  await w.createTables();
  const row = (id) => ({ account_id: id, account_name: 'n', account_status: 'ACTIVE', is_production_org: true });

  await w.loadCycle('landing_aws_org_accounts', '2026-06-15T00:00:00Z', [row('a')]);
  await w.loadCycle('landing_aws_org_accounts', '2026-07-15T00:00:00Z', [row('a')]);
  assert.equal((await w.all('select count(*) as n from landing_aws_org_accounts'))[0].n, 2, 'the second cycle must not overwrite the first');

  // Re-running one cycle replaces only that cycle — so a demo is deterministic without the run
  // destroying history. Deleting the whole table here is the single change that would turn this
  // pipeline back into a dashboard.
  await w.loadCycle('landing_aws_org_accounts', '2026-07-15T00:00:00Z', [row('a'), row('b')]);
  assert.equal((await w.all('select count(*) as n from landing_aws_org_accounts'))[0].n, 3);
  assert.equal((await w.all("select count(*) as n from landing_aws_org_accounts where as_of = '2026-06-15T00:00:00Z'::timestamp"))[0].n, 1);
  await w.close();
});

test('the landing layer can answer what was true on a past date', async () => {
  // If it cannot, the entire variance layer is unreachable and this is an expensive screenshot.
  const w = await Warehouse.open(':memory:');
  await w.createTables();
  await w.loadCycle('landing_aws_org_accounts', '2026-06-15T00:00:00Z', [{ account_id: 'a', account_name: 'n', account_status: 'ACTIVE', is_production_org: false }]);
  await w.loadCycle('landing_aws_org_accounts', '2026-07-15T00:00:00Z', [{ account_id: 'a', account_name: 'n', account_status: 'ACTIVE', is_production_org: true }]);

  const past = await w.all("select is_production_org from landing_aws_org_accounts where as_of = '2026-06-15T00:00:00Z'::timestamp");
  assert.equal(past[0].is_production_org, false, 'the historical row must survive the later cycle unchanged');
  await w.close();
});

// ── the one interpolated value ───────────────────────────────────────────────────────────────

test('as_of is validated before interpolation — it is the only value not bound', () => {
  // A placeholder cannot survive being substituted into model text before the statement is
  // prepared, so as_of is checked instead. Without this the string below is a working exploit
  // against the snapshot table once as_of comes from a scheduler rather than a repo file.
  assert.throws(
    () => render("select 1 where as_of = '{{ var(\"as_of\") }}'::timestamp", { asOf: "2026-01-01T00:00:00Z'; drop table control_assertions; --" }),
    /must be an ISO-8601 UTC timestamp/,
  );
  assert.throws(() => render('select 1', { asOf: '2026-08-15' }), /ISO-8601/);
  assert.throws(() => render('select 1', { asOf: '2026-08-15T00:00:00+04:00' }), /ISO-8601/);

  // and the shapes that must keep working
  assert.doesNotThrow(() => render('select 1', { asOf: '2026-08-15T00:00:00Z' }));
  assert.doesNotThrow(() => render('select 1', { asOf: '2026-08-15T00:00:00.123Z' }));
});
