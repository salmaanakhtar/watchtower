"use client";

import { createContext, useContext, useMemo } from "react";
import { VARIANTS } from "@/lib/variants";
import { hashVariant } from "@/lib/variant";

const VariantContext = createContext<{ variant: string; copy: (typeof VARIANTS)["A"] }>({
  variant: "A",
  copy: VARIANTS.A,
});

export function VariantProvider({
  children,
  variantCookie,
}: {
  children: React.ReactNode;
  variantCookie?: string | null;
}) {
  const value = useMemo(() => {
    const variant = (variantCookie && VARIANTS[variantCookie] ? variantCookie : hashVariant("local")) as string;
    return { variant, copy: VARIANTS[variant] };
  }, [variantCookie]);

  return <VariantContext.Provider value={value}>{children}</VariantContext.Provider>;
}

export function useVariant() {
  return useContext(VariantContext);
}
