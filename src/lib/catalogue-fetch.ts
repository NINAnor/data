const AUTH_HEADER = "x-nina-e2e-token";

export function catalogueFetchOptions(
  url: string,
  apiRoot: string,
  token: string | undefined,
  accept?: string,
): RequestInit {
  const headers: Record<string, string> = {};
  if (accept) headers.Accept = accept;

  const isApiOrigin = new URL(url).origin === new URL(apiRoot).origin;
  const hasToken = Boolean(token && isApiOrigin);
  if (hasToken) headers[AUTH_HEADER] = token!;

  return {
    headers,
    ...(hasToken ? { redirect: "error" as const } : {}),
  };
}

export function fetchCatalogueResource(
  url: string,
  apiRoot: string,
  accept?: string,
): Promise<Response> {
  return fetch(url, catalogueFetchOptions(url, apiRoot, process.env.BYPASS_HEADER_VALUE, accept));
}
