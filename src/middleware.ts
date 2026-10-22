import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { can, permissionForPage } from "@/lib/permissions";
import { readSupabaseUser } from "@/lib/supabase/auth-user";
import { AUTH_TIMEOUT_MS, MEMBERSHIP_TIMEOUT_MS, createSupabaseFetch } from "@/lib/supabase/request";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: createSupabaseFetch(AUTH_TIMEOUT_MS) },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );
  let user;
  try {
    user = await readSupabaseUser(supabase);
  } catch {
    const unavailable = new NextResponse("A verificação da sessão está temporariamente indisponível. Recarregue para tentar novamente.", {
      status: 503, headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "Retry-After": "5" },
    });
    response.cookies.getAll().forEach(cookie => unavailable.cookies.set(cookie));
    return unavailable;
  }

  const publicAuthRoutes = ["/login", "/forgot-password", "/reset-password"];

  if (!user && !publicAuthRoutes.includes(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    return redirect;
  }
  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    return redirect;
  }
  const permission = permissionForPage(request.nextUrl.pathname);
  if (permission && user) {
    // User-scoped client/RLS; never put the service key in the edge middleware.
    let allowed = false;
    try {
      const { data, error } = await supabase.from("workspace_members")
        .select("workspace_id,role,active").eq("user_id", user.id)
        .abortSignal(AbortSignal.timeout(MEMBERSHIP_TIMEOUT_MS)).maybeSingle();
      allowed = !error && !!data?.workspace_id && data.active === true && can(data.role, permission);
    } catch { /* Unavailable permissions deny access; server guards also recheck. */ }
    if (!allowed) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      const denied = NextResponse.redirect(url);
      response.cookies.getAll().forEach(cookie => denied.cookies.set(cookie));
      denied.headers.set("Cache-Control", "private, no-store, max-age=0");
      denied.headers.set("Vary", "Cookie");
      return denied;
    }
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Vary", "Cookie");
  }
  return response;
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
