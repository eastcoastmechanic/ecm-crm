-- Records HOW and WITH WHAT a document was paid, so Stripe webhook replays,
-- Square sync and manual "mark paid" can all go through one idempotent path
-- (lib/document-paid.ts) and a refund/dispute can be traced to a payment.
--
-- Apply BEFORE merging the "Payments: Stripe/Square sync" PR. The code falls
-- back to status/paid_at only if these columns are missing, but then the
-- payment source and intent id are not stored.

alter table documents
  add column if not exists stripe_payment_intent_id text;

alter table documents
  add column if not exists payment_source text;

alter table documents
  drop constraint if exists documents_payment_source_check;
alter table documents
  add constraint documents_payment_source_check
  check (payment_source is null or payment_source in ('stripe', 'square', 'manual', 'cash_check'));

comment on column documents.stripe_payment_intent_id is
  'Stripe PaymentIntent id (pi_...) that paid this document; null if not paid through Stripe.';
comment on column documents.payment_source is
  'How the document was marked paid: stripe, square, manual, cash_check. Null for unpaid or pre-migration rows.';
