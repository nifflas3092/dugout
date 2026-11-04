/* Display and accessibility settings. Kept on this device (they're about this screen, not the account)
   and applied before anything draws, so there's no flash of the wrong size or colours. */

const KEY = 'dugout-prefs';
const DEFAULTS = { text: 'normal', theme: 'auto', contrast: false, motion: false, underline: false };
export function getPrefs() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) { return { ...DEFAULTS }; } }
export function setPrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (_) {} applyPrefs(p); }
export function applyPrefs(p = getPrefs()) {
  const h = document.documentElement;
  h.classList.toggle('big', p.text === 'large');
  h.classList.toggle('xbig', p.text === 'xlarge');
  if (p.theme === 'auto') h.removeAttribute('data-theme'); else h.setAttribute('data-theme', p.theme);
  h.classList.toggle('hc', !!p.contrast);
  h.classList.toggle('calm', !!p.motion);
  h.classList.toggle('links-u', !!p.underline);
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = '#3b8256';
}

/* the settings form, used on the sign-in screen and in the menu */
export function prefsForm(idp = 'pf') {
  const p = getPrefs();
  const radio = (name, val, label) => `<label class="opt"><input type="radio" name="${idp}-${name}" value="${val}"${p[name] === val ? ' checked' : ''}> ${label}</label>`;
  const check = (name, label, hint) => `<label class="opt opt-wide"><input type="checkbox" name="${idp}-${name}"${p[name] ? ' checked' : ''}> <span>${label}${hint ? `<span class="muted small" style="display:block">${hint}</span>` : ''}</span></label>`;
  return `<div class="prefs" data-prefs="${idp}">
    <fieldset><legend>Text size</legend><div class="opts">${radio('text', 'normal', 'Normal')}${radio('text', 'large', 'Large')}${radio('text', 'xlarge', 'Extra large')}</div></fieldset>
    <fieldset><legend>Colours</legend><div class="opts">${radio('theme', 'auto', 'Match my phone')}${radio('theme', 'light', 'Light')}${radio('theme', 'dark', 'Dark')}</div></fieldset>
    <fieldset><legend>Easier to see and use</legend><div class="opts">
      ${check('contrast', 'High contrast', 'Darker text, stronger outlines')}
      ${check('motion', 'Reduce motion', 'No bounces or slides')}
      ${check('underline', 'Underline all links')}
    </div></fieldset>
  </div>`;
}
export function bindPrefs(root, idp = 'pf') {
  root.querySelectorAll(`[name^="${idp}-"]`).forEach(el => el.addEventListener('change', () => {
    const p = getPrefs(), key = el.name.slice(idp.length + 1);
    p[key] = el.type === 'checkbox' ? el.checked : el.value;
    setPrefs(p);
  }));
}
applyPrefs();
