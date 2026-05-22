import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Run on every request except:
    //   - /api/*           webhooks (Inngest's signing key authenticates inside the route handler)
    //   - /_next/static/*  Next.js static assets
    //   - /_next/image/*   image optimization
    //   - favicon.ico, image extensions
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
