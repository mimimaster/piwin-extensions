// Shared visual pieces: icons, avatars, chips, sections.
import { h } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 24×24 stroke icons (Lucide-style paths).
const ICONS = {
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm21 21-4.3-4.3'],
  copy: ['M8 8h12v12H8z', 'M16 8V4H4v12h4'],
  check: ['M20 6 9 17l-5-5'],
  arrowRight: ['M5 12h14', 'm12 5 7 7-7 7'],
  arrowLeft: ['M19 12H5', 'm12 19-7-7 7-7'],
  external: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  fork: ['M6 3v6', 'M18 3v6', 'M6 9a6 6 0 0 0 6 6 6 6 0 0 0 6-6', 'M12 15v6'],
  pin: ['M12 17v5', 'M9 3h6l-1 7 4 3H6l4-3z'],
  scale: ['M12 3v18', 'M5 7h14', 'm5 7-3 7a3 3 0 0 0 6 0z', 'm19 7-3 7a3 3 0 0 0 6 0z'],
  tag: ['M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z', 'M7.5 7.5h.01'],
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
  send: ['M22 2 11 13', 'M22 2 15 22l-4-9-9-4z'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
  github: [
    'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3.1-.3 6.4-1.5 6.4-7a5.4 5.4 0 0 0-1.5-3.8 5 5 0 0 0-.1-3.8s-1.2-.3-3.9 1.5a13.4 13.4 0 0 0-7 0C6.3 1.6 5.1 1.9 5.1 1.9a5 5 0 0 0-.1 3.8A5.4 5.4 0 0 0 3.5 9.5c0 5.4 3.3 6.6 6.4 7a3.4 3.4 0 0 0-.9 2.6V22',
  ],
};

export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  for (const d of ICONS[name] ?? []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** GitHub avatar with an initial underneath, so a blocked image still reads. */
export function avatar(login, size = 20) {
  const initial = h('span', { class: 'avatar-initial', 'aria-hidden': 'true' }, login.slice(0, 1).toUpperCase());
  const image = h('img', {
    src: `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=${size * 2}`,
    alt: '',
    width: size,
    height: size,
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
  });
  image.addEventListener('error', () => image.remove());
  const wrapper = h('span', { class: 'avatar' }, initial, image);
  // CSP forbids style attributes; CSSOM writes are allowed.
  wrapper.style.setProperty('--size', `${size}px`);
  return wrapper;
}

export function chip(text, { tone, iconName } = {}) {
  return h('span', { class: `chip${tone ? ` ${tone}` : ''}` }, iconName ? icon(iconName, 12) : null, text);
}

export function seal(text = '砚') {
  return h('span', { class: 'seal', 'aria-hidden': 'true' }, text);
}

export function section(title, ...children) {
  return h('section', { class: 'block' }, h('h2', {}, title), ...children);
}
