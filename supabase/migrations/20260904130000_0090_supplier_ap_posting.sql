-- ============================================================================
-- 0090 — Supplier Accounts Payable + procurement posting (B3)
--
-- Supplier-invoice and supplier-payment commands are introduced as a coherent
-- financial slice on top of the existing (non-financial) procurement order /
-- receipt records. The procurement order + receipt paths remain NON-FINANCIAL
-- (commitment / delivery proof only) — they emit NO journal. Accounting arises
-- only at supplier invoice and supplier payment, and posts inside the SAME
-- transaction as the operational mutation:
--
--   * record_supplier_invoice -> SUPPLIER_INVOICE
--       Dr Procurement / Materials Cost 5100  (invoice net; input VAT deferred)
--       Cr Accounts Payable 2200             (invoice amount)
--   * void_supplier_invoice  -> SUPPLIER_INVOICE_VOID (reversal of the original)
--   * record_supplier_payment-> SUPPLIER_PAYMENT
--       Dr Accounts Payable 2200
--       Cr Treasury (resolved account)
--   * void_supplier_payment  -> SUPPLIER_PAYMENT_VOID (reversal of the original)
--
-- Three-way match (PO <-> Receipt <-> Invoice), enforced ATOMICALLY BEFORE the
-- journal is posted:
--   * the invoice must reference a real, non-cancelled procurement order.
--   * CONSUMABLE line_kind requires a receipt line with received qty >= invoice
--     qty (delivery must be proven before the AP liability is recognised).
--   * CATERING_SERVICE / OTHER: receipt optional.
--   * invoice qty <= received qty (CONSUMABLE) and <= ordered qty (all).
--   * price tolerance: |invoice unit_cost - agreed_unit_cost| <= 0.001 OMR,
--     else an owner override (p_owner_override + explicit reason) is required.
-- Any failure aborts the whole transaction before the journal — nothing is
-- posted for an ineligible invoice.
--
-- Invariants preserved:
--   * Accounts Payable (2200) >= 0 (supplier-level AND per-invoice) — a payment
--     is rejected if it exceeds the available outstanding AP, so 2200 can never
--     go negative. No invented "supplier prepayment" asset account: AP is
--     invoice-first, payment-second.
--   * Cash treasury must never go negative (assert_treasury_sufficient).
--   * Journal entries balanced + immutable; reversals reference the original
--     (via the 0089 _post_reversal helper so the void source type survives).
--
-- Chart codes: 2200 Supplier AP, 5100 Procurement/Materials Cost verified from
-- 0084. Input VAT remains deferred; 2150 is OUTPUT-VAT ONLY (never supplier
-- input VAT). Inventory stays operational (Option 1) — no inventory-asset
-- accounting is introduced here.
--
-- Contract: docs/research/accounting-posting-contract.md §8, §9, §22.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Operational supplier invoice aggregate + lines.
-- ---------------------------------------------------------------------------
create table public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null,
  event_id uuid,
  order_id uuid not null,
  invoice_number text not null check (length(trim(invoice_number)) > 0),
  invoice_date date not null,
  due_date date,
  amount numeric(12,3) not null check (amount > 0),
  notes text,
  owner_override boolean not null default false,
  override_reason text,
  status public.customer_payment_status not null default 'RECORDED',
  recorded_by uuid not null references auth.users(id),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  void_reason text,
  idempotency_key uuid not null,
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  created_at timestamptz not null default now(),

  constraint supplier_invoices_supplier_fk
    foreign key (organization_id, supplier_id)
    references public.suppliers(organization_id, id) on delete restrict,
  constraint supplier_invoices_event_fk
    foreign key (organization_id, event_id)
    references public.events(organization_id, id) on delete restrict,
  constraint supplier_invoices_order_fk
    foreign key (organization_id, order_id)
    references public.procurement_orders(organization_id, id) on delete restrict,
  constraint supplier_invoices_org_id_unique unique (organization_id, id),
  constraint supplier_invoices_org_number_unique unique (organization_id, supplier_id, invoice_number),
  constraint supplier_invoices_org_idempotency_unique unique (organization_id, idempotency_key),
  constraint supplier_invoices_void_shape check (
    (status = 'VOIDED' and voided_by is not null and voided_at is not null
      and length(trim(coalesce(void_reason, ''))) >= 3)
    or (status = 'RECORDED' and voided_by is null and voided_at is null and void_reason is null)
  ),
  constraint supplier_invoices_override_shape check (
    (owner_override and length(trim(coalesce(override_reason, ''))) >= 3)
    or (not owner_override and override_reason is null)
  )
);

