const UPSTREAM = 'https://20-40-48-27.sslip.io';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, UPSTREAM);
    const headers = new Headers(request.headers);
    if (headers.has('Origin')) headers.set('Origin', target.origin);
    return fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    });
  },
};
