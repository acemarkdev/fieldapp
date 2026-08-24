-- Global (per-tenant) setting: may an item be pinned on more than one plan?
-- Default false = one plan per item (an item pinned on Plan A is shown as already placed
-- and isn't offered for placing on Plan B; unpin first to move it). Set true to allow the
-- looser behaviour, e.g. keeping the same item across plan versions.
alter table tenants add column if not exists pins_multi_plan boolean not null default false;
