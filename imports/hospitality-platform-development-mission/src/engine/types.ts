import type { MilliOMR } from "@/lib/money";
import type {
  AppRole,
  AssignmentStatus,
  CatalogItemType,
  CompensationMethod,
  CustomerType,
  EventStatus,
  EventType,
  LifecycleStatus,
  PricingMethod,
  QuotationStatus,
  ReservationStatus,
  StaffType,
} from "@/lib/domain";

export interface Organization {
  id: string;
  name: string;
  phone: string;
  city: string;
  isActive: boolean;
  createdAt: string;
}

export interface Profile {
  id: string;
  fullName: string;
  email: string;
}

export interface Membership {
  id: string;
  organizationId: string;
  profileId: string;
  role: AppRole;
  isActive: boolean;
}

export interface Customer {
  id: string;
  organizationId: string;
  name: string;
  phone: string;
  whatsapp: string;
  customerType: CustomerType;
  notes: string;
  status: LifecycleStatus;
  createdAt: string;
}

export interface CatalogCategory {
  id: string;
  organizationId: string;
  name: string;
  sortOrder: number;
  status: LifecycleStatus;
}

export interface CatalogItem {
  id: string;
  organizationId: string;
  categoryId: string | null;
  nameAr: string;
  nameEn: string;
  itemType: CatalogItemType;
  unit: string;
  pricingMethod: PricingMethod;
  costPriceMilli: MilliOMR;
  sellingPriceMilli: MilliOMR;
  internalNotes: string;
  status: LifecycleStatus;
}

export interface PackageTemplate {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  defaultGuestCount: number;
  status: LifecycleStatus;
}

export interface PackageItem {
  id: string;
  organizationId: string;
  packageId: string;
  catalogItemId: string;
  quantityMilli: MilliOMR;
  sortOrder: number;
}

