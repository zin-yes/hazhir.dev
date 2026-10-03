import type { ButtonHTMLAttributes, ReactNode } from "react";

type MenuButtonVariant = "primary" | "secondary" | "danger";

const BUTTON_VARIANT_CLASSES: Record<MenuButtonVariant, string> = {
  primary: "bg-emerald-400 text-black hover:bg-emerald-300",
  secondary: "bg-white/10 text-white hover:bg-white/20",
  danger: "bg-red-500/20 text-red-300 hover:bg-red-500/40",
};

interface MenuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: MenuButtonVariant;
}

export function MenuButton({
  variant = "secondary",
  className = "",
  ...buttonProps
}: MenuButtonProps) {
  return (
    <button
      data-mobile-ui
      {...buttonProps}
      className={`rounded-md px-4 py-2.5 text-sm font-bold transition active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none ${BUTTON_VARIANT_CLASSES[variant]} ${className}`}
    />
  );
}

export function MenuPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-mobile-ui
      className={`w-full max-w-xl rounded-xl border border-white/15 bg-zinc-950/90 p-5 shadow-2xl backdrop-blur-sm sm:p-6 ${className}`}
    >
      {children}
    </div>
  );
}

export function KeyCap({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block whitespace-nowrap rounded border-b-2 border-neutral-400 bg-white px-2 py-0.5 text-xs text-black">
      {children}
    </span>
  );
}

export function MenuBackdrop({
  children,
  onBackdropClick,
}: {
  children: ReactNode;
  onBackdropClick?: () => void;
}) {
  return (
    <div
      data-mobile-ui
      className="absolute inset-0 z-40 flex flex-col items-center overflow-y-auto bg-black/65 p-4 backdrop-blur-[2px] sm:p-8"
      onClick={(event) => {
        if (event.target === event.currentTarget) onBackdropClick?.();
      }}
    >
      <div
        className="my-auto flex w-full flex-col items-center gap-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) onBackdropClick?.();
        }}
      >
        {children}
      </div>
    </div>
  );
}