create index supplier_invoices_supplier_idx
  on public.supplier_invoices (organization_id, supplier_id, invoice_date, id);

create table public.supplier_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  invoice_id uuid not null,
  order_id uuid not null,
  order_line_id uuid not null,
  line_kind public.procurement_line_kind not null,
  description text not null,
  unit text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_cost numeric(12,3) not null check (unit_cost >= 0),
  total_cost numeric(12,3) not null check (total_cost >= 0),
  created_at timestamptz not null default now(),

  constraint supplier_invoice_lines_invoice_fk
    foreign key (organization_id, invoice_id)
    references public.supplier_invoices(organization_id, id) on delete cascade,
  constraint supplier_invoice_lines_order_line_fk
    foreign key (organization_id, order_id, order_line_id)
    references public.procurement_order_lines(organization_id, order_id, id) on delete restrict,
  constraint supplier_invoice_lines_org_id_unique unique (organization_id, id),
  constraint supplier_invoice_lines_invoice_line_unique
    unique (organization_id, invoice_id, order_line_id),
  constraint supplier_invoice_lines_exact_total check (
    total_cost = round(quantity * unit_cost, 3)
  )
);

create index supplier_invoice_lines_invoice_idx
  on public.supplier_invoice_lines (organization_id, invoice_id, order_line_id);

-- ---------------------------------------------------------------------------
-- Operational supplier payment aggregate + invoice allocations.
-- ---------------------------------------------------------------------------
create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null,
  amount numeric(12,3) not null check (amount > 0),
  payment_date date not null,
  payment_method public.payment_method not null,
  reference text,
  reason text,
  status public.customer_payment_status not null default 'RECORDED',
  recorded_by uuid not null references auth.users(id),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  void_reason text,
  idempotency_key uuid not null,
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  created_at timestamptz not null default now(),

  constraint supplier_payments_supplier_fk
    foreign key (organization_id, supplier_id)
    references public.suppliers(organization_id, id) on delete restrict,
  constraint supplier_payments_org_id_unique unique (organization_id, id),
  constraint supplier_payments_org_idempotency_unique unique (organization_id, idempotency_key),
  constraint supplier_payments_void_shape check (
    (status = 'VOIDED' and voided_by is not null and voided_at is not null
      and length(trim(coalesce(void_reason, ''))) >= 3)
    or (status = 'RECORDED' and voided_by is null and voided_at is null and void_reason is null)
  )
);

create index supplier_payments_supplier_idx
  on public.supplier_payments (organization_id, supplier_id, payment_date, id);

create table public.supplier_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  payment_id uuid not null,
  invoice_id uuid not null,
  amount numeric(12,3) not null check (amount > 0),
  created_at timestamptz not null default now(),

  constraint supplier_payment_allocations_payment_fk
    foreign key (organization_id, payment_id)
    references public.supplier_payments(organization_id, id) on delete cascade,
  constraint supplier_payment_allocations_invoice_fk
    foreign key (organization_id, invoice_id)
    references public.supplier_invoices(organization_id, id) on delete restrict,
  constraint supplier_payment_allocations_org_id_unique unique (organization_id, id),
  constraint supplier_payment_allocations_payment_invoice_unique
    unique (organization_id, payment_id, invoice_id)
);

create index supplier_payment_allocations_invoice_idx
  on public.supplier_payment_allocations (organization_id, invoice_id);
create index supplier_payment_allocations_payment_idx
  on public.supplier_payment_allocations (organization_id, payment_id);

-- ---------------------------------------------------------------------------
-- RLS: finance/owner roles can read; anon never. Command bodies run as the
-- definer so insert/update are unaffected by the read-only policy.
-- ---------------------------------------------------------------------------
alter table public.supplier_invoices enable row level security;
alter table public.supplier_invoice_lines enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.supplier_payment_allocations enable row level security;

create policy "supplier_invoices_select_cost_role" on public.supplier_invoices
  for select using (public.can_read_cost(organization_id));
create policy "supplier_invoice_lines_select_cost_role" on public.supplier_invoice_lines
  for select using (public.can_read_cost(organization_id));
