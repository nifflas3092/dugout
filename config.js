/* Fill these in from your Supabase project: Dashboard → Project Settings → API Keys (use the publishable key, never a secret key).
   Both values are meant to be public; the security rules in supabase/schema.sql are what protect the data. */
export const SUPABASE_URL = 'https://btshfjneizmnqgkrcwvb.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_GeIWs5Lhvlufh5IglS8duw_KKfpBkW-';  // the publishable key: safe in the browser

/* Place lookup for the sub search. 'nominatim' is free (OpenStreetMap, fine for a small league).
   For heavier use, make a free Mapbox account, paste a public token here and set GEOCODER to 'mapbox'. */
export const GEOCODER = 'nominatim';
export const MAPBOX_TOKEN = '';

/* Plans. The prices shown in the app: the real charge is set on the Stripe prices (see README, "Get paid").
   Players are free. Captains pay monthly to start teams and see the full sub list, and see no ads. Anyone can remove ads with one payment. */
export const CAPTAIN_PRICE = '$5/month';
export const ADFREE_PRICE = '$7.99';

/* Google Maps for the Diamonds tab. Works without a key (basic embedded maps). For the official, unlimited and free
   Maps Embed API, create a key in Google Cloud (README, "Google Maps") and paste it here. It's public by design:
   lock it to your website's address in Google Cloud so nobody else can use it. */
export const GOOGLE_MAPS_KEY = '';
