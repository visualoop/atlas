import { convexAuthNextjsMiddleware, createRouteMatcher, nextjsMiddlewareRedirect } from "@convex-dev/auth/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/login",
  "/sign-up",
  "/verify(.*)",
  "/forgot-password",
  "/reset-password",
  "/invite/(.*)",
  "/share/(.*)",
  "/api/(.*)",
]);

// 180 days. Cookie survives browser restarts + laptop shutdowns.
// Default was `{ maxAge: null }` which makes the auth cookies
// session-only — deleted the moment the browser closes.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export default convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    const isAuthed = await convexAuth.isAuthenticated();
    if (!isPublicRoute(request) && !isAuthed) {
      return nextjsMiddlewareRedirect(request, "/login");
    }
    if (isPublicRoute(request) && isAuthed && request.nextUrl.pathname === "/login") {
      return nextjsMiddlewareRedirect(request, "/today");
    }
  },
  { cookieConfig: { maxAge: COOKIE_MAX_AGE_SECONDS } },
);

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
