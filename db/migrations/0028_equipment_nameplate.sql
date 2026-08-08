-- Capture what's physically on an equipment nameplate, so a tech can photograph
-- the rating plate and have the record filled in rather than typing it.
--
-- barcode: the code printed under the barcodes on the plate. On Bryant/Carrier
-- plates these encode the model and serial (e.g. *48KCEA06A2A3A0A0A0* and
-- *4215C75386*), but they're stored separately because a scanner reads the
-- barcode directly and that's the fastest way to find a unit again.
--
-- nameplate: everything else the plate carries that doesn't warrant its own
-- column — voltage/phase, BTU input/output, SEER, refrigerant charge,
-- manufacture date, AHRI number. Kept as jsonb so a new plate layout doesn't
-- need a schema change, and so nothing the tech photographed is thrown away.

alter table equipment add column if not exists barcode text;
alter table equipment add column if not exists nameplate jsonb;

-- Techs look a unit up by the code on the sticker, so make that lookup fast.
create index if not exists equipment_barcode_idx on equipment (barcode);
create index if not exists equipment_serial_idx on equipment (serial_number);
