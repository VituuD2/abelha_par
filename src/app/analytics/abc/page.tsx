import { redirect } from "next/navigation";
import { getAccessContext } from "@/lib/access";
import { ABCDashboard } from "@/components/analytics/abc-dashboard";
import { can } from "@/lib/permissions";
import { hasCompositionCatalog } from "@/lib/analytics/composition-server";
export default async function ABCPage() {
  const access = await getAccessContext().catch(() => null);
  if (!access) redirect("/login");
  return (
    <>
      <ABCDashboard
        isAdmin={can(access.role, "ninho:access")}
        initialGrouping={hasCompositionCatalog(access.workspaceId) ? "composition" : "product"}
      />
    </>
  );
}
