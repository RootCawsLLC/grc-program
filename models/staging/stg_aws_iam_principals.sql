-- models/staging/stg_aws_iam_principals.sql
--
-- Lightly typed, nothing clever. Landing mirrors what AWS returns; this is where the shape becomes
-- ours. Every derivation below is a naming or typing decision, not a control decision - the control
-- logic and the population definition both live in models/controls/, and moving any of it up here
-- would hide it somewhere nobody thinks to look.
--
-- Two derivations are judgement calls and are called out where they are made: the root account's
-- console access, and principal_status.

select
    cr.as_of,
    cr.account_id,
    cr.user_name                                             as principal_name,
    cr.mfa_active,

    (cr.access_key_1_active or cr.access_key_2_active)       as has_long_lived_key,
    (cr.user_name = '<root_account>')                        as is_root,

    -- Source timestamps, carried through untouched. These are what let the control model report
    -- first_observed at source-timestamp quality instead of the interpolation everyone settles for.
    cr.access_key_1_last_rotated,
    cr.user_creation_time                                    as principal_created_at,

    coalesce(acct.is_production_org, false)                   as is_production_org,

    -- JUDGEMENT CALL 1. The IAM credential report emits password_enabled = 'not_supported' for the
    -- root account rather than 'true', because root's console password is not an IAM-managed
    -- credential. Read literally that would drop root out of the population - the one principal
    -- that most needs to be in it. Root always has console access; that is what root is.
    ((cr.password_enabled = 'true') or cr.user_name = '<root_account>')
                                                             as can_authenticate_interactively,

    -- JUDGEMENT CALL 2. The credential report has no per-principal status column: a principal
    -- either appears in the report or does not exist. The only status that can suspend a principal
    -- wholesale is the account's, so it is inherited. If a real IdP-backed status ever lands, this
    -- is the line that changes.
    case when coalesce(acct.account_status, 'ACTIVE') = 'ACTIVE' then 'active' else 'suspended' end
                                                             as principal_status

from {{ source('aws', 'credential_report') }} cr

-- as_of on BOTH sides. Joining an old credential report to today's account list would silently
-- reclassify historical rows as production, and the variance layer would report a transition that
-- never happened.
left join {{ source('aws', 'org_accounts') }} acct
       on acct.account_id = cr.account_id
      and acct.as_of      = cr.as_of

where cr.as_of = '{{ var("as_of") }}'::timestamp
