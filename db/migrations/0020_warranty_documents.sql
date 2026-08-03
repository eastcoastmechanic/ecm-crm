-- Phase: warranty registration documents. A new documents.type, "warranty" —
-- records manufacturer warranty details (docket number, registration,
-- duration) for a specific piece of equipment, plus ECM's standard 1-year
-- craftsmanship warranty on the install. Lives in documents to reuse its
-- numbering/list infrastructure, same precedent as 'assessment' (0010).
-- line_items stores a warranty-specific shape, not the tiered-pricing one.

alter table documents drop constraint if exists documents_type_check;
alter table documents add constraint documents_type_check
  check (type in ('estimate', 'invoice', 'proposal', 'assessment', 'warranty'));
