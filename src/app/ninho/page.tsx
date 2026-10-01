import { redirect } from "next/navigation";
import { getAccessContext } from "@/lib/access";
import { Header } from "@/components/layout/header";
import { NinhoSettings } from "@/components/ninho/ninho-settings";

export default async function NinhoPage() {
  const access = await getAccessContext().catch(() => null);
  if (!access) redirect("/login");
  if (access.role !== "admin") redirect("/");
  return <>
    <Header title="Ninho" subtitle="Cuide das conexões e dos acessos da sua colmeia." breadcrumbs={["Abelha Par", "Ninho"]} />
    <NinhoSettings />
  </>;
}
