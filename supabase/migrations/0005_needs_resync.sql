-- "Needs re-sync": once an item is on Monday, flag it whenever a field that Monday
-- cares about changes (from the phone, the office, anywhere), so the office knows to
-- re-push it. Cleared when the item is (re)synced. Driven by a trigger so it's reliable
-- regardless of which client made the edit.
alter table survey_items add column if not exists needs_resync boolean not null default false;

create or replace function flag_resync() returns trigger language plpgsql as $$
begin
  -- Only synced items can be "out of date" on Monday. The sync itself sets monday_item_id
  -- / stage / needs_resync but doesn't touch the fields below, so it won't self-flag.
  if new.monday_item_id is not null and (
       new.install_status        is distinct from old.install_status or
       new.team_id               is distinct from old.team_id or
       new.rate_override_pennies is distinct from old.rate_override_pennies or
       new.material              is distinct from old.material or
       new.item_type             is distinct from old.item_type or
       new.glass                 is distinct from old.glass or
       new.glazing               is distinct from old.glazing or
       new.width_mm              is distinct from old.width_mm or
       new.height_mm             is distinct from old.height_mm or
       new.comments              is distinct from old.comments or
       new.snag_comment          is distinct from old.snag_comment or
       new.full_code             is distinct from old.full_code
     ) then
    new.needs_resync := true;
  end if;
  return new;
end $$;

drop trigger if exists survey_items_flag_resync on survey_items;
create trigger survey_items_flag_resync before update on survey_items
  for each row execute function flag_resync();
