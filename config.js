/* Fill these in from your Supabase project: Dashboard → Project Settings → API Keys (use the publishable key, never a secret key).
   Both values are meant to be public; the security rules in supabase/schema.sql are what protect the data. */
export const SUPABASE_URL = 'https://btshfjneizmnqgkrcwvb.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_GeIWs5Lhvlufh5IglS8duw_KKfpBkW-';  // the publishable key: safe in the browser

/* Place lookup for the sub search. 'nominatim' is free (OpenStreetMap, fine for a small league).
   For heavier use, make a free Mapbox account, paste a public token here and set GEOCODER to 'mapbox'. */
export const GEOCODER = 'nominatim';
export const MAPBOX_TOKEN = '';
