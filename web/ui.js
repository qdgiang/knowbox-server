import { renderDiagrams } from './diagrams.js';

// Source strings become text nodes. The only HTML sink accepts the server's sanitized body_html.
export function el(tag, cls, ...children) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  node.append(...children.flat(Infinity).filter(value => value != null && value !== false));
  return node;
}
export const stack = (...children) => el('div', 'stack', ...children);
export const inline = (...children) => el('div', 'inline', ...children);
export const muted = value => el('p', 'muted', value);
export const meta = value => el('span', 'meta', value);
export const chip = (value, tone = '') => el('span', 'chip ' + tone, value);
export const section = (title, ...children) => el('section', 'section', el('h2', '', title), ...children);
export const box = (...children) => el('div', 'card stack', ...children);
export const empty = message => el('p', 'empty', message);
export const notice = (title, message) => el('div', 'notice', el('strong', '', title), message ? el('div', '', message) : null);
export const plural = (n, singular, multiple = singular + 's') => n + ' ' + (n === 1 ? singular : multiple);
export const join = (...values) => values.flat().filter(value => value !== '' && value != null).join(' · ');
export const human = value => String(value ?? '').replaceAll('_', ' ');
export const textValue = value => Array.isArray(value) ? value.map(textValue).join(', ') : String(value ?? '');
export function url(path, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') query.set(key, value);
  return path + (query.size ? '?' + query : '');
}
export function link(label, href, cls = '') {
  const node = el('a', cls, label);
  node.href = href;
  return node;
}
export const noteUrl = row => row.path ? url('/note', {path:row.path}) : '/n/' + encodeURIComponent(row.id);
export const noteLink = (row, label = row.title || row.id) => link(label, noteUrl(row));
export const idLink = id => noteLink({id}, id);
export const hero = (title, description, eyebrow) => el('div', 'hero', eyebrow && el('div', 'eyebrow', eyebrow), el('h1', '', title), description && muted(description));
export function button(label, action, cls = 'button') {
  const node = el('button', cls, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
export function select(label, options, current, change) {
  const control = document.createElement('select');
  for (const [value, name] of options) control.add(new Option(name, value));
  control.value = current;
  control.addEventListener('change', () => change(control.value));
  return el('label', 'field', el('span', '', label), control);
}
export function checkbox(label, checked, change) {
  const control = el('input');
  control.type = 'checkbox';
  control.checked = checked;
  control.addEventListener('change', () => change(control.checked));
  return el('label', 'check', control, label);
}
export function details(title, ...children) {
  return el('details', 'disclosure', el('summary', '', title), ...children);
}
export function table(headers, rows) {
  const head = el('tr', '', headers.map(label => el('th', '', label)));
  return el('div', 'scroll-table', el('table', '', el('thead', '', head), el('tbody', '', rows.map(cells => el('tr', '', cells.map(cell => el('td', '', cell)))))));
}
export function bodyView(report) {
  if (typeof report.body_html !== 'string') return el('pre', 'source', report.body ?? report.markdown);
  const node = el('div', 'markdown');
  node.innerHTML = report.body_html;
  renderDiagrams(node);
  return node;
}
export function noteRow(row, secondary) {
  return el('div', 'row', noteLink(row), el('small', 'meta', join(row.id, secondary)));
}
export function pairs(entries) {
  return el('dl', 'facts', entries.flatMap(([name,value]) => [el('dt', '', name), el('dd', '', value)]));
}
export function sortedValues(values) {
  return [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b));
}
export function repoText(status) {
  if (status.state === 'no_git') return 'No Git repository';
  if (status.state !== 'head' && status.state !== 'unborn') return 'Git status unavailable';
  const where = status.state === 'unborn' ? status.branch + ' (unborn)' : status.detached ? 'Detached HEAD' : status.branch;
  return join(where, status.changes.length ? plural(status.changes.length, 'working tree change') : 'Clean working tree');
}
