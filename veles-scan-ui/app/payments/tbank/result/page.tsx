type TBankResultPageProps = {
  searchParams: Promise<{ status?: string; orderId?: string }>;
};

export default async function TBankResultPage({ searchParams }: TBankResultPageProps) {
  const query = await searchParams;
  const status = (query.status ?? "").toLowerCase();
  const isSuccess = status === "success";

  return (
    <main className="min-h-screen bg-[#f5f7fb] px-4 py-8">
      <section className="mx-auto w-full max-w-xl rounded-2xl border border-[#d7deea] bg-white p-6 shadow-sm">
        <h1 className={`text-[24px] font-bold ${isSuccess ? "text-[#1f9f48]" : "text-[#c34a4a]"}`}>
          {isSuccess ? "Оплата завершена" : "Оплата не завершена"}
        </h1>

        <p className="mt-3 text-[14px] leading-6 text-[#4e5969]">
          {isSuccess
            ? "Платёж принят банком. Можете закрыть окно оплаты и вернуться в раздел финансов."
            : "Банк сообщил, что оплата не завершена. Закройте окно и попробуйте снова."}
        </p>

        {query.orderId ? (
          <p className="mt-3 rounded-md border border-[#e4e8f0] bg-[#f8faff] px-3 py-2 text-[12px] text-[#4e5969]">
            Заказ: {query.orderId}
          </p>
        ) : null}
      </section>
    </main>
  );
}
