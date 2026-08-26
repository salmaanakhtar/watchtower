import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { VariantProvider } from "@/components/variant-provider";
import { ToolPage } from "@/components/tool-page";
import { getTool } from "@/lib/tools";
import { recordToolView } from "@/lib/experiments";

export const dynamic = "force-dynamic";

// WT-15: one shared page for the free vertical SEO tools. Each tool is
// registered in lib/tools.ts with its copy + preseeded example; this page is
// a thin wrapper over the same analyzer pipeline the landing page uses.

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) return {};
  return {
    title: tool.metaTitle,
    description: tool.metaDescription,
  };
}

export default async function ToolPageRoute({ params }: Params) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();

  // Funnel instrumentation: the page view is a tool_view event. Never breaks
  // rendering if the write fails.
  await recordToolView(tool.slug);

  const cookieStore = await cookies();
  const variantCookie = cookieStore.get("wt_variant")?.value ?? null;

  return (
    <VariantProvider variantCookie={variantCookie}>
      <ToolPage tool={tool} />
    </VariantProvider>
  );
}
