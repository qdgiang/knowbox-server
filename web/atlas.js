import { el, stack, inline, muted, meta, chip, section, box, empty, notice, plural, join, human, url, link, noteUrl, noteLink, idLink, hero, button, select, checkbox, details, table, sortedValues, pairs } from './ui.js';

const palette = ['#2A4DB8','#0A8276','#AD4A1C','#7652A8','#8B6818','#A83C71','#53723E','#5E6672'];
function svg(tag, attrs = {}, content) {
  const n = document.createElementNS('http://www.w3.org/2000/svg',tag);
  for (const [key,value] of Object.entries(attrs)) n.setAttribute(key,value);
  if (content != null) n.textContent = content;
  return n;
}
function coverage(data) {
  return stack(meta('Coverage · ' + human(data.coverage)),...data.diagnostics.map(message => notice('History diagnostic',message)));
}
export function eventRow(event) {
  const publishing = event.published_in?.oid || event.commit;
  return el('div','event',inline(chip(human(event.action),'blue'),meta(event.time || 'Unknown date'),meta(human(event.source))),
    el('p','',event.detail),inline(...event.ids.map(idLink),event.successor && link('Successor ' + event.successor,noteUrl({id:event.successor}))),
    meta(join(event.client || (event.source === 'journal' ? 'Unknown client' : null), event.session, event.host,
      event.publication && human(event.publication), publishing?.slice(0,12), event.raw?.file,
      event.raw?.line && 'line ' + event.raw.line, event.raw?.marker)),
    event.reason && muted(event.reason));
}
export function historyView(data) {
  const events = data.events.map(event => stack(eventRow(event),
    data.lifetimes.length > 1 && meta(event.lifetime == null ? 'Lifetime association uncertain' : 'Lifetime ' + (event.lifetime + 1)),
    event.patch_refs.length ? meta('Patch ' + event.patch_refs.map(i => i + 1).join(', ')) : null));
  return stack(coverage(data), data.lifetimes.length ? details(plural(data.lifetimes.length,'recorded lifetime'),
    ...data.lifetimes.map((row,i) => el('div','row',meta(join('Lifetime ' + (i + 1),row.current ? 'current' : 'historical',row.created)),textPaths(row.paths)))) : null,
    events.length ? events : empty('No history recorded for this ID.'),
    ...data.patches.map((patch,i) => details('Patch ' + (i + 1) + ' · ' + patch.commit.oid.slice(0,12),muted(patch.commit.subject),el('pre','source',patch.text ?? 'Patch text unavailable.'))));
}
function textPaths(paths) { return el('code','',paths.join(', ')); }

