import { Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { Boxes, Package, Users } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { useCatalogItems } from "@/features/catalog/catalog.api";
import { usePackages } from "@/features/packages/packages.api";
import { useCustomers } from "@/features/customers/customers.api";
import { eventReadinessQuery, useEvents } from "@/features/events/events.api";
import { OwnerVoiceButton } from "@/features/ownerVoice/OwnerVoiceButton";
import {
  buildHomeVoiceSummary,
  DEFAULT_TIME_ZONE,
  isSameLocalDay,
} from "@/features/ownerVoice/screenSummary";

export function HomePage() {
  const { profile, currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;

  const catalog = useCatalogItems(orgId);
  const packages = usePackages(orgId);
  const customers = useCustomers(orgId);
  const events = useEvents(orgId);

  const todayEvents = (events.data ?? []).filter(
    (e) =>
      e.status !== "CANCELLED" &&
      isSameLocalDay(e.start_at, new Date(), DEFAULT_TIME_ZONE),
  );
  const readinessQueries = useQueries({
    queries: todayEvents.map((e) => eventReadinessQuery(orgId, e.id)),
  });
  const readinessSettled =
    events.isSuccess && readinessQueries.every((q) => q.isFetched);
  const voiceSummary = readinessSettled
    ? buildHomeVoiceSummary({
        events: todayEvents.map((e, index) => ({
          ...e,
          readiness: readinessQueries[index]?.data ?? null,
        })),
      })
    : null;

  const name = profile?.full_name || "أهلاً بك";

  const counts = [
    {
      label: "صنف في الكتالوج",
      value: catalog.data?.length ?? "—",
      icon: Boxes,
      to: "/catalog",
    },
    {
      label: "باقة جاهزة",
      value: packages.data?.length ?? "—",
      icon: Package,
      to: "/packages",
    },
    {
      label: "عميل",
      value: customers.data?.length ?? "—",
      icon: Users,
      to: "/customers",
    },
  ];

  return (
    <div>
      <PageHeader
        title={`${name}، ${currentOrganization?.name ?? ""}`}
        description="مرحباً بك في نظام إدارة عمليات الضيافة"
        actions={<OwnerVoiceButton summary={voiceSummary} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {counts.map((c) => (
          <Link key={c.label} to={c.to} className="group">
            <Card className="p-5 transition-colors group-hover:border-brand-300">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-base text-slate-500">{c.label}</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">
                    {c.value}
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                  <c.icon className="h-6 w-6" />
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
