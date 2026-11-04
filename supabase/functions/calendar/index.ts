// A private calendar feed (iCalendar) of all your teams' games, with the diamond's address and map pin.
// Calendar apps fetch it without signing in, so the long random token in the link is the key. Deploy with --no-verify-jwt.
import { admin } from '../_shared/util.ts';
// deno-lint-ignore-file no-explicit-any

const esc = (s: unknown) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,73}/g)!.join('\r\n ');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

Deno.serve(async req => {
  const t = new URL(req.url).searchParams.get('t') ?? '';
  if (!/^[0-9a-f]{64}$/.test(t)) return new Response('Not found', { status: 404 });
  const db = admin();
  const { data: acct } = await db.from('accounts').select('user_id').eq('cal_token', t).maybeSingle();
  if (!acct) return new Response('Not found', { status: 404 });
  const { data: mem } = await db.from('team_members').select('team_id, teams(name)').eq('user_id', acct.user_id);
  const ids = (mem ?? []).map((m: any) => String(m.team_id));
  const names = Object.fromEntries((mem ?? []).map((m: any) => [String(m.team_id), (m.teams as { name?: string } | null)?.name ?? 'Team']));
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const { data: games } = ids.length ? await db.from('docs').select('scope, id, data').in('scope', ids).eq('col', 'games').gte('data->>date', since) : { data: [] };
  const diaIds = [...new Set((games ?? []).map((g: any) => g.data?.diamond).filter(Boolean))];
  const { data: dias } = diaIds.length ? await db.from('docs').select('id, data').eq('scope', 'global').eq('col', 'diamonds').in('id', diaIds) : { data: [] };
  const dia = Object.fromEntries((dias ?? []).map((d: any) => [d.id, d.data]));

  const now = stamp(new Date()), L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dugout//Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Dugout games', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H', 'X-WR-TIMEZONE:America/Toronto'];
  for (const g of (games ?? []) as any[]) {
    const d = g.data ?? {}, team = names[g.scope], where = dia[d.diamond];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
    const day = d.date.replace(/-/g, '');
    const lat = where?.lat ?? d.lat, lng = where?.lng ?? d.lng;
    const loc = [d.field, where?.name, where?.address || where?.label].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    const status = d.status === 'rainout' ? 'CANCELLED' : 'CONFIRMED';
    L.push('BEGIN:VEVENT', `UID:${g.scope}-${g.id}@dugout`, `DTSTAMP:${now}`);
    if (/^\d{2}:\d{2}$/.test(d.time ?? '')) {
      const [h, m] = d.time.split(':').map(Number), end = h * 60 + m + 75;
      L.push(`DTSTART;TZID=America/Toronto:${day}T${d.time.replace(':', '')}00`, `DTEND;TZID=America/Toronto:${day}T${String(Math.floor(end / 60) % 24).padStart(2, '0')}${String(end % 60).padStart(2, '0')}00`);
    } else L.push(`DTSTART;VALUE=DATE:${day}`);
    L.push(fold(`SUMMARY:${d.status === 'rainout' ? 'RAINED OUT: ' : ''}${esc(team)} ${d.home === false ? 'at' : 'vs'} ${esc(d.opp)}`));
    if (loc) L.push(fold(`LOCATION:${esc(loc)}`));
    if (typeof lat === 'number' && typeof lng === 'number') L.push(`GEO:${lat};${lng}`, fold(`URL:https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`));
    L.push(fold(`DESCRIPTION:${esc(`${team} ${d.home === false ? 'away' : 'home'} game vs ${d.opp}.${typeof lat === 'number' ? ` Directions: https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : ''}`)}`), `STATUS:${status}`, 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return new Response(L.join('\r\n') + '\r\n', { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900' } });
});