function adjacency(edges) {
  const list = new Map();
  for (const {source,target} of edges) {
    if (!list.has(source)) list.set(source,[]);
    if (!list.has(target)) list.set(target,[]);
    list.get(source).push(target); list.get(target).push(source);
  }
  return list;
}
function reach(edges, start, depth, end) {
  const links = adjacency(edges);
  const parents = new Map([[start,null]]);
  let level = [start];
  for (let i = 0; i < depth && level.length && !parents.has(end); i++) {
    const next = [];
    for (const id of level) for (const neighbor of links.get(id) || []) {
      if (!parents.has(neighbor)) { parents.set(neighbor,id); next.push(neighbor); }
    }
    level = next;
  }
  if (!end) return new Set(parents.keys());
  const path = new Set();
  if (parents.has(end)) for (let cur = end; cur != null; cur = parents.get(cur)) path.add(cur);
  return path;
}
function mapView(nodes, edges, focused, onFocus, ctx) {
  const width = 860, height = 480;
  const source = nodes.map(n => ({...n}));
  const links = edges.map(edge => ({...edge}));
  const canvas = svg('svg', {viewBox:'0 0 860 480',class:'graph',role:'img','aria-label':plural(nodes.length,'note') + ' in the graph'});
  const layer = svg('g'); canvas.append(layer);
  if (!nodes.length) return empty('No notes match this view.');
  const d3 = window.d3;
  const colors = d3.scaleOrdinal(sortedValues(nodes.map(n => n.domain || 'Unspecified')),palette);
  const sim = d3.forceSimulation(source).force('links',d3.forceLink(links).id(d => d.id).distance(72))
    .force('charge',d3.forceManyBody().strength(-78)).force('collide',d3.forceCollide(13))
    .force('x',d3.forceX(width / 2).strength(0.13)).force('y',d3.forceY(height / 2).strength(0.24)).stop();
  sim.tick(nodes.length > 700 ? 30 : 100);
  // Fit the full layout including isolates before the first pan or zoom.
  const xs = d3.scaleLinear().domain(d3.extent(source,n => n.x)).range([38,width-70]);
  const ys = d3.scaleLinear().domain(d3.extent(source,n => n.y)).range([30,height-32]);
  for (const edge of links) layer.append(svg('line',{
    x1:xs(edge.source.x),y1:ys(edge.source.y),x2:xs(edge.target.x),y2:ys(edge.target.y),class:'edge edge-' + edge.kind
  }));
  for (const n of source) {
    const group = svg('g', {class:'map-node' + (n.id === focused ? ' focused' : ''),'data-id':n.id,transform:'translate(' + xs(n.x) + ' ' + ys(n.y) + ')'});
    group.append(svg('title',{},join(n.id,n.title,n.domain)),svg('circle',{
      r:6,fill:n.superseded ? '#fff' : colors(n.domain || 'Unspecified'),
      stroke:n.superseded ? '#a72a20' : '#fff','stroke-width':n.superseded ? 3 : 1
    }));
    if (nodes.length <= 26 || n.id === focused) group.append(svg('text',{x:12,y:4},n.id));
    group.addEventListener('click',() => onFocus(n.id));
    group.addEventListener('dblclick',() => ctx.navigate(noteUrl(n)));
    layer.append(group);
  }
  const zoom = d3.zoom().scaleExtent([0.45,7]).on('zoom',event => layer.setAttribute('transform',event.transform));
  const drawing = d3.select(canvas).call(zoom).on('dblclick.zoom',null);
  const tools = inline(button('Zoom in',() => drawing.call(zoom.scaleBy,1.4)),button('Zoom out',() => drawing.call(zoom.scaleBy,1/1.4)),button('Reset view',() => drawing.call(zoom.transform,d3.zoomIdentity)));
  return stack(canvas,tools);
}
export async function graph(ctx) {
  const data = await ctx.read('graph');
  const root = stack(), nodes = data.nodes, nodeById = new Map(nodes.map(n => [n.id,n]));
  const st = ctx.state;
  st.focus ||= ctx.query.get('id') || nodes[0]?.id;
  st.start ||= st.focus;
  st.mode ||= ctx.query.get('id') ? 'near' : 'all';
  st.depth ||= '1';
  st.enabled ||= new Set(['related','mention','supersedes']);
  const options = nodes.map(n => [n.id,n.id + ' · ' + n.title]);
  let inferred = null;
  function loadInferred() {
    if (!st.enabled.has('similar') || inferred) return;
    inferred = {state:'loading'};
    ctx.read('conflicts').then(report => {
      inferred = report;
      draw();
    }).catch(error => {
      inferred = {state:'unavailable',message:error.message};
      draw();
    });
  }
  function draw() {
    if (ctx.signal.aborted) return;
    const links = data.edges.filter(e => !e.dangling && st.enabled.has(e.kind));
    if (st.enabled.has('similar') && inferred?.state === 'ready') {
      for (const {a,b} of inferred.candidates) if (nodeById.has(a) && nodeById.has(b)) links.push({source:a,target:b,kind:'similar'});
    }
    const shown = st.mode === 'all' ? new Set(nodeById.keys()) : reach(links,st.start,st.mode === 'path' ? Infinity : Number(st.depth),st.mode === 'path' ? st.end || st.start : null);
    const selectedNodes = nodes.filter(n => shown.has(n.id));
    const selectedEdges = links.filter(e => shown.has(e.source) && shown.has(e.target));
    const mode = select('Map', [['all','Whole map'],['near','Neighbourhood'],['path','Path between notes']],st.mode,value => { st.mode=value; draw(); });
    const controls = box(el('h2','','Map controls'),mode,
      select(st.mode === 'all' ? 'Focused note' : 'Starting note',options,st.mode === 'all' ? st.focus : st.start,value => { st.start=value;st.focus=value;draw(); }),
      st.mode === 'near' && select('Depth',[['1','1 hop'],['2','2 hops']],st.depth,value => {st.depth=value;draw();}),
      st.mode === 'path' && select('Ending note',options,st.end || st.start,value => {st.end=value;draw();}),
      el('fieldset','checks',el('legend','','Edges'),...['supersedes','related','mention','similar'].map(kind =>
        checkbox(human(kind) + (kind === 'similar' ? ' (inferred)' : ''),st.enabled.has(kind),value => {
          if (value) st.enabled.add(kind); else st.enabled.delete(kind);
          loadInferred();
          draw();
        }))),st.enabled.has('similar') && inferred?.state !== 'ready' && muted(inferred?.message || 'Checking cached vectors…'));
    const dangling = data.edges.filter(e => e.dangling);
    const info = box(el('h2','','Link inventory'), pairs([['Isolates',data.isolates.length],['Dangling links',dangling.length],['Duplicate IDs',data.duplicate_ids.length]]),
      dangling.length ? details('Dangling targets',...dangling.map(e => el('div','row',inline(idLink(e.source),meta(join(e.kind,e.target)))))) : null,
      data.duplicate_ids.length ? details('Duplicate paths',...data.duplicate_ids.map(d => el('div','row',meta(d.id),...d.paths.map(path => noteLink({path},path))))) : null);
    const reselect = id => {
      st.focus=id;
      // Retain the SVG during a click so a following double-click opens that same node.
      renderSelection();
    };
    const side = stack();
    function renderSelection() {
      const f = nodeById.get(st.focus);
      if (!f) { side.replaceChildren(info); return; }
      side.replaceChildren(box(el('h2','','Focused note'),meta(join(f.id,f.domain,f.status)),noteLink(f),
        meta(join(plural(data.edges.filter(e => e.source === f.id).length,'outgoing link'),plural(data.edges.filter(e => e.target === f.id).length,'incoming link'))),
        button('Explore neighbourhood',() => {st.start=f.id;st.mode='near';draw();})),info);
      const picker = controls.querySelectorAll('select')[1];
      if (st.mode === 'all') picker.value = f.id;
      for (const g of root.querySelectorAll('.map-node')) g.classList.toggle('focused',g.getAttribute('data-id') === f.id);
    }
    const fallback = details('Notes in this view',...selectedNodes.map(n => el('div','row',noteLink(n),meta(join(n.id,n.domain)))));
    root.replaceChildren(hero(st.mode === 'near' ? 'Neighbourhood of ' + st.start : st.mode === 'path' ? 'Path between notes' : 'Knowledge graph',
      join(plural(selectedNodes.length,'note'),plural(selectedEdges.length,'link')),'Graph'),
      el('div','atlas-grid',controls,box(el('h2','','Link map'),
        st.mode === 'path' && !shown.size ? empty('No path connects these notes through the selected edge types.') :
          mapView(selectedNodes,selectedEdges,st.focus,reselect,ctx),meta('Colour indicates domain. A red ring marks a superseded note.'),fallback),side));
    renderSelection();
  }
  loadInferred();
  draw();
  return root;
}
function weekKey(day) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(day || '')) return null;
  const date = new Date(day.slice(0,10) + 'T00:00:00Z');
  if (!Number.isFinite(+date)) return null;
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay()+6)%7);
  return date.toISOString().slice(0,10);
}
function weekCounts(events) {
  const byWeek = new Map();
  for (const e of events) {
    if (e.source !== 'journal' || !e.current) continue;
    const week = weekKey(e.time);
    if (!week) continue;
    if (!byWeek.has(week)) byWeek.set(week,new Map());
    const actions = byWeek.get(week);
    actions.set(e.action,(actions.get(e.action) || 0)+1);
  }
  return [...byWeek].sort(([a],[b]) => a.localeCompare(b));
}
function weeklyChart(weeks,choose) {
  if (!weeks.length) return empty('No dated entries in the current journal.');
  const keys = sortedValues(weeks.flatMap(([,counts]) => [...counts.keys()]));
  const d3 = window.d3, colors = d3.scaleOrdinal(keys,palette);
  const width = 850, h = 165;
  const plot = svg('svg',{viewBox:'0 0 850 205',class:'chart',role:'img','aria-label':'Weekly journal events. Counts and event filters are available in the table.'});
  const dates = weeks.map(([week]) => new Date(week + 'T00:00:00Z'));
  const sevenDays = 7 * 86400000;
  const x = d3.scaleUtc().domain([dates[0],new Date(+dates.at(-1) + sevenDays)]).range([34,width-6]);
  const barWidth = Math.max(1,(x(new Date(+dates[0]+sevenDays))-x(dates[0]))*.8);
  const y = d3.scaleLinear().domain([0,d3.max(weeks,([,counts]) => d3.sum(counts.values()))]).nice(4).range([h,12]);
  for (const value of y.ticks(4)) plot.append(svg('line',{x1:32,x2:width,y1:y(value),y2:y(value),class:'gridline'}),svg('text',{x:22,y:y(value)+4,'text-anchor':'end'},value));
  weeks.forEach(([day,counts],i) => {
    let sum = 0;
    for (const [kind,count] of counts) {
      const item = svg('rect',{x:x(dates[i])+2,y:y(sum+count),width:barWidth,height:y(sum)-y(sum+count),fill:colors(kind)});
      item.append(svg('title',{},day + ' · ' + kind + ' · ' + count));
      item.addEventListener('click',() => choose(day));
      plot.append(item); sum += count;
    }
  });
  plot.append(svg('text',{x:32,y:193},weeks[0][0]));
  if (weeks.length > 1) plot.append(svg('text',{x:width-6,y:193,'text-anchor':'end'},weeks.at(-1)[0]));
  const legend = inline(...keys.map(k => {
    const icon = svg('svg',{width:12,height:12,'aria-hidden':true}); icon.append(svg('rect',{width:12,height:12,rx:2,fill:colors(k)}));
    return inline(icon,meta(k));
  }));
  return stack(legend,plot,details('Show weekly counts as a table',table(['Week of',...keys],weeks.map(([date,counts]) => [button(date,() => choose(date),'text-button'),...keys.map(k => counts.get(k) || 0)]))));
}
export async function timeline(ctx) {
  const data = await ctx.read('timeline');
  const weeks = weekCounts(data.events);
  const root = stack();
  function draw() {
    const action = ctx.state.action || '', source = ctx.state.source || '', week = ctx.state.week || '';
    const events = data.events.filter(e => (!action || e.action === action) && (!source || e.source === source) && (!week || weekKey(e.time) === week));
    const filters = inline(select('Action',[['','All actions'],...sortedValues(data.events.map(e => e.action)).map(k => [k,human(k)])],action,v => {ctx.state.action=v;draw();}),
      select('Evidence',[['','All sources'],...sortedValues(data.events.map(e => e.source)).map(k => [k,human(k)])],source,v => {ctx.state.source=v;draw();}),
      select('Week',[['','All weeks'],...weeks.map(([k]) => [k,k]).reverse()],week,v => {ctx.state.week=v;draw();}));
    root.replaceChildren(hero('What changed, and when','Journal entries, Git changes and raw evidence in chronological order.','Timeline'),
      section('Journal events per week',box(weeklyChart(weeks,date => {ctx.state.week=date;draw();}))),
      el('div','split',section('Events',box(filters,meta(plural(events.length,'event')),events.length ? events.map(eventRow) : empty('No events in this selection.'))),
        section('Sources',box(coverage(data),meta('Weekly totals count dated entries in the current log.md.')))));
  }
  draw(); return root;
}
