import { webLivenessResponse } from "../../health";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return webLivenessResponse();
}
