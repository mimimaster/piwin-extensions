// DOM helpers. Index data is third-party text: it only ever reaches the page
// through textContent and vetted https hrefs, never innerHTML.

/** h('a', { href, class }, 'text', child) */
export function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name === 'href') {
      element.setAttribute('href', safeHref(String(value)));
    } else {
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

/** In-page hashes and https links only. */
export function safeHref(value) {
  return value.startsWith('#') || value.startsWith('https://') || value.startsWith('./') ? value : '#';
}

export function externalLink(href, text, className) {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: className }, text);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context and focus; fall back to a selection copy.
    const area = h('textarea', { 'aria-hidden': 'true', class: 'offscreen' });
    area.value = text;
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

/** A button that copies `text()` and briefly confirms. */
export function copyButton(label, text, className = 'button secondary') {
  const labelNode = h('span', {}, label);
  const button = h('button', { type: 'button', class: className, 'aria-label': label }, labelNode);
  button.addEventListener('click', async () => {
    const copied = await copyText(typeof text === 'function' ? text() : text);
    labelNode.textContent = copied ? '已复制' : '复制失败';
    button.classList.toggle('is-done', copied);
    setTimeout(() => {
      labelNode.textContent = label;
      button.classList.remove('is-done');
    }, 1600);
  });
  return button;
}

/** One shell command with a prompt glyph and a copy button. */
export function codeLine(text) {
  return h(
    'div',
    { class: 'code-line' },
    h('span', { class: 'prompt', 'aria-hidden': 'true' }, '$'),
    h('code', {}, text),
    copyButton('复制', text, 'copy-chip'),
  );
}
