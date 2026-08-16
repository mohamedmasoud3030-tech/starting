-- R11 quotation lifecycle labels are committed separately because PostgreSQL
-- does not allow a newly-added enum value to be used in the same transaction.
alter type public.quotation_status add value if not exists 'DRAFT' before 'ISSUED';
alter type public.quotation_status add value if not exists 'CONVERTED' after 'ACCEPTED';
alter type public.quotation_status add value if not exists 'CANCELLED' after 'CONVERTED';
