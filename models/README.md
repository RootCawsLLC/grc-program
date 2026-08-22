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

Two models are included as worked examples rather than a full set. The rest are written one at a
time against real telemetry, in scenario-weight order — see `docs/OPERATING-MODEL.md`.
The staging models they `ref()` are intentionally not stubbed out: writing an empty
`stg_aws_iam_principals.sql` that returns no rows would make `dbt run` succeed while proving
nothing, which is a worse failure than a missing file.
