import { el, stack, inline, muted, meta, chip, section, box, empty, notice, plural, join, human, textValue, url, link, noteUrl, noteLink, idLink, hero, button, select, checkbox, bodyView, noteRow, pairs, sortedValues, details, table } from './ui.js';
import { historyView } from './atlas.js';

function facets(ctx, rows) {
  const fields = [['domain','Domain'],['type','Type'],['status','Status']];
  return box(el('h2', '', 'Filters'), ...fields.map(([key,label]) => {
    const choices = sortedValues([...rows.map(row => row[key]),ctx.query.get(key)]);
    return select(label, [['','All ' + label.toLowerCase() + 's'], ...choices.map(value =>
      [value, value + ' (' + rows.filter(row => row[key] === value).length + ')'])], ctx.query.get(key) || '', value => ctx.update({[key]:value},{preserve:true}));
  }), muted('Filters narrow the returned results in their original order.'));
}
function searchMessage(data) {
  if (data.status === 'stale_index') return notice('Search index is stale', data.guidance);
  const messages = [];
  if (data.layer === 'miss') messages.push(notice('No matches', 'Try a broader term, a synonym or a note ID.'));
  if (data.layer === 'refs') messages.push(notice('Found in long documents', 'Matching document names and headings are listed below.'));
  if (data.partial) messages.push(notice('Partial match', 'No note contains all the query terms.'));
  if (data.corrections?.length) messages.push(notice('Typo correction', data.corrections.map(c => c.from + ' → ' + c.to).join(', ')));
  if (data.layer === 'semantic') messages.push(notice('Semantic matches', 'Lexical search found no matches. Open each note to check its evidence.'));
  if (data.rerank) messages.push(notice('Hybrid ranking', data.rerank === 'recency' ? 'Lexical and semantic agreement with recency.' : 'Lexical and semantic agreement.'));
  if (data.index_status === 'unchecked') messages.push(meta('Direct ID lookup · index unchecked'));
  return stack(...messages);
}
function neighbors(rows) {
  return rows.length ? stack(...rows.map(row => noteRow(row, join(row.direction, row.kind, 'via ' + row.via, 'depth ' + row.depth)))) : empty('No linked notes.');
}
function rankText(hit) {
  return join(hit.bm25_rank != null && 'BM25 #' + hit.bm25_rank || '', hit.cosine != null && 'cos ' + hit.cosine.toFixed(3) || '',
    hit.cosine_rank != null && 'cosine #' + hit.cosine_rank || '', hit.fused_rank != null && 'fused #' + hit.fused_rank || '');
}
function previewNote(data) {
  const fm = data.frontmatter || {};
  return stack(inline(meta(data.id), fm.status && chip(textValue(fm.status))), el('h3', '', textValue(fm.title) || data.path),
    fm.summary && muted(textValue(fm.summary)), data.state === 'malformed' ? notice('Malformed frontmatter',data.parse_error) : null,
    details('Read preview', bodyView(data)), fm.triggers?.length && section('Read when', muted(textValue(fm.triggers))) || null,
    inline(link('Open note', noteUrl(data), 'button primary'), data.id && link('Graph',url('/graph',{id:data.id}),'button')));
}
function searchResults(ctx, data, notes, catalog, listError) {
  if (data.status === 'stale_index') return searchMessage(data);
  const byPath = new Map(notes.map(n => [n.path,n]));
  const hits = (catalog ? notes : data.hits || []).map(hit => {
    const row = byPath.get(hit.path);
    return {...hit,domain:row?.domain,type:row?.type,status:textValue(row?.frontmatter.status)};
  });
  const filtered = hits.filter(hit => ['type','domain','status'].every(key => !ctx.query.get(key) || hit[key] === ctx.query.get(key)));
  const sidebar = el('aside', 'stack', el('h2', '', 'Preview'));
  const center = el('div','stack');
  const entries = [];
  let selected = -1;
  let previewSerial = 0;
  function choose(index, focus = false) {
    if (index < 0 || index >= filtered.length) return;
    selected = index;
    ctx.state.preview = filtered[index].path;
    entries.forEach((row, i) => row.classList.toggle('selected', i === index));
    if (focus) entries[index].querySelector('.result-title').focus();
    const request = ++previewSerial;
    sidebar.replaceChildren(el('h2', '', 'Preview'), empty('Loading note…'));
    ctx.read('note', {path:filtered[index].path}).then(note => {
      if (!ctx.signal.aborted && request === previewSerial) sidebar.replaceChildren(el('h2', '', 'Preview'), box(previewNote(note)));
    }).catch(error => { if (request === previewSerial) ctx.onError(sidebar, error); });
  }
  for (const [i, hit] of filtered.entries()) {
    const a = link(hit.title || hit.id || hit.path,noteUrl(hit),'result-title');
    a.addEventListener('focus', () => { if (selected !== i) choose(i); });
    const row = el('article','result', inline(meta(hit.id), meta(join(hit.type,hit.domain)), hit.match_kind && chip(human(hit.match_kind),'blue'),
      hit.direct?.state === 'malformed' ? chip('Malformed','red') : hit.status && chip(hit.status)),
      a, hit.snippet && el('p', '', hit.snippet), inline(meta(rankText(hit)), button('Preview', () => choose(i), 'text-button')));
    entries.push(row);
  }
  if (catalog || hits.length) center.append(el('h2', '', plural(filtered.length, catalog ? 'note' : 'result')), ...entries);
  if (!filtered.length && hits.length) center.append(empty('No returned notes match these filters.'));
  if (catalog && !hits.length) center.append(empty('No parsed notes in the inventory.'));
  for (const hit of data.refs || []) center.append(box(link(hit.path,url('/refs',{path:hit.path})),meta(hit.headings.join(' / ') || 'Filename or opening section')));
  if (data.expanded?.length) center.append(section('Linked from the top results',box(neighbors(data.expanded))));
  if (data.expansion_error) center.append(notice('Expansion unavailable',data.expansion_error));
  if (entries.length) {
    const previous = filtered.findIndex(row => row.path === ctx.state.preview);
    choose(previous < 0 ? 0 : previous);
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName) || event.target.isContentEditable) return;
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        choose(Math.min(entries.length - 1, Math.max(0, selected + (event.key === 'j' ? 1 : -1))),true);
      } else if (event.key === 'e') ctx.update({expand:ctx.query.get('expand') === '1' ? null : '1'}, {preserve:true});
    }, {signal:ctx.signal});
  } else sidebar.replaceChildren();
  return stack(!catalog && searchMessage(data), listError && notice('Note metadata unavailable',listError),
    el('div','search-grid', facets(ctx,hits), center, sidebar));
}
export function search(ctx) {
  const query = ctx.query.get('q') || '';
  const input = el('input');
  input.id = 'query'; input.type = 'search'; input.value = ctx.state.draft ?? query;
  input.placeholder = 'Search notes, terms or a kb-id'; input.setAttribute('aria-label','Search notes');
  const allowSemantic = checkbox('Allow semantic search (sends query)',ctx.state.semanticQuery === query, enabled => {
    const text = input.value.trim();
    ctx.state.semanticQuery = enabled && text ? text : undefined;
    ctx.update({q:text,local:null},{preserve:true});
  });
  input.addEventListener('input', () => {
    ctx.state.draft = input.value;
    if (ctx.state.semanticQuery !== input.value.trim()) {
      delete ctx.state.semanticQuery;
      allowSemantic.querySelector('input').checked = false;
    }
  });
  const submit = el('button','button primary','Search'); submit.type = 'submit';
  const form = el('form','query-form',input,submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    ctx.update({q:input.value.trim(),local:null},{preserve:true});
  });
  const controls = inline(allowSemantic,
    checkbox('Typo correction',ctx.query.get('no_fix') !== '1',value => ctx.update({no_fix:value ? null : '1'},{preserve:true})),
    checkbox('Expand links',ctx.query.get('expand') === '1',value => ctx.update({expand:value ? '1' : null},{preserve:true})));
  const results = el('div','stack',empty('Loading…'));
  const request = query ? ctx.read('search',{q:query,local:ctx.state.semanticQuery === query ? 0 : 1,
    no_fix:ctx.query.get('no_fix') === '1' ? 1 : 0,expand:ctx.query.get('expand') === '1' ? 1 : 0}) : Promise.resolve({});
  Promise.all([request,ctx.read('list').then(data => ({notes:data.notes})).catch(error => ({notes:[],error:error.message}))])
    .then(([data,list]) => { if (!ctx.signal.aborted) results.replaceChildren(searchResults(ctx,data,list.notes,!query,list.error)); })
    .catch(error => ctx.onError(results,error));
  return stack(hero('Search the knowbox'), box(form, controls), results);
}
function usageView(report,id) {
  const rows = report.access.filter(row => row.note === id);
  return stack(meta(report.coverage_start ? 'Recorded since ' + report.coverage_start : 'No recorded coverage'),
    rows.length ? table(['Date','Activity','Count','Clients','Sessions','Last read (UTC)'],rows.map(row => [row.day,row.kind === 'open' ? 'Open' : human(row.kind) + ' exposure',row.count,
      row.clients,row.sessions,row.last_read_utc])) : empty('No recorded activity for this ID.'),
    report.dropped_rows ? muted('Dropped records: ' + report.dropped_rows) : null,
    report.gaps?.length ? muted('Coverage gaps: ' + report.gaps.map(textValue).join(', ')) : null);
}
export async function note(ctx) {
  const idRoute = location.pathname.startsWith('/n/');
  const params = idRoute ? {id:decodeURIComponent(location.pathname.slice(3))} : {path:ctx.query.get('path')};
  const note = await ctx.read('note',params);
  const fm = note.frontmatter || {};
  const id = note.id;
  const data = Object.entries(fm).map(([key,value]) => [key,textValue(value)]);
  const tabs = [['body','Body'],['source','Source'],['history','History']];
  const selected = ctx.query.get('tab') || 'body';
  const body = selected === 'history' ? (id ? ctx.slot('history', historyView,{id}) : empty('No note ID for history.'))
    : selected === 'source' || note.state === 'malformed' ? el('pre','source',note.markdown) : bodyView(note);
  const drift = note.edited_since_verify;
  return stack(inline(link('Home','/'), meta('/'), fm.domain && link(textValue(fm.domain),url('/search',{domain:textValue(fm.domain)})), meta('/'), meta(id || note.path)),
    el('div','hero',inline(meta(id || note.path),chip(join(textValue(fm.type),textValue(fm.domain)) || 'Note','blue'),fm.status && chip(textValue(fm.status)),
      fm.confidence && chip('Confidence ' + textValue(fm.confidence))),el('h1','',textValue(fm.title) || id || note.path),fm.summary && muted(textValue(fm.summary)),
      ctx.writable && note.state === 'parsed' && inline(link('Edit note',url('/editor',{target:note.path}),'button'))),
    drift && notice('Edited after verification', 'Verified ' + drift.verified + ' · edited ' + drift.updated),
    note.state === 'malformed' && notice('Malformed frontmatter',note.parse_error),
    el('div','split', stack(box(el('nav','tabs',tabs.map(([key,label]) => {
      const a = link(label,url(location.pathname,{...params,...(idRoute ? {id:null} : {}),tab:key === 'body' ? null : key}),key === selected ? 'active' : '');
      if (key === selected) a.setAttribute('aria-current','page');
      return a;
    })),body), selected === 'body' && fm.triggers?.length ? section('Read when',box(muted(textValue(fm.triggers)))) : null),
    stack(section('Provenance',box(meta(note.path),pairs(data.filter(([k]) => !['title','summary','triggers','related','supersedes'].includes(k))))),
      id && section('Links',box(ctx.slot('expand', data => neighbors(data.neighbors),{id,depth:1}),link('Show in graph',url('/graph',{id}),'button'))),
      id && section('Local usage',box(ctx.slot('usage',data => usageView(data,id)))))));
}
export async function refs(ctx) {
  const report = await ctx.read('refs');
  const heading = hero('Long documents', 'Browse the section maps and read a document one section at a time.','Refs');
  if (report.state !== 'ready') return stack(heading, empty(report.state === 'missing' ? 'The refs directory is missing.' : 'The refs directory is empty.'));
  const path = ctx.query.get('path');
  const doc = path ? report.docs.find(row => row.path === path) : report.docs[0];
  const listing = box(el('h2','','Documents'),meta(join(plural(report.total,'document'),report.unmapped + ' unmapped',report.unreadable + ' unreadable')),
    ...report.docs.map(row => link(stack(el('strong','',row.name),meta(row.state === 'unreadable' ? 'Unreadable' : join(plural(row.words,'word'),row.maps.length ? plural(row.maps.length,'map') : 'No map'))),
      url('/refs',{path:row.path}),'row ref-link' + (row === doc ? ' selected' : ''))));
  if (!doc || doc.state === 'unreadable') return stack(heading,el('div','sidebar-grid',listing,notice(doc ? 'Unreadable document' : 'Document unavailable',doc?.error || path)));
  const line = Number(ctx.query.get('line') || 1);
  const lines = doc.headings || [];
  const reader = ctx.slot('ref', data => stack(meta(data.path + ' · lines ' + data.start_line + '–' + data.end_line),bodyView(data)), {path:doc.path,line});
  const associated = ctx.slot('list', data => {
    const rows = data.notes.filter(n => textValue(n.frontmatter.source).includes(doc.name));
    return rows.length ? stack(meta('Inferred from source fields that name this document.'),...rows.map(n => noteRow(n,n.domain))) : empty('No note source fields name this document.');
  });
  return stack(heading,el('div','sidebar-grid',listing,stack(
    box(el('h2','',doc.name),inline(...doc.maps.map(id => idLink(id)),!doc.maps.length && meta('No section map')),
      doc.maps.length ? meta('Section maps inferred from reference-note titles, summaries and body mentions.') : null,
      lines.length ? details('Contents · ' + plural(lines.length,'heading'),el('div','contents',
        ...[[1,'Opening'],...lines.map(row => [row.line,row.text])].map(([n,title]) => link(join(title,'L' + n),url('/refs',{path:doc.path,line:n}),'row' + (n === line ? ' selected' : ''))))) : meta('No headings')),
    box(reader),section('Notes citing this document',box(associated)))));
}
