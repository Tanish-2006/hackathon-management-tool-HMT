const UPSTREAM = new URL('https://20-40-48-27.sslip.io');
const STRIPPED_RESPONSE_HEADERS = ['server', 'via', 'alt-svc', 'x-powered-by', 'report-to', 'nel'];
const STRIPPED_REQUEST_HEADERS = ['referer', 'x-forwarded-host'];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    STRIPPED_REQUEST_HEADERS.forEach((name) => headers.delete(name));
    if (headers.has('Origin')) headers.set('Origin', UPSTREAM.origin);

    const upstream = await fetch(new URL(url.pathname + url.search, UPSTREAM), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
      cache: 'no-store',
    });

    const responseHeaders = new Headers(upstream.headers);
    STRIPPED_RESPONSE_HEADERS.forEach((name) => responseHeaders.delete(name));
    for (const name of ['location', 'access-control-allow-origin', 'content-location']) {
      const value = responseHeaders.get(name);
      if (value) responseHeaders.set(name, value.replaceAll(UPSTREAM.origin, url.origin));
    }
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  },
};
