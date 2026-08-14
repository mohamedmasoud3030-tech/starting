-- ============================================================================
-- 0028 — S4B consumable catalog/profile concurrency hardening
--
-- A stock profile is valid only while its catalog item is CONSUMABLE.
-- 0025 enforced that rule in both directions, but the profile-side trigger
-- originally performed a plain read of catalog_items. Under READ COMMITTED,
-- profile creation and a concurrent catalog item re-type could therefore each
-- miss the other's uncommitted write and both commit, leaving a stock profile
-- attached to a non-CONSUMABLE item.
--
-- The catalog UPDATE already row-locks the catalog item. This replacement guard
-- takes the same row lock before accepting a stock-profile INSERT/UPDATE, so the
-- two operations serialize at the shared catalog row:
--
--   profile wins -> re-type waits, then CATALOG_ITEM_HAS_CONSUMABLE_STOCK
--   re-type wins  -> profile waits, then CATALOG_ITEM_NOT_CONSUMABLE
--
-- No applied migration is modified; this is a forward-only hardening layer.
-- ============================================================================

create or replace function public.consumable_stock_item_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item_type public.catalog_item_type;
begin
  -- Shared serialization point with catalog item UPDATEs. FOR UPDATE is
  -- deliberate: item_type is not part of the referenced FK key, so the weaker
  -- FK KEY SHARE lock alone would not block a concurrent non-key UPDATE.
  select ci.item_type
    into v_item_type
    from public.catalog_items ci
   where ci.organization_id = new.organization_id
     and ci.id = new.catalog_item_id
   for update;

  if not found or v_item_type <> 'CONSUMABLE' then
    raise exception 'CATALOG_ITEM_NOT_CONSUMABLE' using errcode = '23514';
  end if;

  return new;
end;
$$;