create policy "supplier_payments_select_cost_role" on public.supplier_payments
  for select using (public.can_read_cost(organization_id));
create policy "supplier_payment_allocations_select_cost_role" on public.supplier_payment_allocations
  for select using (public.can_read_cost(organization_id));

revoke all on table public.supplier_invoices, public.supplier_invoice_lines,
  public.supplier_payments, public.supplier_payment_allocations from anon;
grant select on table public.supplier_invoices, public.supplier_invoice_lines,
  public.supplier_payments, public.supplier_payment_allocations to authenticated;

-- ---------------------------------------------------------------------------
-- Internal: supplier-level outstanding AP (accounting truth from the journal).
-- 2200 is credit-normal; originals + reversals are netted naturally.
-- ---------------------------------------------------------------------------
create or replace function public._supplier_ap_position(
  p_org_id uuid,
  p_supplier_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.credit - l.debit) filter (
    where l.account_id = (select id from public.chart_of_accounts
                          where organization_id = p_org_id and code = '2200')
  ), 0)
    from public.journal_lines l
    join public.journal_entries e
      on e.organization_id = l.organization_id and e.id = l.entry_id
   where e.organization_id = p_org_id
     and (
       (e.source_type in ('SUPPLIER_INVOICE','SUPPLIER_INVOICE_VOID')
        and exists (select 1 from public.supplier_invoices s
                     where s.organization_id = p_org_id and s.id = e.source_id
                       and s.supplier_id = p_supplier_id))
       or (e.source_type in ('SUPPLIER_PAYMENT','SUPPLIER_PAYMENT_VOID')
        and exists (select 1 from public.supplier_payments p
                     where p.organization_id = p_org_id and p.id = e.source_id
                       and p.supplier_id = p_supplier_id))
     );
$$;

