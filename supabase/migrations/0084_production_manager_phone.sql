-- ============================================================
--  Production manager on the phone: the role 'production_manager' can sign in to the FitAWindow
--  app and log time exactly like a production worker (time screen only). In the database that
--  means the same three exceptions 0077 made for 'production': its own user row (the app loads
--  the role from it), the tasks, and its own time entries. Every other table stays blocked for
--  the role, and starting / stopping / correcting time still goes only through prod_start,
--  prod_stop and prod_edit_entry (which already accept this role). The office pages are
--  unchanged: they run on the server.
-- ============================================================
drop policy if exists app_users_block_production_manager on app_users;
drop policy if exists prod_tasks_block_production_manager on prod_tasks;
drop policy if exists time_entries_block_production_manager on time_entries;
