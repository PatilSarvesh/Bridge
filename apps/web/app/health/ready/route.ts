import { webReadinessResponse } from "../../health";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return webReadinessResponse({ requestOrigin: new URL(request.url).origin });
}
