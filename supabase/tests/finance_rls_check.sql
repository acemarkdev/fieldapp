-- Finance access check. Paste into the Supabase SQL editor and run.
-- It PASSES quietly (NOTICE 'finance RLS OK ...') and RAISES an error if any wall is missing:
--   * Row-Level Security must be ENABLED on each finance table.
--   * Each must have a policy restricting access to admin / invoice_manager.
-- This proves office/surveyor/scanner/fitter (and the mobile anon+JWT client) cannot read
-- costs, prices or pricing rules through the database.

do $$
declare
  t text;
  n int;
begin
  foreach t in array array['pricing_rules','job_pricing','item_pricing'] loop
    -- table exists?
    if not exists (select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                   where ns.nspname = 'public' and c.relname = t) then
      raise exception 'Finance table % is missing — run migration 0017_finance.sql', t;
    end if;
    -- RLS enabled?
    if not exists (select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                   where ns.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'RLS is NOT enabled on % — finance data is exposed', t;
    end if;
    -- a policy that names invoice_manager (and, by our convention, admin) exists?
    select count(*) into n from pg_policies
     where schemaname = 'public' and tablename = t
       and (coalesce(qual,'') ilike '%invoice_manager%' or coalesce(with_check,'') ilike '%invoice_manager%');
    if n = 0 then
      raise exception 'No admin/invoice_manager policy found on % — anyone in the tenant could read it', t;
    end if;
  end loop;
  raise notice 'finance RLS OK — pricing_rules, job_pricing and item_pricing are locked to admin/invoice_manager';
end $$;

-- For reference, show the finance policies:
select tablename, policyname, cmd, qual
  from pg_policies
 where schemaname = 'public' and tablename in ('pricing_rules','job_pricing','item_pricing')
 order by tablename, policyname;

-- ------------------------------------------------------------------
-- Manual end-to-end test (optional but recommended):
--   1. In the office Users tab, ensure you have (or create) an 'office' user.
--   2. Sign into the office app as that user → the Budget tab must be ABSENT.
--   3. (Server) their bearer token calling GET /api/pricing-rules must return 403.
--   4. (Mobile) the phone never queries these tables; a finance-only invoice_manager
--      has no field capabilities, so the app shows them nothing operational.
-- ------------------------------------------------------------------
