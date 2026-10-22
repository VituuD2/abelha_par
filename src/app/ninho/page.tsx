import { requirePagePermission } from "@/lib/page-access";
import { Header } from "@/components/layout/header";
import { NinhoSettings } from "@/components/ninho/ninho-settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NinhoPage() {
  await requirePagePermission("ninho:access");
  return <>
    <Header title="Ninho" breadcrumbs={["Abelha Par", "Ninho"]} description="Gerencie as conexões da colmeia e os acessos da equipe." />
    <NinhoSettings />
  </>;
}
