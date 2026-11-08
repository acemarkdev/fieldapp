-- ============================================================
--  Logistics ▸ Shipments: the packing lists the office generates are kept on the shipment
--  (kind 'packing_list' — the latest one with photos and the latest one without).
-- ============================================================
alter table shipment_files drop constraint if exists shipment_files_kind_check;
alter table shipment_files add constraint shipment_files_kind_check check (kind in ('photo', 'invoice', 'cmr', 'packing_signed', 'cc599', 'packing_list', 'other'));
