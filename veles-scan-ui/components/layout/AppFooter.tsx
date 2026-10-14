import { OFFER_URL, PRIVACY_POLICY_URL } from "@/lib/legal";

export function AppFooter() {
  return (
    <footer className="py-6 text-center text-[12px] text-[#b5b5b5] md:text-[14px]">
      <div>Copyright - Veles Technologies 2026</div>
      <div className="mt-2 flex items-center justify-center gap-4">
        <a
          href={OFFER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#8fb5ff] hover:underline"
        >
          Оферта
        </a>
        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#8fb5ff] hover:underline"
        >
          Политика конфиденциальности
        </a>
        <span>
          Оператор ПД{" "}
          <a
            href="https://pd.rkn.gov.ru/operators-registry/operators-list/?id=77-25-510991"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#8fb5ff] hover:underline"
          >
            №77-25-510991
          </a>
        </span>
      </div>
    </footer>
  );
}
