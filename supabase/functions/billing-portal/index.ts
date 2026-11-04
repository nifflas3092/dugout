// Opens Stripe's billing page, where captains change their card, see receipts or cancel.
import { cors, json, caller, admin, stripe, safeReturn } from '../_shared/util.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const user = await caller(req);
  if (!user) return json(req, { error: 'Sign in first' }, 401);
  const { return_url } = await req.json().catch(() => ({}));
  const { data } = await admin().from('accounts').select('stripe_customer').eq('user_id', user.id).single();
  if (!data?.stripe_customer) return json(req, { error: 'No plan to manage' }, 404);
  try { const s = await stripe('billing_portal/sessions', { customer: data.stripe_customer, return_url: safeReturn(return_url) }); return json(req, { url: s.url }); }
  catch (e) { console.error(e); return json(req, { error: 'Unavailable' }, 502); }
});
