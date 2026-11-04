/* Dugout's icon set: one consistent line style (24-unit grid, 1.6 stroke, rounded ends), drawn in currentColor
   so icons take the colour of the text around them. Use icon('rain') in templates; it returns inline SVG. */

const P = {
  // navigation
  home: '<path d="M3.5 10.5 12 3.8l8.5 6.7"/><path d="M5.5 9v10.7h13V9"/><path d="M10 19.7v-5.2h4v5.2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.8h17M8 3v4M16 3v4"/><path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2"/>',
  lineup: '<rect x="5" y="4.5" width="14" height="16.5" rx="1.8"/><path d="M9 4.5V3.8c0-.7.5-1.3 1.2-1.3h3.6c.7 0 1.2.6 1.2 1.3v.7z"/><path d="M8.5 10h.01M8.5 13.5h.01M8.5 17h.01" stroke-width="2.1"/><path d="M11 10h4.5M11 13.5h4.5M11 17h4.5"/>',
  score: '<path d="M12 3.5 20.5 12 12 20.5 3.5 12z"/><path d="M12 8.6 15.4 12 12 15.4 8.6 12z"/>',
  team: '<circle cx="9" cy="8" r="3.3"/><path d="M3 19.5c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2"/><path d="M15.2 4.9a3.2 3.2 0 0 1 0 6.2M17.3 14.4c2 .6 3.4 2.3 3.8 5.1"/>',
  chat: '<path d="M20.5 11.6c0 4.2-3.8 7.6-8.5 7.6-1.2 0-2.3-.2-3.3-.6L3.6 20l1.3-3.9c-.9-1.3-1.4-2.8-1.4-4.5C3.5 7.4 7.3 4 12 4s8.5 3.4 8.5 7.6Z"/><path d="M8.2 11.7h.01M12 11.7h.01M15.8 11.7h.01" stroke-width="2.2"/>',
  stats: '<path d="M3.5 20.5h17"/><path d="M6.5 20.5v-6M11 20.5V9.5M15.5 20.5v-8M20 20.5V5"/>',
  board: '<path d="M4 9.2v5.6c0 .6.5 1 1 1h2.2l6.8 4V4.2L7.2 8.2H5c-.5 0-1 .4-1 1Z"/><path d="M17.3 9.3a4 4 0 0 1 0 5.4M19.6 7a7.2 7.2 0 0 1 0 10"/>',
  subs: '<circle cx="10.5" cy="10.5" r="6.3"/><path d="m15.2 15.2 5.3 5.3"/><circle cx="10.5" cy="9" r="2"/><path d="M7.3 14.3c.6-1.4 1.8-2.2 3.2-2.2s2.6.8 3.2 2.2"/>',
  pin: '<path d="M12 21s-6.8-6.1-6.8-11.2a6.8 6.8 0 0 1 13.6 0C18.8 14.9 12 21 12 21Z"/><circle cx="12" cy="9.8" r="2.4"/>',
  gear: '<path d="M5.5 8.5h13l-1 11.3a1 1 0 0 1-1 .9h-9a1 1 0 0 1-1-.9z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  display: '<path d="M3.5 18.5 8 6.5l4.5 12M5.2 14.2h5.6"/><path d="M14.5 11.6a2.6 2.6 0 0 1 5 1.2v5.7M19.5 15.2c-3.2-.4-5.2.3-5.2 1.9 0 1.1.9 1.6 1.9 1.6 1.5 0 2.7-1 3.3-2"/>',
  // status and details
  alert: '<path d="M10.3 4.3 2.9 17.6a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4.3M12 17.2h.01" stroke-width="2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.9h.01" stroke-width="2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.3V12l3.2 2"/>',
  timer: '<circle cx="12" cy="13.5" r="7.2"/><path d="M12 13.5V9.8M10 2.8h4M18.6 6.9l1.2-1.2"/>',
  users: '<circle cx="9" cy="8" r="3.3"/><path d="M3 19.5c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2"/><path d="M15.2 4.9a3.2 3.2 0 0 1 0 6.2M17.3 14.4c2 .6 3.4 2.3 3.8 5.1"/>',
  ball: '<circle cx="12" cy="12" r="8.5"/><path d="M6.3 5.7c2 1.6 3.1 3.8 3.1 6.3s-1.1 4.7-3.1 6.3M17.7 5.7c-2 1.6-3.1 3.8-3.1 6.3s1.1 4.7 3.1 6.3"/>',
  // weather
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  moon: '<path d="M19.5 14.3A7.8 7.8 0 0 1 9.7 4.5a7.8 7.8 0 1 0 9.8 9.8Z"/>',
  cloud: '<path d="M7.2 18.5h10.3a3.8 3.8 0 0 0 .4-7.6 5.6 5.6 0 0 0-10.9 1.3 3.2 3.2 0 0 0 .2 6.3Z"/>',
  partly: '<path d="M9 3.5v1.4M3.5 9h1.4M5.1 5.1l1 1M12.9 5.1l-1 1"/><path d="M6.4 11.3a3.6 3.6 0 0 1 6.2-3.4"/><path d="M9 20h8.6a3.2 3.2 0 0 0 .3-6.4 4.7 4.7 0 0 0-9.1 1.1A2.7 2.7 0 0 0 9 20Z"/>',
  rain: '<path d="M7.2 14.5h10.3a3.8 3.8 0 0 0 .4-7.6 5.6 5.6 0 0 0-10.9 1.3 3.2 3.2 0 0 0 .2 6.3Z"/><path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>',
  snow: '<path d="M7.2 14.5h10.3a3.8 3.8 0 0 0 .4-7.6 5.6 5.6 0 0 0-10.9 1.3 3.2 3.2 0 0 0 .2 6.3Z"/><path d="M8.5 18.5h.01M12 20h.01M15.5 18.5h.01" stroke-width="2.2"/>',
  storm: '<path d="M7.2 14.5h10.3a3.8 3.8 0 0 0 .4-7.6 5.6 5.6 0 0 0-10.9 1.3 3.2 3.2 0 0 0 .2 6.3Z"/><path d="m12.8 14.5-2 3.4h3l-2 3.4"/>',
  fog: '<path d="M7.2 12.5h10.3a3.8 3.8 0 0 0 .4-7.6 5.6 5.6 0 0 0-10.9 1.3 3.2 3.2 0 0 0 .2 6.3Z"/><path d="M4 16h16M6 19.5h12"/>',
  thermo: '<path d="M14 14.1V5a2 2 0 0 0-4 0v9.1a3.8 3.8 0 1 0 4 0Z"/><path d="M12 9v7.2"/>',
  // gear categories
  bat: '<path d="M8.9 13.4 17.8 4.1a2.2 2.2 0 0 1 3.1 3.1l-9.3 8.9a1.6 1.6 0 0 1-2.2 0l-.5-.5a1.6 1.6 0 0 1 0-2.2Z"/><path d="M9.4 15.1 5.4 19"/><circle cx="4.5" cy="19.9" r="1.3"/>',
  glove: '<path d="M7 20.5h8.3c1.6 0 2.9-1.1 3.2-2.7l1.4-7.4a1.4 1.4 0 0 0-2.7-.6l-1 3V5.2a1.4 1.4 0 0 0-2.8 0V11V4a1.4 1.4 0 0 0-2.8 0v7V5.3a1.4 1.4 0 0 0-2.8 0V12l-1.3-1.9A1.5 1.5 0 0 0 4 11.8l3 8.7Z"/><path d="M7 17.5h9"/>',
  cleats: '<path d="M3.5 15.5V9.8c0-.7.5-1.2 1.2-1.2h2.6l1.2 2.2c2.3.6 4.8.8 7.3 1 2.4.3 4.7 1.4 4.7 3.7H3.5Z"/><path d="M3.5 15.5h17v1.3c0 .5-.4.9-.9.9H4.4a.9.9 0 0 1-.9-.9z"/><path d="M6 17.7v1.5M10 17.7v1.5M14 17.7v1.5M18 17.7v1.5M9.8 11.2l1-1.6M12.5 11.7l1-1.6"/>',
  helmet: '<path d="M3.5 15.2v-2.4a8.5 8.5 0 0 1 17 0v2.9H13V13"/><path d="M13 15.7h7.5v1.6a1.2 1.2 0 0 1-1.2 1.2H6.2a2.7 2.7 0 0 1-2.7-2.7v-.6"/><path d="M8.5 7.5v4"/>',
  bag: '<rect x="3.5" y="8" width="17" height="11.5" rx="2"/><path d="M9 8V6.2c0-.7.5-1.2 1.2-1.2h3.6c.7 0 1.2.5 1.2 1.2V8M3.5 12.5h17M10.5 12.5v1.8h3v-1.8"/>',
  catcher: '<path d="M6 6.5C6 4.6 8.7 3.5 12 3.5s6 1.1 6 3V14c0 3.3-2.7 6.5-6 6.5S6 17.3 6 14z"/><path d="M6 10h12M6 14h12M10 6.5v13.6M14 6.5v13.6"/>',
  apparel: '<path d="m8.5 3.8-5 2.6 1.6 4.4 2.3-.8v10.3h9.2V10l2.3.8 1.6-4.4-5-2.6c-.4 1.3-1.8 2.2-3.5 2.2S8.9 5.1 8.5 3.8Z"/>',
  training: '<path d="M12 3.5 7.2 17.5h9.6z"/><path d="M4 20.5h16M9.3 11.5h5.4"/>',
  tag: '<path d="M3.5 11.6V4.5c0-.6.4-1 1-1h7.1l8.8 8.8a1.2 1.2 0 0 1 0 1.7l-7.1 7.1a1.2 1.2 0 0 1-1.7 0z"/><circle cx="8" cy="8" r="1.4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  profile: '<circle cx="12" cy="8.2" r="3.7"/><path d="M4.8 20c.8-3.8 3.7-6 7.2-6s6.4 2.2 7.2 6"/>',
  pennant: '<path d="M5.5 21V3.5"/><path d="M5.5 4.5 19 9l-13.5 4.5"/>',
  swap: '<path d="M4 8h14.5M15 4.5 18.5 8 15 11.5M20 16H5.5M9 12.5 5.5 16 9 19.5"/>',
  camera: '<path d="M4.5 7.5h3l1.5-2.5h6l1.5 2.5h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.6"/>',
};

export function icon(name, cls = '') {
  const p = P[name] || P.ball;
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${p}</svg>`;
}
export const ICON_NAMES = Object.keys(P);
