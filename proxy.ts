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

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const isAuthed = await convexAuth.isAuthenticated();
  if (!isPublicRoute(request) && !isAuthed) {
    return nextjsMiddlewareRedirect(request, "/login");
  }
  if (isPublicRoute(request) && isAuthed && request.nextUrl.pathname === "/login") {
    return nextjsMiddlewareRedirect(request, "/today");
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
