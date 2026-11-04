// Starts a Stripe Checkout for the captain plan (monthly) or removing ads (one payment).
// The price ids come from secrets, never from the browser, so nobody can pick their own price.
import { cors, json, caller, admin, stripe, env, safeReturn } from '../_shared/util.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method' }, 405);
  const user = await caller(req);
  if (!user) return json(req, { error: 'Sign in first' }, 401);
  const { product, return_url } = await req.json().catch(() => ({}));
  if (product !== 'captain' && product !== 'adfree') return json(req, { error: 'Unknown product' }, 400);
  const back = safeReturn(return_url);

  const db = admin();
  const { data: acct } = await db.from('accounts').select('stripe_customer, captain_status, ad_free, grandfathered').eq('user_id', user.id).single();
  if (product === 'captain' && (acct?.grandfathered || ['active', 'trialing', 'past_due'].includes(acct?.captain_status))) return json(req, { error: 'You’re already a captain' }, 409);
  if (product === 'adfree' && acct?.ad_free) return json(req, { error: 'Ads are already off' }, 409);

  let customer = acct?.stripe_customer;
  if (!customer) {
    customer = (await stripe('customers', { email: user.email ?? '', 'metadata[user_id]': user.id })).id;
    await db.from('accounts').update({ stripe_customer: customer }).eq('user_id', user.id);
  }
  const p: Record<string, string> = {
    customer, client_reference_id: user.id, 'metadata[user_id]': user.id, 'metadata[product]': product,
    'line_items[0][quantity]': '1', allow_promotion_codes: 'true',
    success_url: `${back}?paid=${product}`, cancel_url: back,
  };
  if (product === 'captain') {
    p.mode = 'subscription'; p['line_items[0][price]'] = env('STRIPE_PRICE_CAPTAIN');
    p['subscription_data[metadata][user_id]'] = user.id;
  } else {
    p.mode = 'payment'; p['line_items[0][price]'] = env('STRIPE_PRICE_ADFREE');
    p['payment_intent_data[metadata][user_id]'] = user.id;
  }
  try { const s = await stripe('checkout/sessions', p); return json(req, { url: s.url }); }
  catch (e) { console.error(e); return json(req, { error: 'Checkout is unavailable' }, 502); }
});