export interface EventRecord {
  id: string;
  organizationId: string;
  customerId: string;
  eventNumber: string;
  eventType: EventType;
  title: string;
  status: EventStatus;
  startAt: string;
  endAt: string;
  teamArrivalAt: string | null;
  guestCount: number;
  venueName: string;
  address: string;
  mapUrl: string;
  contactName: string;
  contactPhone: string;
  notes: string;
  cancellationReason: string;
  acceptedQuotationId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventStatusHistory {
  id: string;
  organizationId: string;
  eventId: string;
  fromStatus: EventStatus | null;
  toStatus: EventStatus;
  actorId: string;
  reason: string;
  createdAt: string;
}

export interface EventPricingLine {
  id: string;
  organizationId: string;
  eventId: string;
  sourceCatalogItemId: string | null;
  sourcePackageId: string | null;
  description: string;
  itemType: CatalogItemType;
  unit: string;
  pricingMethod: PricingMethod;
  quantityMilli: MilliOMR;
  unitSellingPriceMilli: MilliOMR;
  unitExpectedCostMilli: MilliOMR;
  sellingTotalMilli: MilliOMR;
  expectedCostTotalMilli: MilliOMR;
  isCustom: boolean;
  notes: string;
  sortOrder: number;
}

export interface Quotation {
  id: string;
  organizationId: string;
  eventId: string;
  quotationNumber: string;
  version: number;
  status: QuotationStatus;
  issuedAt: string;
  issuedBy: string;
  customerNameSnapshot: string;
  customerPhoneSnapshot: string;
  eventNumberSnapshot: string;
  eventTitleSnapshot: string;
  guestCountSnapshot: number;
  startAtSnapshot: string;
  endAtSnapshot: string;
  venueSnapshot: string;
  addressSnapshot: string;
  notes: string;
  terms: string;
  sellingTotalMilli: MilliOMR;
  expectedCostTotalMilli: MilliOMR;
  expectedProfitMilli: MilliOMR;
}

export interface QuotationLine {
  id: string;
  organizationId: string;
  quotationId: string;
  description: string;
  itemType: CatalogItemType;
  unit: string;
  pricingMethod: PricingMethod;
  quantityMilli: MilliOMR;
  unitSellingPriceMilli: MilliOMR;
  unitExpectedCostMilli: MilliOMR;
  sellingTotalMilli: MilliOMR;
  expectedCostTotalMilli: MilliOMR;
  isCustom: boolean;
  sortOrder: number;
}

export interface StaffMember {
  id: string;
  organizationId: string;
  name: string;
  phone: string;
  whatsapp: string;
  staffType: StaffType;
  isActive: boolean;
  defaultCompensationMethod: CompensationMethod;
  defaultRateMilli: MilliOMR;
  notes: string;
}

export interface StaffAssignment {
  id: string;
  organizationId: string;
  eventId: string;
  staffMemberId: string;
  assignmentRole: StaffType;
  scheduledStart: string;
  scheduledEnd: string;
  arrivalAt: string | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  compensationMethod: CompensationMethod;
  rateMilli: MilliOMR;
  expectedCompensationMilli: MilliOMR;
  status: AssignmentStatus;
  notes: string;
}

export interface EquipmentStock {
  id: string;
  organizationId: string;
  catalogItemId: string;
  totalQuantity: number;
  isActive: boolean;
}

export interface EquipmentReservation {
  id: string;
  organizationId: string;
  eventId: string;
  catalogItemId: string;
  quantity: number;
  reservedFrom: string;
  reservedUntil: string;
  status: ReservationStatus;
  createdBy: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  organizationId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  meta: Record<string, unknown>;
}

export interface Sequence {
  organizationId: string;
  kind: "event" | "quotation";
  year: number;
  lastValue: number;
}

export interface AppState {
  version: 4;
  organizations: Organization[];
  profiles: Profile[];
  memberships: Membership[];
  customers: Customer[];
  categories: CatalogCategory[];
  catalogItems: CatalogItem[];
  packages: PackageTemplate[];
  packageItems: PackageItem[];
  events: EventRecord[];
  eventHistory: EventStatusHistory[];
  pricingLines: EventPricingLine[];
  quotations: Quotation[];
  quotationLines: QuotationLine[];
  staffMembers: StaffMember[];
  staffAssignments: StaffAssignment[];
  equipmentStock: EquipmentStock[];
  equipmentReservations: EquipmentReservation[];
  auditEvents: AuditEvent[];
  sequences: Sequence[];
}

export interface Actor {
  profileId: string;
  organizationId: string;
  role: AppRole;
}

export interface EquipmentAvailability {
  catalogItemId: string;
  nameAr: string;
  totalQuantity: number;
  alreadyReserved: number;
  available: number;
  requested: number;
  shortage: number;
}

export interface StaffAvailability {
  staffMemberId: string;
  available: boolean;
  reason: string | null;
  conflictingEventNumber: string | null;
  conflictingFrom: string | null;
  conflictingUntil: string | null;
}

export interface ReadinessIssue {
  code: "PRICING_MISSING" | "STAFF_MISSING" | "EQUIPMENT_SHORTAGE" | "STAFF_CONFLICT";
  message: string;
}

export interface EventReadiness {
  state:
    | "READY"
    | "PRICING_MISSING"
    | "STAFF_MISSING"
    | "EQUIPMENT_SHORTAGE"
    | "MULTIPLE_ISSUES"
    | "NOT_CONFIRMED";
  issues: ReadinessIssue[];
}

export interface CustomerQuoteView {
  officeName: string;
  officePhone: string;
  officeCity: string;
  quotationNumber: string;
  version: number;
  issuedAt: string;
  customerName: string;
  eventNumber: string;
  eventTitle: string;
  guestCount: number;
  schedule: string;
  venue: string;
  address: string;
  notes: string;
  terms: string;
  lines: Array<{
    description: string;
    quantityLabel: string;
    unitPriceMilli: MilliOMR;
    totalMilli: MilliOMR;
  }>;
  sellingTotalMilli: MilliOMR;
}
