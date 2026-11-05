/* Slowpitch Showdown on Dugout: ranked games and the leaderboard.
   Site-only (the sync script never overwrites this file). The game looks for window.SHOWDOWN_NET;
   without it (the standalone game) ranked play is simply hidden. Uses the same Dugout sign-in as the app. */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const sb = window.supabase && window.supabase.createClient && !SUPABASE_URL.includes('YOUR-PROJECT')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  : null;

if (sb) {
  let name = null;
  const fail = e => new Error((e && e.message) || 'the leaderboard couldn’t be reached');
  async function refresh() {
    const { data } = await sb.auth.getSession();
    const u = data && data.session && data.session.user;
    if (!u) name = null;
    else {
      const { data: p } = await sb.from('profiles').select('display_name').eq('id', u.id).maybeSingle();
      name = (p && p.display_name) || 'You';
    }
    dispatchEvent(new Event('showdown-net'));
  }
  window.SHOWDOWN_NET = {
    user: () => name,
    async start() { const { data, error } = await sb.rpc('ranked_start'); if (error) throw fail(error); return data; },
    async finish(id, r) {
      const { error } = await sb.rpc('ranked_finish', { p_game: id, p_won: r.won, p_strikeouts: r.strikeouts, p_home_runs: r.home_runs, p_runs_for: r.runs_for, p_runs_against: r.runs_against });
      if (error) throw fail(error);
    },
    async board(stat) { const { data, error } = await sb.rpc('game_leaderboard', { p_stat: stat }); if (error) throw fail(error); return data || []; },
  };
  sb.auth.onAuthStateChange(() => { refresh(); });
  refresh();
}
