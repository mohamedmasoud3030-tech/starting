import { useState } from "react";
import { useAuth } from "@/app/authContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AgingSection } from "./AgingSection";
import { CustomerStatementSection } from "./CustomerStatementSection";
import { SupplierStatementSection } from "./SupplierStatementSection";

type AccountingSection = "aging" | "customer-statement" | "supplier-statement";

/**
 * Accounting surface (contract §20 Stage 3): AR / AP / contract-asset aging,
 * customer statement with allocation detail, and supplier statement. All
 * figures come from the 0094/0096 read models; the UI only presents them.
 * Non-cost roles see an explicit message — the server is the security
 * boundary regardless.
 */
export function AccountingPage() {
  const { currentOrganization, canReadCost } = useAuth();
  const [section, setSection] = useState<AccountingSection>("aging");

  if (!currentOrganization) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-lg font-bold text-slate-600">اختر منظمة لعرض المحاسبة.</p>
      </div>
    );
  }

  if (!canReadCost) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-lg font-bold text-slate-600">
          المحاسبة متاحة للصلاحيات المالية فقط.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          دورك الحالي لا يشمل الاطلاع على بيانات المحاسبة والتكاليف.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="المحاسبة"
        description="أعمار الذمم والأصول، وكشوف حساب العملاء والموردين من الدفاتر المحاسبية"
        actions={
          <SegmentedControl<AccountingSection>
            ariaLabel="قسم المحاسبة"
            value={section}
            onChange={setSection}
            options={[
              { value: "aging", label: "التقادم" },
              { value: "customer-statement", label: "كشف حساب عميل" },
              { value: "supplier-statement", label: "كشف حساب مورد" },
            ]}
          />
        }
      />

      {section === "aging" && <AgingSection />}
      {section === "customer-statement" && <CustomerStatementSection />}
      {section === "supplier-statement" && <SupplierStatementSection />}
    </div>
  );
}
