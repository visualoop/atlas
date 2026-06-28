import { httpRouter } from "convex/server";
import { auth } from "./auth";

/**
 * HTTP router for Atlas.
 *
 * - Convex Auth registers its sign-in / callback / session routes here.
 * - Webhook endpoints (Paystack, Resend inbound, Meta WhatsApp, etc.)
 *   will be added in their respective phases.
 */

const http = httpRouter();

auth.addHttpRoutes(http);

export default http;
