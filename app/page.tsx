import { cookies } from "next/headers";
import { VariantProvider } from "@/components/variant-provider";
import { LandingPage } from "@/components/landing-page";

export default async function Home() {
  const cookieStore = await cookies();
  const variantCookie = cookieStore.get("wt_variant")?.value ?? null;
  return (
    <VariantProvider variantCookie={variantCookie}>
      <LandingPage />
    </VariantProvider>
  );
}