-- ---------------------------------------------------------------------------
-- Internal: outstanding AP for a single invoice = invoice amount minus the
-- RECORDED (un-voided) payment allocations against it. Keeps per-invoice AP
-- >= 0 and lets void_supplier_invoice require no active allocations.
-- ---------------------------------------------------------------------------
create or replace function public._supplier_invoice_ap(
  p_org_id uuid,
  p_invoice_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(i.amount - sum(case when p.status = 'RECORDED' then a.amount else 0 end), i.amount)
    from public.supplier_invoices i
    left join public.supplier_payment_allocations a
      on a.organization_id = i.organization_id and a.invoice_id = i.id
    left join public.supplier_payments p
      on p.organization_id = a.organization_id and p.id = a.payment_id
   where i.organization_id = p_org_id and i.id = p_invoice_id
   group by i.id
$$;

-- ---------------------------------------------------------------------------
-- record_supplier_invoice — three-way match + Dr 5100 / Cr 2200 (AP).
-- ---------------------------------------------------------------------------
create or replace function public.record_supplier_invoice(
  p_org_id uuid,
  p_supplier_id uuid,
  p_order_id uuid,
  p_event_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_due_date date,
  p_lines jsonb,
  p_notes text default null,
  p_owner_override boolean default false,
  p_override_reason text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.supplier_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.supplier_invoices;
  v_supplier public.suppliers;
  v_order public.procurement_orders;
  v_fingerprint text;
  v_replay jsonb;
  v_len integer;
  v_item jsonb;
  v_order_line_id uuid;
  v_qty numeric;
  v_unit_cost numeric;
  v_line_total numeric;
  v_amount numeric(12,3) := 0;
  v_line public.procurement_order_lines;
  v_received numeric;
  v_kind public.procurement_line_kind;
  v_description text;
  v_unit text;
  v_bypass boolean;
  v_chart_cost uuid;
  v_chart_ap uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'procurement.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_invoice_date is null then
    raise exception 'SUPPLIER_INVOICE_DATE_REQUIRED' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_invoice_number, ''))) = 0 then
    raise exception 'SUPPLIER_INVOICE_NUMBER_REQUIRED' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'SUPPLIER_INVOICE_LINES_REQUIRED' using errcode = '22023';
  end if;
  if p_owner_override and length(trim(coalesce(p_override_reason, ''))) < 3 then
    raise exception 'SUPPLIER_OVERRIDE_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_SUPPLIER_INVOICE',
    'supplier_id', p_supplier_id, 'order_id', p_order_id, 'event_id', p_event_id,
    'invoice_number', trim(p_invoice_number), 'invoice_date', p_invoice_date,
    'due_date', p_due_date, 'notes', nullif(trim(coalesce(p_notes, '')), ''),
    'owner_override', p_owner_override, 'override_reason', nullif(trim(coalesce(p_override_reason, '')), ''),
    'lines', p_lines
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.supplier_invoices, v_replay);
  end if;

  -- Supplier must be active and belong to this org.
  select * into v_supplier from public.suppliers s
   where s.organization_id = p_org_id and s.id = p_supplier_id for update;
  if not found or v_supplier.status <> 'ACTIVE' then
    raise exception 'SUPPLIER_NOT_ACTIVE' using errcode = '23503';
  end if;

  -- Order must exist, belong to the supplier + org, and not be cancelled.
  select * into v_order from public.procurement_orders o
   where o.organization_id = p_org_id and o.id = p_order_id and o.supplier_id = p_supplier_id
   for update;
  if not found then
    raise exception 'PROCUREMENT_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.status = 'CANCELLED' then
    raise exception 'PROCUREMENT_ORDER_CANCELLED' using errcode = '23514';
  end if;
  if p_event_id is not null and not exists (
    select 1 from public.events e where e.organization_id = p_org_id and e.id = p_event_id
  ) then
    raise exception 'EVENT_NOT_IN_ORG' using errcode = '23503';
  end if;

  -- Line-level 3-way match + total derivation. Fail atomically BEFORE any
  -- journal or invoice write.
  v_len := jsonb_array_length(p_lines);
  for i in 0..v_len - 1 loop
    v_item := p_lines -> i;
    v_order_line_id := nullif(v_item ->> 'order_line_id', '')::uuid;
    v_qty := (v_item ->> 'quantity')::numeric;
    v_unit_cost := (v_item ->> 'unit_cost')::numeric;
    if v_order_line_id is null then
      raise exception 'SUPPLIER_INVOICE_ORDER_LINE_REQUIRED' using errcode = '22023';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'SUPPLIER_INVOICE_QTY_INVALID' using errcode = '22023';
    end if;
    if round(v_qty, 3) <> v_qty then
      raise exception 'QUANTITY_PRECISION_EXCEEDED' using errcode = '22023';
    end if;
    if v_unit_cost is null or v_unit_cost < 0 then
      raise exception 'SUPPLIER_INVOICE_UNIT_COST_INVALID' using errcode = '22023';
    end if;
    if round(v_unit_cost, 3) <> v_unit_cost then
      raise exception 'OMR_PRECISION_EXCEEDED' using errcode = '22023';
    end if;

    select * into v_line from public.procurement_order_lines l
     where l.organization_id = p_org_id and l.order_id = p_order_id and l.id = v_order_line_id;
    if not found then
      raise exception 'PROCUREMENT_ORDER_LINE_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_kind := v_line.line_kind;

    -- Quantity <= ordered (all line kinds).
    if v_qty > v_line.quantity then
      if not p_owner_override then
        raise exception 'SUPPLIER_INVOICE_QTY_EXCEEDS_ORDER' using errcode = '23514', detail = jsonb_build_object('order_line', v_line.id, 'invoice_qty', v_qty,
            'ordered_qty', v_line.quantity)::text;
      end if;
    end if;

    -- Price tolerance 0.001 OMR.
    if abs(v_unit_cost - v_line.agreed_unit_cost) > 0.001 then
      if not p_owner_override then
        raise exception 'SUPPLIER_INVOICE_PRICE_TOLERANCE_EXCEEDED' using errcode = '23514', detail = jsonb_build_object('order_line', v_line.id, 'invoice', v_unit_cost,
            'agreed', v_line.agreed_unit_cost)::text;
      end if;
    end if;

    -- CONSUMABLE requires proof of receipt (received qty >= invoice qty).
    v_received := coalesce((
      select sum(rl.quantity) from public.procurement_receipt_lines rl
       where rl.organization_id = p_org_id
         and rl.order_id = p_order_id and rl.order_line_id = v_order_line_id
    ), 0);
    if v_kind = 'CONSUMABLE' and v_received <= 0 then
      if not p_owner_override then
        raise exception 'SUPPLIER_INVOICE_RECEIPT_REQUIRED' using errcode = '23514', detail = jsonb_build_object('order_line', v_line.id, 'line_kind', v_kind::text,
            'received_qty', v_received)::text;
      end if;
    elsif v_kind = 'CONSUMABLE' and v_qty > v_received then
      if not p_owner_override then
        raise exception 'SUPPLIER_INVOICE_QTY_EXCEEDS_RECEIPT' using errcode = '23514', detail = jsonb_build_object('order_line', v_line.id, 'invoice_qty', v_qty,
            'received_qty', v_received)::text;
      end if;
    end if;

    v_line_total := round(v_qty * v_unit_cost, 3);
    v_amount := v_amount + v_line_total;
  end loop;

  if round(v_amount, 3) <> v_amount or v_amount <= 0 then
    raise exception 'SUPPLIER_INVOICE_AMOUNT_INVALID' using errcode = '22023';
  end if;

  insert into public.supplier_invoices (
    organization_id, supplier_id, event_id, order_id, invoice_number,
    invoice_date, due_date, amount, notes, owner_override, override_reason,
    recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_supplier_id, p_event_id, p_order_id, trim(p_invoice_number),
    p_invoice_date, p_due_date, v_amount, nullif(trim(coalesce(p_notes, '')), ''),
    p_owner_override, nullif(trim(coalesce(p_override_reason, '')), ''),
    auth.uid(), p_idempotency_key, v_fingerprint
  ) returning * into v_invoice;

  for i in 0..v_len - 1 loop
    v_item := p_lines -> i;
    v_order_line_id := nullif(v_item ->> 'order_line_id', '')::uuid;
    v_qty := (v_item ->> 'quantity')::numeric;
    v_unit_cost := (v_item ->> 'unit_cost')::numeric;
    select line_kind, description, unit into v_kind, v_description, v_unit
      from public.procurement_order_lines
     where organization_id = p_org_id and order_id = p_order_id and id = v_order_line_id;
    insert into public.supplier_invoice_lines (
      organization_id, invoice_id, order_id, order_line_id, line_kind, description,
      unit, quantity, unit_cost, total_cost
    ) values (
      p_org_id, v_invoice.id, p_order_id, v_order_line_id, v_kind, v_description, v_unit,
      v_qty, v_unit_cost, round(v_qty * v_unit_cost, 3)
    );
  end loop;

  -- ======================= LEDGER POSTING =======================
  perform public.ensure_system_chart(p_org_id);
  v_chart_cost := public._chart_id(p_org_id, '5100');
  v_chart_ap := public._chart_id(p_org_id, '2200');
  perform public.internal_post_journal(
    p_org_id, p_invoice_date,
    'SUPPLIER_INVOICE', v_invoice.id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_chart_cost::text, 'debit', v_amount, 'credit', 0,
        'line_memo', 'Supplier invoice ' || trim(p_invoice_number) || ': procurement cost'),
      jsonb_build_object('account_id', v_chart_ap::text, 'debit', 0, 'credit', v_amount,
        'line_memo', 'Accounts payable accrued')
    ),
    p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'RECORD_SUPPLIER_INVOICE', 'invoice', v_invoice.id,
      'supplier', p_supplier_id, 'order', p_order_id, 'amount', v_amount::text
    )),
    'Supplier invoice ' || trim(p_invoice_number),
    now(), p_event_id, null, false
  );
  -- ======================= END LEDGER POSTING =======================

  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'RECORD_SUPPLIER_INVOICE', v_fingerprint,
    'supplier_invoice', v_invoice.id, to_jsonb(v_invoice)
  );
  perform public.record_audit(
    p_org_id, 'SUPPLIER_INVOICE_RECORDED', 'supplier_invoice', v_invoice.id::text,
    jsonb_build_object('supplier_id', p_supplier_id, 'order_id', p_order_id,
      'event_id', p_event_id, 'amount', v_amount::text, 'owner_override', p_owner_override)
  );
  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_supplier_invoice — reverse the SUPPLIER_INVOICE journal, restore AP.
