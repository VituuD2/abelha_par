import { redirect } from "next/navigation";
import { getAccessContext } from "@/lib/access";
import { Header } from "@/components/layout/header";
import { ABCDashboard } from "@/components/analytics/abc-dashboard";
export default async function ABCPage() {
  const access = await getAccessContext().catch(() => null);
  if (!access) redirect("/login");
  return (
    <>
      <Header
        title="Curva ABC"
        subtitle="Descubra os produtos e clientes que concentram as vendas da operação."
        breadcrumbs={["Abelha Par", "Curva ABC"]}
      />
      <ABCDashboard isAdmin={access.role === "admin"} />
    </>
  );
}
