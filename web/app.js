import { el, hero, empty, notice, repoText, url } from './ui.js';
import { search, note, refs } from './library.js';
import { graph, timeline } from './atlas.js';
import { home, review } from './dashboard.js';
import { editor } from './editor.js';
import { agent, insights } from './insights.js';

const screens = {home, search, note, graph, timeline, refs, review, editor, agent, insights};
const main = document.getElementById('main');
const git = document.getElementById('git-status');
const key = 'knowbox.explorer.token';
let token = null;
try { token = sessionStorage.getItem(key); } catch {}
function consumeLaunch() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.has('token')) return false;
  token = fragment.get('token');
  history.replaceState(null, '', location.pathname + location.search);
  try { sessionStorage.setItem(key, token); } catch { /* Tab memory works when storage is disabled. */ }
  return true;
}
consumeLaunch();
let active, revision, interval, pendingPoll = false, generation = 0;
let state = {};

function openLauncher() {
  active?.abort();
  clearInterval(interval);
  token = null;
  try { sessionStorage.removeItem(key); } catch {}
  main.replaceChildren(hero('Open the Explorer from your terminal'), el('p', '', 'Reopen the launch URL printed by ', el('code', '', 'knowbox serve --assets /path/to/web'), ' to connect this tab.'));
  git.textContent = '';
  document.getElementById('editor-nav').hidden = true;
  document.getElementById('agent-nav').hidden = true;
  document.getElementById('insights-nav').hidden = true;
  document.getElementById('readonly').hidden = false;
}
function viewName() {
  const path = location.pathname;
  return path === '/' ? 'home' : path.startsWith('/n/') ? 'note' : path.slice(1);
}
async function request(name, params, signal) {
  const response = await fetch(url('/api/' + name, params), {
    method:'GET', mode:'same-origin', credentials:'omit', redirect:'error', cache:'no-store',
    headers:token ? {Authorization:'Bearer ' + token} : {}, signal
  });
  if (response.status === 401) {
    if (!signal.aborted) openLauncher();
    throw new Error('The Explorer launch URL has expired.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed (' + response.status + ').');
  return data;
}
async function post(name, payload, signal) {
  const response = await fetch('/api/' + name, {
    method:'POST', mode:'same-origin', credentials:'omit', redirect:'error', cache:'no-store',
    headers:{'Authorization':'Bearer ' + token, 'Content-Type':'application/json'},
    body:JSON.stringify(payload), signal
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed (' + response.status + ').'), {data});
  return data;
}
function draw(refresh = false) {
  active?.abort();
  clearInterval(interval);
  pendingPoll = false;
  const version = ++generation;
  const signal = (active = new AbortController()).signal;
  const view = viewName();
  const currentPath = location.pathname + location.search;
  const oldFocus = refresh && main.contains(document.activeElement) ? document.activeElement : null;
  const oldSelection = oldFocus?.id === 'query' ? [oldFocus.selectionStart, oldFocus.selectionEnd] : null;
  if (!refresh) state = {};
  const query = new URLSearchParams(location.search);
  document.title = (view[0]?.toUpperCase() + view.slice(1)) + ' · Knowbox';
  for (const a of document.querySelectorAll('nav a')) {
    const selected = a.pathname === (view === 'home' ? '/' : view === 'note' ? '/search' : '/' + view);
    if (selected) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const screen = Object.hasOwn(screens,view) ? screens[view] : null;
  if (!screen) { main.replaceChildren(hero('Page not found')); return; }
  const cache = new Map();
  const warnings = new Map();
  const warningBox = el('div');
  function read(name, params = {}) {
    const cacheKey = url(name, params);
    if (!cache.has(cacheKey)) cache.set(cacheKey,request(name, params, signal).then(data => {
      if (!signal.aborted && Array.isArray(data.inventory_warnings)) {
        for (const {path,message} of data.inventory_warnings) warnings.set(path,message);
        warningBox.replaceChildren(...[...warnings.values()].map(message => notice('Inventory warning', message)));
      }
      return data;
    }));
    return cache.get(cacheKey);
  }
  function onError(node, error) {
    if (!signal.aborted) node.replaceChildren(notice('Unavailable', error.message));
  }
  function slot(name, render, params = {}) {
    const node = el('div', 'slot', empty('Loading…'));
    read(name, params).then(data => {
      if (!signal.aborted) node.replaceChildren(render(data));
    }).catch(error => onError(node,error));
    return node;
  }
  function update(params, options = {}) {
    const next = new URLSearchParams(query);
    for (const [k,v] of Object.entries(params)) {
      if (v == null || v === '') next.delete(k); else next.set(k,v);
    }
    navigate(location.pathname + (next.size ? '?' + next : ''), options);
  }
  const ctx = {
    query, state, read, slot, signal, update, navigate, onError,
    post:(name,payload) => post(name,payload,name === 'draft' ? signal : undefined),
    refresh:() => draw(true)
  };
  async function poll(initial = false) {
    if (document.hidden || signal.aborted || pendingPoll || view === 'editor'
      || (!initial && main.querySelector('.write-form:focus-within, .write-form[aria-busy=true]'))) return;
    pendingPoll = true;
    try {
      const data = await request('revision', {view}, signal);
      if (signal.aborted) return;
      if (!initial && data.revision !== revision) {
        revision = data.revision;
        draw(true);
        return;
      }
      revision = data.revision;
    } catch { /* Retry when visible on the next interval, keeping the current page. */ }
    finally { if (version === generation) pendingPoll = false; }
  }
  revision = null;
  async function start() {
    if (signal.aborted || currentPath !== location.pathname + location.search) return;
    try {
      const [capabilities] = await Promise.all([read('capabilities'), poll(true)]);
      if (signal.aborted) return;
      if (capabilities.api_version !== 1) throw new Error('This Explorer bundle requires Knowbox API version 1.');
      ctx.writable = capabilities.writable;
      ctx.insights = capabilities.insights === true;
      document.getElementById('editor-nav').hidden = !ctx.writable;
      document.getElementById('agent-nav').hidden = !ctx.insights;
      document.getElementById('insights-nav').hidden = !ctx.insights;
      document.getElementById('readonly').hidden = ctx.writable;
      const page = await screen(ctx);
      if (signal.aborted) return;
      main.replaceChildren(page, warningBox);
      if (oldFocus?.id) {
        const field = document.getElementById(oldFocus.id);
        field?.focus({preventScroll:true});
        if (field && oldSelection) field.setSelectionRange(...oldSelection);
      }
      if (state.focusQuery) { document.getElementById('query')?.focus(); delete state.focusQuery; }
    } catch (error) { onError(main,error); }
  }
  if (!refresh) main.replaceChildren(empty('Loading…'));
  git.textContent = '';
  read('status').then(status => { if (!signal.aborted) git.textContent = repoText(status); })
    .catch(() => { if (!signal.aborted) git.textContent = 'Git status unavailable'; });
  void start();
  interval = setInterval(() => void poll(), 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll(); }, {signal});
}
function navigate(href, {preserve = false, focusQuery = false} = {}) {
  if (href !== location.pathname + location.search) history.pushState(null, '', href);
  draw(preserve);
  if (focusQuery) state.focusQuery = true;
  if (!preserve) window.scrollTo(0,0);
}
document.addEventListener('click', event => {
  const anchor = event.target.closest('a[href]');
  if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.hasAttribute('target') || anchor.hasAttribute('download')) return;
  let dest;
  try { dest = new URL(anchor.getAttribute('href'),document.baseURI); } catch { return; }
  if (dest.origin !== location.origin || dest.hash || !/^\/(?:$|n\/[^/]+$|(?:note|graph|timeline|search|refs|review|editor|agent|insights)$)/.test(dest.pathname)) return;
  event.preventDefault();
  navigate(dest.pathname + dest.search, {focusQuery:anchor.classList.contains('quick')});
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    const field = document.getElementById('query');
    if (field) field.focus(); else navigate('/search', {focusQuery:true});
  }
});
window.addEventListener('popstate', () => draw());
window.addEventListener('hashchange', () => { if (consumeLaunch()) draw(); });
if (/Mac|iPad|iPhone/.test(navigator.platform)) document.querySelector('.quick kbd').textContent = '⌘ K';
draw();
