// Shared helpers for Dugout's server functions (Supabase Edge Functions, Deno).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

export const env = (k: string, d = '') => Deno.env.get(k) ?? d;
const ORIGINS = env('ALLOWED_ORIGINS', 'https://dugout-one-sand.vercel.app').split(',').map(s => s.trim()).filter(Boolean);

export function cors(req: Request) {
  const o = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) || /^http:\/\/localhost(:\d+)?$/.test(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

// the service-role client: bypasses the database rules, so only ever used for the narrow updates below
export const admin = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

// who is calling: checks the person's sign-in token with Supabase
export async function caller(req: Request) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  return error ? null : data.user;
}

// a return address must be one of our own sites, so checkout can't be used to bounce people somewhere else
export function safeReturn(url: unknown) {
  try { const u = new URL(String(url)); if (ORIGINS.includes(u.origin) || /^http:\/\/localhost(:\d+)?$/.test(u.origin)) return u.origin + u.pathname; } catch (_) { /* fall through */ }
  return ORIGINS[0] + '/';
}

// Stripe's API, called directly (form-encoded), so there's no SDK to keep up to date
export async function stripe(path: string, params: Record<string, string> = {}, method = 'POST') {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: { Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : new URLSearchParams(params),
  });
  const body = await r.json();
  if (!r.ok) throw new Error('stripe: ' + (body?.error?.message ?? r.status));
  return body;
}
