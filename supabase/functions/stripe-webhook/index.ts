// Stripe tells us here when someone pays, renews, or cancels. This is the only thing that can change a plan.
// Deploy with --no-verify-jwt (Stripe doesn't send a Supabase sign-in); the Stripe signature check below is the lock instead.
import { admin, env } from '../_shared/util.ts';

const enc = new TextEncoder();
async function verify(raw: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(',').map(kv => kv.split('=') as [string, string]).filter(x => x.length === 2 && x[0] === 't'));
  const sigs = header.split(',').filter(x => x.startsWith('v1=')).map(x => x.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !sigs.length) return false;     // older than 5 minutes: a replay
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${raw}`)));
  const hex = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  return sigs.some(s => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);  // constant time
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  const raw = await req.text();
  if (!(await verify(raw, req.headers.get('stripe-signature') ?? '', env('STRIPE_WEBHOOK_SECRET')))) return new Response('bad signature', { status: 400 });
  const ev = JSON.parse(raw), o = ev.data?.object ?? {}, db = admin();
  const byCustomer = (c: string) => db.from('accounts').select('user_id').eq('stripe_customer', c).maybeSingle();

  if (ev.type === 'checkout.session.completed') {
    const uid = o.client_reference_id ?? o.metadata?.user_id;
    if (uid && o.metadata?.product === 'adfree' && o.payment_status === 'paid')
      await db.from('accounts').update({ ad_free: true, stripe_customer: o.customer, updated_at: new Date().toISOString() }).eq('user_id', uid);
    if (uid && o.metadata?.product === 'captain')
      await db.from('accounts').update({ captain_status: 'active', captain_until: null, stripe_customer: o.customer, updated_at: new Date().toISOString() }).eq('user_id', uid);
  }
  if (ev.type.startsWith('customer.subscription.')) {
    const { data } = await byCustomer(o.customer);
    const uid = data?.user_id ?? o.metadata?.user_id;
    if (uid) {
      const status = ev.type === 'customer.subscription.deleted' ? 'canceled'
        : ['active', 'trialing', 'past_due'].includes(o.status) ? o.status : 'canceled';
      const end = o.current_period_end ?? o.items?.data?.[0]?.current_period_end;
      await db.from('accounts').update({ captain_status: status, captain_until: end ? new Date(end * 1000).toISOString() : null, updated_at: new Date().toISOString() }).eq('user_id', uid);
    }
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});
