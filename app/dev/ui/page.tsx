import { notFound } from "next/navigation";
import { StaffGallery } from "@/components/dev/StaffGallery";

export default async function DevGalleryPage({ searchParams }: PageProps<"/dev/ui">) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  const { view } = await searchParams;
  return <StaffGallery view={typeof view === "string" ? view : undefined} />;
}
