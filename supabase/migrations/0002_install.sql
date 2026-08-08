-- Install / completion: record the actual install date on the item.
alter table survey_items add column if not exists actual_install_date date;
