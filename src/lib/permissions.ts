/** Shared policy only. The server obtains the role from active workspace membership. */
export type Role = "admin" | "operator";
export const PERMISSIONS = [
  "app:access", "ninho:access", "members:manage", "integrations:manage",
  "analytics:read", "analytics:export", "analytics:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
const operatorPermissions: readonly Permission[] = Object.freeze([
  "app:access", "analytics:read", "analytics:export",
]);
const adminPermissions: readonly Permission[] = Object.freeze([...PERMISSIONS]);

export function permissionsFor(role: unknown): readonly Permission[] {
  return role === "admin" ? adminPermissions : role === "operator" ? operatorPermissions : [];
}
export function can(role: unknown, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}
export function permissionForPage(pathname: string): Permission | null {
  return pathname === "/ninho" || pathname.startsWith("/ninho/") ? "ninho:access" : null;
}
