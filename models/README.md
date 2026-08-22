# The control test layer

One dbt model per `control_id`. The model is the `query_ref` on the control record, and the
model's `WHERE` clause is the population definition. Those two facts are the whole design.

```
staging/     one model per source system, lightly typed, nothing clever
controls/    one model per control_id  <- the assertions
variance/    the four timestamps       <- the risk layer
```

**Why dbt rather than a script.** Three properties, none of which you get from a cron job:

1. `dbt test` assertions *are* the control tests. `not_null`, `unique`, and custom denominator-stability tests run in the same place as the control logic.
2. dbt lineage *is* the audit trail. "Where did this number come from" is answered by a generated graph rather than by an engineer's memory.
3. Snapshots accumulate history, and history is where Variance Duration comes from. A pipeline that overwrites is a dashboard.

**Warehouse choice is deliberately boring.** DuckDB locally, whatever Reco already runs in
production. Time-indexing is the only hard requirement: the landing layer must be able to answer
"what was true on 14 March", not just "what is true now". If it overwrites, the entire risk layer
is unreachable and the pipeline degrades to an expensive screenshot generator.

Two control models are included as worked examples rather than a full set. The rest are written one
at a time against real telemetry, in scenario-weight order — see `docs/OPERATING-MODEL.md`.

**The staging models are real, and they are not stubs.** `stg_aws_iam_principals.sql` and
`stg_ticket_first_touch.sql` derive their columns from the landing tables in `src/lib/tables.mjs`
and return rows. The distinction that matters: writing an empty `stg_*.sql` that returns nothing so
the build succeeds would make a control look instrumented while proving nothing, which is a worse
failure than a missing file. Running the real models against fixtures that are stamped
`NOT REAL EVIDENCE` proves the pipeline's shape without asserting anything about a real system.
The test of which side of that line you are on is whether any control's `status` changed. None did.

**There is no dbt here, and the models are still dbt models.** `src/warehouse.mjs` runs them
against DuckDB, resolving `ref()`, `source()`, `var()`, `config()` and `is_incremental()` and
refusing anything richer. dbt is Python, and requiring a Python toolchain is where an initiative
like this dies; the machine this was built on has no Python at all. Moving to real dbt against a
real warehouse later is a profile and a dialect pass, not a rewrite.

Run the whole thing with `npm run demo`.
