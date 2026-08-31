-- ============================================================
--  Photo kinds for the Picture Before / Picture After routing (v0.52+).
--  item_photos.kind is the photo_kind enum; add the two new values so office
--  and mobile can tag photos 'before' (scanner/surveyor) and 'after' (fitter).
--  Added in their own migration so they're committed before any row uses them.
-- ============================================================

alter type photo_kind add value if not exists 'before';
alter type photo_kind add value if not exists 'after';
