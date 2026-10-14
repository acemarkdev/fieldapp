-- Production time: two new roles. Own migration so the enum values are committed before 0077 uses
-- them (run this one first, on its own).
--   production          a production worker: logs time on tasks in the phone app, nothing else
--   production_manager  imports the tasks, corrects time entries, sets rates, exports (office app)
alter type user_role add value if not exists 'production';
alter type user_role add value if not exists 'production_manager';
