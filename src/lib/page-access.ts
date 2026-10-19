import "server-only";
import { redirect } from "next/navigation";
import { getAccessContext } from "./access";
import { can, type Permission } from "./permissions";

/** Never rely solely on middleware, a reused layout, or a client-side menu. */
export async function requirePagePermission(permission: Permission) {
  const access = await getAccessContext();
  if (!access) redirect("/login");
  if (!can(access.role, permission)) redirect("/");
  return access;
}
