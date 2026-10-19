import { requirePagePermission } from "@/lib/page-access";

export default async function NinhoLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("ninho:access");
  return children;
}
