import "server-only";

/**
 * Uses an explicit server-side URL when configured; otherwise derives the
 * origin from the current request. This keeps OAuth working on Vercel preview
 * and production deployments without exposing a required public env variable.
 */
export function getAppUrl(request: Request) {
  const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  return (configured || new URL(request.url).origin).replace(/\/$/, "");
}
