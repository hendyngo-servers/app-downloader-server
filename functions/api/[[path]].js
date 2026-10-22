function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status: status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

async function proxyApi(request, env) {
  const backendValue = String(env.BACKEND_ORIGIN || "").trim().replace(/\/+$/, "");
  if (!backendValue) return jsonError("BACKEND_ORIGIN is not configured for this Pages project", 503);

  let backend;
  try {
    backend = new URL(backendValue);
  } catch (_) {
    return jsonError("BACKEND_ORIGIN must be a valid HTTPS URL", 500);
  }
  if (backend.protocol !== "https:" && backend.hostname !== "localhost" && backend.hostname !== "127.0.0.1") {
    return jsonError("BACKEND_ORIGIN must use HTTPS", 500);
  }

  const currentUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== currentUrl.origin) return jsonError("Cross-origin request blocked", 403);

  const targetUrl = new URL(currentUrl.pathname + currentUrl.search, backend);
  const upstream = new Request(targetUrl.toString(), request);
  const headers = new Headers(upstream.headers);
  headers.delete("host");
  headers.set("Origin", backend.origin);
  headers.set("X-Forwarded-Host", currentUrl.host);
  headers.set("X-Forwarded-Proto", currentUrl.protocol.slice(0, -1));
  try {
    return await fetch(new Request(upstream, { headers, redirect: "manual" }));
  } catch (error) {
    return jsonError("Backend temporarily unavailable; Render Free may be waking up. Retry shortly.", 502);
  }
}

export async function onRequest(context) {
  return proxyApi(context.request, context.env);
}
