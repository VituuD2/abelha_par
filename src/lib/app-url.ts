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

/**
 * OAuth state is stored in cookies on the domain that starts the flow. Its
 * callback must therefore return to that same domain, rather than a possibly
 * different canonical URL configured for jobs or webhooks.
 */
export function getRequestOrigin(request: Request) {
  return new URL(request.url).origin.replace(/\/$/, "");
}
