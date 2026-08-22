-- models/intermediate/control_assertions_unioned.sql
--
-- Every control model's output, every cycle, in one place. variance_events.sql reads this and
-- nothing else, which is what keeps the variance layer from having to know how many control models
-- exist or what any of them are called.
--
-- The rows come from the snapshot table, which the runner appends to once per collection cycle
-- after the controls layer has been built. That append is the entire reason this table has more
-- than one row per subject - and therefore the entire reason a transition into variance is
-- visible at all. A pipeline that overwrote each cycle would produce a perfectly valid-looking
-- version of this model in which passing never changes, and the risk layer would silently report
-- that nothing has ever gone wrong.
--
-- In real dbt this is a `snapshot`. Here it is a plain table written by src/warehouse.mjs, because
-- the runner materialises models as views and needs one durable place for history to accumulate.

select
    as_of,
    control_id,
    subject_id,
    passing,
    reason,
    first_observed,
    account_id
from control_assertions
