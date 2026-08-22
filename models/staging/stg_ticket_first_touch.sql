-- models/staging/stg_ticket_first_touch.sql
--
-- The moment a human first touched a failing subject. One row per (control_id, subject_id).
--
-- This is the smallest model in the repo and it carries the most weight, because it is the only
-- thing separating the middle variance segment from the third. Without it,
-- detected -> remediation_started collapses into remediation_started -> completed, prioritisation
-- failures hide inside implementation failures, and "remediate faster" gets aimed at the team that
-- was never the bottleneck.
--
-- DELIBERATELY NOT FILTERED BY var('as_of'). Every other staging model is a point-in-time view of
-- one collection cycle; this one is a ledger. A variance opened in July is closed by a ticket
-- touched in August, and filtering to the current cycle would make the join in variance_events.sql
-- find nothing for exactly the events that have been open longest.

select
    control_id,
    subject_id,

    -- MIN, not the most recent. "First touched" is the first time anyone picked it up; a later
    -- comment or reassignment does not restart the clock.
    min(first_touched_at) as first_touched_at

from {{ source('ticket', 'first_touch') }}
group by control_id, subject_id
