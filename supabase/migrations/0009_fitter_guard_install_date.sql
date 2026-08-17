-- Fix: a fitter marking an item "Installed" also stamps the install date
-- (actual_install_date), which the fitter guard wasn't allowing — so the save was
-- rejected with "fitters may only update the install status". Add actual_install_date
-- (and after_photo_path, set on completion) to the columns a fitter may change.
create or replace function guard_fitter_item_update() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth_role() = 'fitter' then
    if (to_jsonb(new)
          - 'install_status' - 'actual_install_date' - 'after_photo_path'
          - 'updated_at' - 'needs_resync' - 'monday_item_id')
       is distinct from
       (to_jsonb(old)
          - 'install_status' - 'actual_install_date' - 'after_photo_path'
          - 'updated_at' - 'needs_resync' - 'monday_item_id')
    then
      raise exception 'Fitters may only update the install status, not the item specification';
    end if;
  end if;
  return new;
end $$;
