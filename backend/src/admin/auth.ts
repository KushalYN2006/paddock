import { randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';

export const ADMIN_SESSION_COOKIE = 'paddock_admin_session';
export const ADMIN_CSRF_COOKIE = 'paddock_admin_csrf';
const sessionLifetimeSeconds = 4 * 60 * 60;

export function equalSecret(candidate: string, expected: string) {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
}

export function createAdminSession() {
  return jwt.sign({ role: 'admin' }, env.JWT_SECRET, { expiresIn: sessionLifetimeSeconds, issuer: 'paddock', audience: 'paddock-admin' });
}

export function verifyAdminSession(token: string | undefined) {
  if (!token) return false;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { issuer: 'paddock', audience: 'paddock-admin' });
    return typeof payload === 'object' && payload.role === 'admin';
  } catch { return false; }
}

export function createCsrfToken() { return randomBytes(32).toString('hex'); }

function originIsTrusted(request: FastifyRequest) {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const configuredOrigin = new URL(env.CORS_ORIGIN);
    return originUrl.origin === configuredOrigin.origin || originUrl.host === request.headers.host;
  } catch { return false; }
}

export async function requireTrustedOrigin(request: FastifyRequest, reply: FastifyReply) {
  if (!originIsTrusted(request)) return reply.code(403).send({ error: { code: 'UNTRUSTED_ORIGIN', message: 'This request origin is not allowed.' } });
}

export async function requireAdminSession(request: FastifyRequest, reply: FastifyReply) {
  if (!env.ADMIN_ACCESS_KEY) return reply.code(503).send({ error: { code: 'ADMIN_NOT_CONFIGURED', message: 'Admin maintenance is disabled until an access key is configured.' } });
  if (!verifyAdminSession(request.cookies[ADMIN_SESSION_COOKIE])) return reply.code(401).send({ error: { code: 'ADMIN_AUTH_REQUIRED', message: 'An admin session is required.' } });
}

export async function requireAdminCsrf(request: FastifyRequest, reply: FastifyReply) {
  const cookie = request.cookies[ADMIN_CSRF_COOKIE];
  const header = request.headers['x-csrf-token'];
  if (!cookie || typeof header !== 'string' || !equalSecret(header, cookie)) return reply.code(403).send({ error: { code: 'CSRF_CHECK_FAILED', message: 'The admin request could not be verified.' } });
}

export function adminCookieOptions() {
  return { path: '/', sameSite: 'strict' as const, secure: env.NODE_ENV === 'production' };
}

export { sessionLifetimeSeconds };
