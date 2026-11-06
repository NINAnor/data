import { EndpointError } from "@camptocamp/ogc-client";

export function isCrossOriginError(error: unknown): boolean {
  return error instanceof EndpointError && error.isCrossOriginRelated === true;
}

export function apiErrorMessage(body: string, status: number, statusText: string): string {
  try {
    const payload: unknown = JSON.parse(body);
    if (payload && typeof payload === "object") {
      const { code, description } = payload as { code?: unknown; description?: unknown };
      if (typeof code === "string" && typeof description === "string") {
        return `${code}: ${description}`;
      }
      if (typeof description === "string") return description;
      if (typeof code === "string") return code;
    }
  } catch {
    // Non-JSON API responses fall through to the HTTP status.
  }
  return `${status} ${statusText}`.trim();
}