-- Requires no active (un-voided) payment allocations against the invoice so
-- AP can never go negative; payments must be reversed first.
-- ---------------------------------------------------------------------------
create or replace function public.void_supplier_invoice(
  p_org_id uuid,
  p_invoice_id uuid,
  p_reason text,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.supplier_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.supplier_invoices;
  v_fingerprint text;
  v_replay jsonb;
  v_orig_entry uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'procurement.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'SUPPLIER_INVOICE_VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_SUPPLIER_INVOICE', 'invoice_id', p_invoice_id, 'reason', trim(p_reason)
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.supplier_invoices, v_replay);
  end if;

  select * into v_invoice from public.supplier_invoices
   where organization_id = p_org_id and id = p_invoice_id for update;
  if not found then
    raise exception 'SUPPLIER_INVOICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_invoice.status = 'VOIDED' then
    raise exception 'SUPPLIER_INVOICE_ALREADY_VOIDED';
  end if;
  if exists (
    select 1 from public.supplier_payment_allocations a
      join public.supplier_payments p on p.id = a.payment_id and p.organization_id = a.organization_id
     where a.organization_id = p_org_id and a.invoice_id = p_invoice_id and p.status = 'RECORDED'
  ) then
    raise exception 'SUPPLIER_INVOICE_HAS_ACTIVE_PAYMENTS' using errcode = '23514';
  end if;

  update public.supplier_invoices set
    status = 'VOIDED', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
  where id = p_invoice_id returning * into v_invoice;

  select e.id into v_orig_entry
    from public.journal_entries e
   where e.organization_id = p_org_id
     and e.source_type = 'SUPPLIER_INVOICE'
     and e.source_id = v_invoice.id
     and not e.is_reversal
   order by e.created_at, e.id
   limit 1;
  if found then
    perform public._post_reversal(
      p_org_id, v_orig_entry, 'SUPPLIER_INVOICE_VOID', v_invoice.id,
      md5(p_idempotency_key::text || ':invoice-rev')::uuid, trim(p_reason),
      v_invoice.event_id, now()
    );
  end if;

  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'VOID_SUPPLIER_INVOICE', v_fingerprint,
    'supplier_invoice', v_invoice.id, to_jsonb(v_invoice)
  );
  perform public.record_audit(
    p_org_id, 'SUPPLIER_INVOICE_VOIDED', 'supplier_invoice', v_invoice.id::text,
    jsonb_build_object('reason', trim(p_reason))
  );
  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_supplier_payment — Dr 2200 / Cr Treasury. Rejects an amount that
