import { MdCropFree } from "react-icons/md";

type AppLogoProps = {
  centered?: boolean;
};

export function AppLogo({ centered = false }: AppLogoProps) {
  return (
    <div className={`flex items-center gap-2 ${centered ? "justify-center" : ""}`}>
      <MdCropFree className="h-[34px] w-[34px] md:h-[38px] md:w-[38px] 2xl:h-[44px] 2xl:w-[44px]" />
      <span className="text-[20px] leading-none font-medium md:text-[30px] 2xl:text-[34px]">
        veleSScan
      </span>
    </div>
  );
}
