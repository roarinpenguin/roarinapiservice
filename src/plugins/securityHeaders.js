'use strict';

// Built-in security-headers fallback (OWASP A05), mirroring the @fastify/helmet
// configuration in server.js. Used only when the @fastify/helmet dependency is
// not installed, so the service is never left without security headers.
//
// The CSP is deliberately tailored to the Alpine.js admin UI: Alpine is loaded
// from unpkg and relies on inline scripts/styles and expression evaluation
// (new Function), hence 'unsafe-inline' + 'unsafe-eval'. Cross-Origin-Resource-
// Policy is relaxed to cross-origin because this is a mock API meant to be
// consumed by anyone.

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
  'X-DNS-Prefetch-Control': 'off'
};

module.exports = { SECURITY_HEADERS, CONTENT_SECURITY_POLICY };
