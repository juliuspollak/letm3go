// Gateway JWT verification stays enabled. This reports function liveness only.
Deno.serve((request: Request) => {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  return Response.json({ service: 'letm3go', status: 'ok' });
});
