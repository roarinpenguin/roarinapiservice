'use strict';

// Minimal in-memory fixed-window rate limiter (no external dependency).
//
// Scope: per-instance. In the AWS deployment the ALB + WAF already rate-limit by
// true source IP globally (see the WAF rate-based rules), so this is
// defense-in-depth for the app itself — it protects the auth endpoints
// (login/setup brute force, H2) even when the app is reached without the WAF in
// front (local runs, direct access). With N instances the effective ceiling is
// N x max, which is fine for brute-force slowdown.
//
// Keying on request.ip requires Fastify `trustProxy` so the client IP (not the
// ALB IP) is used; the instance security group only accepts traffic from the
// ALB, so X-Forwarded-For is trustworthy in that path.

function createRateLimiter({ name, max, windowMs }) {
  const buckets = new Map(); // key -> { count, resetAt }

  // Periodically drop expired buckets so the map can't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (now > b.resetAt) buckets.delete(key);
    }
  }, windowMs);
  if (sweep.unref) sweep.unref();

  // Core decision (pure enough to unit test): count this hit, decide allow/deny.
  function hit(key, now = Date.now()) {
    let b = buckets.get(key);
    if (!b || now > b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    return {
      allowed: b.count <= max,
      remaining: Math.max(0, max - b.count),
      retryAfterMs: Math.max(0, b.resetAt - now)
    };
  }

  // Fastify preHandler.
  async function preHandler(request, reply) {
    const { allowed, retryAfterMs } = hit(`${name}:${request.ip}`);
    if (!allowed) {
      reply.header('Retry-After', Math.ceil(retryAfterMs / 1000));
      reply.code(429).send({ error: 'Too many requests. Please slow down and try again later.' });
      return reply;
    }
  }

  return { preHandler, hit, _buckets: buckets };
}

module.exports = { createRateLimiter };