-- exceeds the supplier's outstanding AP so 2200 can never go negative. Allows
-- explicit invoice allocations; otherwise auto-allocates FIFO across the
-- supplier's outstanding invoices.
-- ---------------------------------------------------------------------------
create or replace function public.record_supplier_payment(
  p_org_id uuid,
  p_supplier_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_method public.payment_method,
  p_reference text,
  p_reason text,
  p_allocations jsonb default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_treasury_account_id uuid default null
)
returns public.supplier_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.supplier_payments;
  v_supplier public.suppliers;
  v_fingerprint text;
  v_replay jsonb;
  v_tid uuid;
  v_chart uuid;
  v_ap numeric;
  v_chart_ap uuid;
  v_alloc jsonb;
  v_invoice_id uuid;
  v_alloc_amount numeric;
  v_invoice_ap numeric;
  v_sum numeric := 0;
  v_remaining numeric;
  v_row record;
  v_lines jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'finance.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform public.assert_payment_omr(p_amount);
  if p_payment_date is null then
    raise exception 'SUPPLIER_PAYMENT_DATE_REQUIRED' using errcode = '22023';
  end if;
  if p_payment_method is null then
    raise exception 'SUPPLIER_PAYMENT_METHOD_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'RECORD_SUPPLIER_PAYMENT',
    'supplier_id', p_supplier_id, 'amount', p_amount::text,
    'payment_date', p_payment_date, 'payment_method', p_payment_method,
    'reference', nullif(trim(coalesce(p_reference, '')), ''),
    'reason', nullif(trim(coalesce(p_reason, '')), ''),
    'allocations', p_allocations, 'treasury', p_treasury_account_id
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.supplier_payments, v_replay);
  end if;

  select * into v_supplier from public.suppliers s
   where s.organization_id = p_org_id and s.id = p_supplier_id for update;
  if not found or v_supplier.status <> 'ACTIVE' then
    raise exception 'SUPPLIER_NOT_ACTIVE' using errcode = '23503';
  end if;

  -- Supplier-level outstanding AP (accounting truth); the payment cannot exceed it.
  v_ap := public._supplier_ap_position(p_org_id, p_supplier_id);
  if v_ap <= 0 then
    raise exception 'SUPPLIER_AP_ZERO' using errcode = '23514';
  end if;
  if p_amount > v_ap then
    raise exception 'SUPPLIER_PAYMENT_EXCEEDS_AP' using errcode = '23514', detail = jsonb_build_object('amount', p_amount::text, 'available_ap', v_ap::text)::text;
  end if;

  insert into public.supplier_payments (
    organization_id, supplier_id, amount, payment_date, payment_method,
    reference, reason, recorded_by, idempotency_key, request_fingerprint
  ) values (
    p_org_id, p_supplier_id, p_amount, p_payment_date, p_payment_method,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_reason, '')), ''), auth.uid(),
    p_idempotency_key, v_fingerprint
  ) returning * into v_payment;

  -- Build allocations. Explicit list, else FIFO across outstanding invoices.
  if p_allocations is not null and jsonb_typeof(p_allocations) = 'array' and jsonb_array_length(p_allocations) > 0 then
    for v_alloc in select value from jsonb_array_elements(p_allocations) loop
      v_invoice_id := nullif(v_alloc ->> 'invoice_id', '')::uuid;
      v_alloc_amount := (v_alloc ->> 'amount')::numeric;
      if v_invoice_id is null then
        raise exception 'SUPPLIER_PAYMENT_INVOICE_REQUIRED' using errcode = '22023';
      end if;
      if v_alloc_amount is null or v_alloc_amount <= 0 then
        raise exception 'SUPPLIER_PAYMENT_ALLOCATION_AMOUNT_INVALID' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.supplier_invoices i
         where i.organization_id = p_org_id and i.id = v_invoice_id and i.supplier_id = p_supplier_id
      ) then
        raise exception 'SUPPLIER_INVOICE_NOT_IN_ORG' using errcode = '23503';
      end if;
      v_invoice_ap := public._supplier_invoice_ap(p_org_id, v_invoice_id);
      if v_alloc_amount > v_invoice_ap then
        raise exception 'SUPPLIER_PAYMENT_EXCEEDS_INVOICE_AP' using errcode = '23514', detail = jsonb_build_object('invoice', v_invoice_id, 'allocated', v_alloc_amount::text,
            'remaining_ap', v_invoice_ap::text)::text;
      end if;
      insert into public.supplier_payment_allocations (
        organization_id, payment_id, invoice_id, amount
      ) values (p_org_id, v_payment.id, v_invoice_id, v_alloc_amount);
      v_sum := v_sum + v_alloc_amount;
    end loop;
    if round(v_sum, 3) <> round(p_amount, 3) then
      raise exception 'SUPPLIER_PAYMENT_ALLOCATION_TOTAL_MISMATCH' using errcode = '23514';
    end if;
  else
    -- FIFO: oldest outstanding invoice first.
    v_remaining := p_amount;
    for v_row in
      select i.id as invoice_id
        from public.supplier_invoices i
       where i.organization_id = p_org_id and i.supplier_id = p_supplier_id and i.status = 'RECORDED'
         and public._supplier_invoice_ap(p_org_id, i.id) > 0
       order by i.invoice_date, i.id
    loop
      if v_remaining <= 0 then exit; end if;
      v_invoice_ap := public._supplier_invoice_ap(p_org_id, v_row.invoice_id);
      v_alloc_amount := least(v_remaining, v_invoice_ap);
      if v_alloc_amount > 0 then
        insert into public.supplier_payment_allocations (
          organization_id, payment_id, invoice_id, amount
        ) values (p_org_id, v_payment.id, v_row.invoice_id, v_alloc_amount);
        v_remaining := v_remaining - v_alloc_amount;
      end if;
    end loop;
    if v_remaining > 0.0001 then
      raise exception 'SUPPLIER_PAYMENT_ALLOCATION_INSUFFICIENT_AP' using errcode = '23514';
    end if;
  end if;

  -- ======================= LEDGER POSTING =======================
  perform public.ensure_system_chart(p_org_id);
  select * into v_tid, v_chart
    from public._resolve_expense_treasury(p_org_id, p_treasury_account_id);
  if v_chart is null then
    raise exception 'TREASURY_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_tid is not null then
    perform public.assert_treasury_sufficient(p_org_id, v_tid, p_amount);
  end if;
  v_chart_ap := public._chart_id(p_org_id, '2200');
  perform public.internal_post_journal(
    p_org_id, p_payment_date,
    'SUPPLIER_PAYMENT', v_payment.id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_chart_ap::text, 'debit', p_amount, 'credit', 0,
        'line_memo', 'Supplier payment (settles accounts payable)'),
      jsonb_build_object('account_id', v_chart::text, 'debit', 0, 'credit', p_amount,
        'line_memo', 'Paid from treasury')
    ),
    p_idempotency_key,
    public.warehouse_fingerprint(jsonb_build_object(
      'command', 'RECORD_SUPPLIER_PAYMENT', 'payment', v_payment.id,
      'supplier', p_supplier_id, 'amount', p_amount::text,
      'treasury', coalesce(v_tid, v_chart)::text
    )),
    'Supplier payment: ' || coalesce(nullif(trim(p_reason), ''), 'payment'),
    now(), null, null, false
  );
  -- ======================= END LEDGER POSTING =======================

  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'RECORD_SUPPLIER_PAYMENT', v_fingerprint,
    'supplier_payment', v_payment.id, to_jsonb(v_payment)
  );
  perform public.record_audit(
    p_org_id, 'SUPPLIER_PAYMENT_RECORDED', 'supplier_payment', v_payment.id::text,
    jsonb_build_object('supplier_id', p_supplier_id, 'amount', p_amount::text,
      'treasury', coalesce(v_tid, v_chart)::text)
  );
  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_supplier_payment — reverse the SUPPLIER_PAYMENT journal, restore AP.
