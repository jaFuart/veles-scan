import { FinanceView } from "@/components/finance/FinanceView";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { requireViewer } from "@/lib/auth";
import { getFinanceData, getUserPromocodeUsage } from "@/lib/repositories";

type FinancePageProps = {
  searchParams: Promise<{
    promoError?: string;
    promoSuccess?: string;
    opPage?: string;
    paymentStatus?: string;
    paymentOrderId?: string;
  }>;
};

export default async function FinancePage({ searchParams }: FinancePageProps) {
  const viewer = await requireViewer();
  const query = await searchParams;
  const requestedPage = Number.isFinite(Number(query.opPage)) ? Math.max(1, Math.trunc(Number(query.opPage))) : 1;
  const finance = await getFinanceData(viewer.id, { page: requestedPage, limit: 10 });
  const promoUsage = await getUserPromocodeUsage(viewer.id);

  return (
    <DashboardLayout viewer={viewer}>
      <FinanceView
        balanceRub={finance.balanceRub}
        monthTopUp={finance.monthTopUp}
        monthDebit={finance.monthDebit}
        operations={finance.operations}
        operationsPage={finance.page}
        operationsTotal={finance.total}
        operationsTotalPages={finance.totalPages}
        promoError={query.promoError}
        promoSuccess={query.promoSuccess}
        promoUsage={promoUsage}
        paymentStatus={query.paymentStatus}
        paymentOrderId={query.paymentOrderId}
      />
    </DashboardLayout>
  );
}
