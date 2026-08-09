-- Snags become first-class survey items so they can carry their own labour cost and
-- fitter team and be scheduled/fitted like any other item.
--   kind          = 'item' (a real window/door) or 'snag' (a remedial item)
--   parent_item_id = the original item a snag was raised against
--   snag_comment   = the defect description (also copied into comments for Monday)
alter table survey_items add column if not exists kind text not null default 'item';
alter table survey_items add column if not exists parent_item_id uuid references survey_items(id) on delete cascade;
alter table survey_items add column if not exists snag_comment text;
create index if not exists survey_items_parent_idx on survey_items(parent_item_id);