-- ---------------------------------------------------------------------------
create or replace function public.void_supplier_payment(
  p_org_id uuid,
  p_payment_id uuid,
  p_reason text,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.supplier_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.supplier_payments;
  v_fingerprint text;
  v_replay jsonb;
  v_orig_entry uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_permission(p_org_id, 'finance.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'SUPPLIER_PAYMENT_VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_fingerprint := public.warehouse_fingerprint(jsonb_build_object(
    'command', 'VOID_SUPPLIER_PAYMENT', 'payment_id', p_payment_id, 'reason', trim(p_reason)
  ));
  v_replay := public.begin_procurement_command(p_org_id, p_idempotency_key, v_fingerprint);
  if v_replay is not null then
    return jsonb_populate_record(null::public.supplier_payments, v_replay);
  end if;

  select * into v_payment from public.supplier_payments
   where organization_id = p_org_id and id = p_payment_id for update;
  if not found then
    raise exception 'SUPPLIER_PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_payment.status = 'VOIDED' then
    raise exception 'SUPPLIER_PAYMENT_ALREADY_VOIDED';
  end if;

  update public.supplier_payments set
    status = 'VOIDED', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
  where id = p_payment_id returning * into v_payment;

  select e.id into v_orig_entry
    from public.journal_entries e
   where e.organization_id = p_org_id
     and e.source_type = 'SUPPLIER_PAYMENT'
     and e.source_id = v_payment.id
     and not e.is_reversal
   order by e.created_at, e.id
   limit 1;
  if found then
    perform public._post_reversal(
      p_org_id, v_orig_entry, 'SUPPLIER_PAYMENT_VOID', v_payment.id,
      md5(p_idempotency_key::text || ':payment-rev')::uuid, trim(p_reason)
    );
  end if;

  perform public.finish_procurement_command(
    p_org_id, p_idempotency_key, 'VOID_SUPPLIER_PAYMENT', v_fingerprint,
    'supplier_payment', v_payment.id, to_jsonb(v_payment)
  );
  perform public.record_audit(
    p_org_id, 'SUPPLIER_PAYMENT_VOIDED', 'supplier_payment', v_payment.id::text,
    jsonb_build_object('reason', trim(p_reason))
  );
  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: internal helpers never client-exposed; commands kept.
-- ---------------------------------------------------------------------------
revoke all on function public._supplier_ap_position(uuid, uuid) from public, anon, authenticated;
revoke all on function public._supplier_invoice_ap(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_supplier_invoice(uuid, uuid, uuid, uuid, text, date, date, jsonb, text, boolean, text, uuid) to authenticated;
grant execute on function public.void_supplier_invoice(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.record_supplier_payment(uuid, uuid, numeric, date, public.payment_method, text, text, jsonb, uuid, uuid) to authenticated;
grant execute on function public.void_supplier_payment(uuid, uuid, text, uuid) to authenticated;
