import { box, button, chip, details, el, empty, hero, human, inline, join, link, meta, noteLink, notice, pairs, plural, section, stack, table, url } from './ui.js';
import { eventRow } from './atlas.js';
import { textField } from './editor.js';

const palette = ['#2a4db8','#08786d','#ab481b','#764a9e','#80601d','#a42963','#49763a','#5b6370'];
const metrics = [['errors','Lint errors'],['warnings','Lint warnings'],['edited_since_verify','Edited since verification'],['raw_backlog','Open proposals']];
const layers = {id:'Exact ID',lexical:'Lexical',partial:'Partial match',typo:'Typo correction',semantic:'Semantic',refs:'Reference',miss:'Miss'};
const day = value => new Date(String(value).slice(0,10) + 'T00:00:00Z');
const rowsBy = (rows,get) => window.d3.rollup(rows,values => values.length,get);
const asText = value => Array.isArray(value) ? value.join(', ') : value ?? '';

function usageCoverage(data) {
  return meta(join(data.coverage_start ? 'Local usage recorded since ' + data.coverage_start : 'No local usage history',
    data.gaps?.length ? 'Coverage gaps ' + data.gaps.join(', ') : null,
    data.dropped_rows > 0 ? plural(data.dropped_rows,'dropped record') : null));
}

function svg(tag, attrs = {}, content) {
  const node = document.createElementNS('http://www.w3.org/2000/svg',tag);
  for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,String(value));
  if (content != null) node.textContent = content;
  return node;
}

function coverage(data) {
  return data.coverage_start ? join('Measured from ' + data.coverage_start + ' through ' + data.coverage_end,
    data.missing_days ? plural(data.missing_days,'day') + ' without measurements' : null)
    : 'No daily measurements yet';
}

export function vitalSigns(data, compact = false) {
  if (!data.rows.length) return empty(coverage(data));
  const d3 = window.d3;
  const rows = data.rows.slice(-90);
  const values = new Map(rows.map(row => [row.day,row]));
  const start = day(rows[0].day), end = day(rows.at(-1).day);
  const x = d3.scaleUtc().domain(start < end ? [start,end] : [start,d3.utcDay.offset(end,1)]).range([8,232]);
  const tiles = metrics.map(([key,label],index) => {
    const canvas = svg('svg',{viewBox:'0 0 240 69',class:'spark',role:'img','aria-label':label + ' by measured day'});
    const y = d3.scaleLinear().domain([0,Math.max(1,d3.max(rows,row => row[key]))]).range([58,10]);
    const segments = [];
    for (const row of rows) {
      const group = segments.at(-1);
      if (!group || !values.has(d3.utcDay.offset(day(row.day),-1).toISOString().slice(0,10))) segments.push([row]);
      else group.push(row);
    }
    const line = d3.line().x(row => x(day(row.day))).y(row => y(row[key]));
    for (const segment of segments) canvas.append(svg('path',{d:line(segment),fill:'none',stroke:palette[index],'stroke-width':2}));
    for (const row of rows) {
      const point = svg('circle',{cx:x(day(row.day)),cy:y(row[key]),r:3,fill:palette[index]});
      point.append(svg('title',{},row.day + ' · ' + row[key]));
      canvas.append(point);
    }
    return box(meta(label),el('strong','metric-number',rows.at(-1)[key]),canvas);
  });
  return stack(meta(coverage(data)),el('div','metrics',tiles),!compact && details('Measured counts',
    table(['Date',...metrics.map(([,label]) => label)],data.rows.map(row => [row.day,...metrics.map(([key]) => row[key])]))));
}

export function knowledgeMap(data) {
  const d3 = window.d3;
  const nodes = data.nodes.filter(node => Number.isFinite(node.x) && Number.isFinite(node.y));
  if (!nodes.length) return stack(meta(data.message),empty('There are no positioned notes.'));
  const marks = data.misses.points;
  const byId = new Map(nodes.map(node => [node.id,node]));
  const domains = [...new Set(nodes.map(node => node.domain || 'Unspecified'))].sort();
  const colors = d3.scaleOrdinal(domains,palette);
  const canvas = svg('svg',{viewBox:'0 0 860 470',class:'graph','aria-label':'Knowledge map'});
  const points = [...nodes,...marks];
  const x = d3.scaleLinear().domain(d3.extent(points,point => point.x)).range([35,825]);
  const y = d3.scaleLinear().domain(d3.extent(points,point => point.y)).range([440,30]);
  for (const {source,target} of data.edges) {
    const a = byId.get(source), b = byId.get(target);
    if (a && b) canvas.append(svg('line',{x1:x(a.x),y1:y(a.y),x2:x(b.x),y2:y(b.y),class:'edge'}));
  }
  for (const node of nodes) {
    const a = svg('a',{href:url('/note',{path:node.path}),'aria-label':join(node.id,node.title),tabindex:'0'});
    const circle = svg('circle',{cx:x(node.x),cy:y(node.y),r:5.5,fill:colors(node.domain || 'Unspecified'),stroke:'white','stroke-width':1});
    circle.append(svg('title',{},join(node.id,node.title,node.domain)));
    a.append(circle);
    canvas.append(a);
  }
  for (const mark of marks) {
    const a = svg('a',{href:url('/search',{q:mark.query}),'aria-label':'Search miss ' + mark.query});
    a.append(svg('path',{d:'M-6,-6L6,6M6,-6L-6,6',transform:'translate(' + x(mark.x) + ' ' + y(mark.y) + ')',stroke:'#ad2f26','stroke-width':2.5}));
    a.append(svg('title',{},join(mark.query,mark.timestamp)));
    canvas.append(a);
  }
  const unplaced = data.nodes.filter(node => !byId.has(node.id));
  return stack(meta(data.message),canvas,
    inline(...domains.map(domain => {
      const sample = svg('svg',{width:12,height:12,'aria-hidden':true});
      sample.append(svg('circle',{cx:6,cy:6,r:5,fill:colors(domain)}));
      return inline(sample,meta(domain));
    }),marks.length > 0 && chip('× Search miss','red')),
    unplaced.length > 0 && details(plural(unplaced.length,'note') + ' without a current vector',unplaced.map(node => noteLink(node))),
    details('Browse positioned notes',el('ul','',nodes.map(node => el('li','',noteLink(node))))));
}

function ordered(counts) {
  return [...counts].sort(([a,av],[b,bv]) => bv-av || String(a).localeCompare(String(b)));
}

function simpleBars(counts, header, limit = 16) {
  const values = ordered(counts).slice(0,limit);
  if (!values.length) return empty('No recorded values.');
  const maximum = Math.max(1,values[0][1]);
  return table([header,'Count'],values.map(([key,count],index) => {
    const bar = svg('svg',{class:'inline-bar',viewBox:'0 0 120 10',role:'presentation'});
    bar.append(svg('rect',{width:120*count/maximum,height:10,rx:2,fill:palette[index%palette.length]}));
    return [key,inline(meta(count),bar)];
  }));
}

function shape(ctx) {
  const output = el('div','stack',empty('Loading map…'));
  function update(projectMisses = false) {
    output.replaceChildren(empty('Loading map…'));
    ctx.read('map',projectMisses ? {project_misses:1} : {}).then(data => {
      if (ctx.signal.aborted) return;
      output.replaceChildren(knowledgeMap(data),meta(data.misses.message));
      if (data.mode === 'embedding' && !projectMisses) {
        output.append(button('Project recent misses with embedding provider',() => update(true)));
      }
    }).catch(error => ctx.onError(output,error));
  }
  update();
  const domains = ctx.slot('list',data => {
    const rows = window.d3.rollups(data.notes,notes => rowsBy(notes,row => row.type),row => row.domain)
      .sort(([a],[b]) => a.localeCompare(b));
    return rows.length ? table(['Domain','Notes by type'],rows.map(([domain,types]) => [domain,
      inline(...ordered(types).map(([type,count]) => chip(type + ' ' + count)))])) : empty('No notes recorded.');
  });
  const connections = Promise.all([ctx.read('graph'),ctx.read('list')]).then(([graph,inventory]) => {
    const domain = new Map(inventory.notes.map(note => [note.id,note.domain]));
    const edges = graph.edges.filter(edge => !edge.dangling && domain.has(edge.source) && domain.has(edge.target));
    return simpleBars(rowsBy(edges,edge => [domain.get(edge.source),domain.get(edge.target)].sort().join(' ↔ ')), 'Domains');
  });
  const lengths = ctx.slot('lengths',data => {
    const bins = new Map([['Up to 200 words',0],['201–400 words',0],['401–600 words',0],['Over 600 words',0]]);
    const articles = data.notes.filter(note => !note.reference);
    for (const note of articles) {
      const group = [...bins.keys()][note.words <= 200 ? 0 : note.words <= 400 ? 1 : note.words <= 600 ? 2 : 3];
      bins.set(group,bins.get(group) + 1);
    }
    const longest = [...articles].sort((a,b) => b.words-a.words || a.id.localeCompare(b.id)).slice(0,8);
    return articles.length ? stack(meta('Prose words across ' + plural(articles.length,'non-reference note')),simpleBars(bins,'Body length'),
      details('Longest notes',table(['Note','Prose words'],longest.map(note => [noteLink(note),note.words])))) : empty('No non-reference notes.');
  });
  return stack(section('Knowledge map',box(output)),el('div','pair-grid',section('Domains by type',box(domains)),
    section('Links between domains',box(asyncPanel(ctx,connections)))),section('Note length',box(lengths)));
}

function asyncPanel(ctx,promise) {
  const panel = el('div','stack',empty('Loading…'));
  promise.then(content => { if (!ctx.signal.aborted) panel.replaceChildren(content); }).catch(error => ctx.onError(panel,error));
  return panel;
}

function calendar(events) {
  const d3 = window.d3;
  const counts = rowsBy(events.filter(event => event.time),event => event.time.slice(0,10));
  const days = [...counts.keys()].filter(s => /^\d{4}-\d\d-\d\d$/.test(s)).sort();
  if (!days.length) return empty('No dated activity recorded.');
  const last = day(days.at(-1)), first = day(days[0]);
  const start = d3.utcDay.offset(last,-181) > first ? d3.utcDay.offset(last,-181) : first;
  const dates = d3.utcDay.range(start,d3.utcDay.offset(last,1));
  const startWeek = d3.utcMonday.floor(start);
  const max = Math.max(1,...counts.values());
  const color = d3.scaleSqrt().domain([0,max]).range(['#e7edf9','#22429b']);
  const width = (1+d3.utcMonday.count(startWeek,last))*16+52;
  const plot = svg('svg',{viewBox:'0 0 ' + width + ' 131',class:'calendar',role:'img','aria-label':'Activity calendar through ' + days.at(-1)});
  for (const date of dates) {
    const key = date.toISOString().slice(0,10), week = d3.utcMonday.count(startWeek,date);
    const row = (date.getUTCDay()+6)%7;
    const count = counts.get(key)||0;
    const cell = svg('rect',{x:26+week*16,y:4+row*16,width:13,height:13,rx:2,fill:count ? color(count) : '#eeece5'});
    cell.append(svg('title',{},key + ' · ' + plural(count,'recorded event')));
    plot.append(cell);
  }
  return stack(meta(join('Activity from ' + days[0], 'Calendar through ' + days.at(-1))),plot);
}

function trustMap(stale, usage) {
  const d3 = window.d3;
  const opens = d3.rollup(usage.access.filter(row => row.kind === 'open'),rows => d3.sum(rows,item => item.count),row => row.note);
  const today = day(stale.as_of);
  const points = stale.rows.flatMap(note => {
    const verified = asText(note.verified);
    const age = /^\d{4}-\d\d-\d\d$/.test(verified) ? d3.utcDay.count(day(verified),today) : null;
    const reads = opens.get(note.id)||0;
    return Number.isFinite(age) ? [{...note,age,reads}] : [];
  });
  if (!points.length) return stack(usageCoverage(usage),empty('No current notes have a verification date.'));
  const canvas = svg('svg',{viewBox:'0 0 800 320',class:'chart','aria-label':'Note reads by verification age'});
  const x = d3.scaleLinear().domain([0,Math.max(1,d3.max(points,row => row.age))]).nice().range([46,762]);
  const y = d3.scaleLinear().domain([0,Math.max(1,d3.max(points,row => row.reads))]).nice().range([268,20]);
  for (const tick of x.ticks(6)) {
    canvas.append(svg('line',{x1:x(tick),x2:x(tick),y1:20,y2:268,class:'gridline'}));
    canvas.append(svg('text',{x:x(tick),y:290,'text-anchor':'middle'},tick));
  }
  for (const tick of y.ticks(4)) {
    canvas.append(svg('line',{x1:46,x2:762,y1:y(tick),y2:y(tick),class:'gridline'}));
    canvas.append(svg('text',{x:33,y:y(tick)+4,'text-anchor':'end'},tick));
  }
  canvas.append(svg('text',{x:405,y:314,'text-anchor':'middle'},'Days since verification'));
  for (const point of points) {
    const item = svg('a',{href:url('/note',{path:point.path}),'aria-label':join(point.id,point.title)});
    const dot = svg('circle',{cx:x(Math.max(0,point.age)),cy:y(point.reads),r:5,
      fill:point.flags.includes('EDITED-SINCE-VERIFY') ? '#ad4a1c' : '#2a4db8'});
    dot.append(svg('title',{},join(point.title,plural(point.age,'day') + ' since verification',plural(point.reads,'recorded open'))));
    item.append(dot); canvas.append(item);
  }
  const unverified = stale.rows.length-points.length;
  return stack(usageCoverage(usage),
    unverified > 0 && meta(plural(unverified,'unverified note') + ' without a position'),canvas,
    inline(chip('Edited since verification','amber'),link('Open Trust queue','/review?queue=trust')));
}

function trustHistory(data) {
  const d3 = window.d3;
  const rows = data.events.filter(row => row.source === 'journal' && row.time && ['verify','edit','supersede'].includes(row.action));
  if (!rows.length) return empty('No dated trust changes recorded.');
  const orderedDays = rows.map(row => row.time.slice(0,10)).sort();
  const [first,last] = [day(orderedDays[0]),day(orderedDays.at(-1))];
  const weeks = d3.rollup(rows,events => events.length,row => d3.utcMonday.floor(day(row.time)).toISOString().slice(0,10),row => row.action);
  return stack(meta(join('Trust events from ' + first.toISOString().slice(0,10) + ' through ' + last.toISOString().slice(0,10),human(data.coverage))),
    table(['Week beginning','Verifications','Edits','Supersessions'],
      [...weeks].sort(([a],[b]) => b.localeCompare(a)).slice(0,16).map(([week,counts]) => [week,counts.get('verify')||0,counts.get('edit')||0,counts.get('supersede')||0])));
}

function changeHours(data) {
  const events = data.events.filter(row => row.source === 'journal');
  const timed = events.flatMap(row => {
    const match = /T(\d\d):/.exec(row.time || '');
    return match ? [match[1] + ':00'] : [];
  });
  return stack(meta(join('Journal timestamps use the recording host’s local time',
    events.length !== timed.length ? plural(events.length-timed.length,'date-only event') : null)),
    simpleBars(rowsBy(timed,hour => hour),'Hour',24));
}

function time(ctx) {
  const timeline = ctx.read('timeline');
  const stale = ctx.read('stale');
  const trust = stale.then(data => {
    const oldest = data.rows.filter(row => row.age != null).slice(0,12);
    return oldest.length ? table(['Note','Updated','Verified','Age'],oldest.map(row => [
      noteLink(row),row.effective_update || 'Unknown',asText(row.verified)||'Never',plural(row.age,'day')
    ])) : empty('No dated notes.');
  });
  const growth = timeline.then(data => {
    const creates = data.events.filter(event => event.action === 'create' && event.time);
    const weeks = rowsBy(creates,event => window.d3.utcMonday.floor(day(event.time)).toISOString().slice(0,10));
    return stack(meta('Create events from ' + human(data.coverage)),simpleBars(weeks,'Week beginning',20));
  });
  return stack(section('Vital signs',ctx.slot('metrics',data => vitalSigns(data))),
    section('Activity calendar',box(asyncPanel(ctx,timeline.then(data => calendar(data.events))))),
    el('div','pair-grid',section('Growth',box(asyncPanel(ctx,growth))),section('Where trust is oldest',box(asyncPanel(ctx,trust)))),
    section('Trust map',box(asyncPanel(ctx,Promise.all([stale,ctx.read('usage')]).then(([rows,usage]) => trustMap(rows,usage))))),
    el('div','pair-grid',section('Trust over time',box(asyncPanel(ctx,timeline.then(trustHistory)))),
      section('When changes happen',box(asyncPanel(ctx,timeline.then(changeHours))))),
    section('How claims changed',box(asyncPanel(ctx,timeline.then(data => {
      const rows = data.events.filter(event => ['edit','verify','supersede'].includes(event.action)).slice(0,16);
      return rows.length ? stack(...rows.map(eventRow),link('Open full timeline','/timeline')) : empty('No recorded claim changes.');
    })))));
}

function searchFlow(data) {
  const d3 = window.d3;
  const totals = d3.rollup(data.outcomes,values => d3.sum(values,row => row.count),
    row => d3.utcMonday.floor(day(row.day)).toISOString().slice(0,10), row => row.layer);
  return stack(usageCoverage(data),
    totals.size ? table(['Week beginning',...Object.values(layers)], [...totals].sort(([a],[b]) => b.localeCompare(a)).slice(0,16)
      .map(([week,counts]) => [week,...Object.keys(layers).map(layer => counts.get(layer)||0)]))
    : empty('No recorded searches.'));
}

function attention(data, notes) {
  const title = new Map(notes.map(row => [row.id,row]));
  const counts = window.d3.rollup(data.access,rows => window.d3.sum(rows,row => row.count),row => row.note,row => row.kind);
  const sorted = [...counts].sort(([a,aa],[b,bb]) => (bb.get('open')||0)-(aa.get('open')||0)
    || (bb.get('search')||0)-(aa.get('search')||0) || a.localeCompare(b));
  return stack(usageCoverage(data),sorted.length ? table(['Note','Opens','Search exposures','Graph exposures'],sorted.slice(0,20).map(([id,values]) => [
    noteLink(title.get(id)||{id}), values.get('open')||0, values.get('search')||0, values.get('graph')||0
  ])) : empty('No note activity has been recorded.'));
}

function flow(ctx) {
  const timeline = ctx.read('timeline');
  const sources = ctx.read('refs');
  return stack(el('div','pair-grid',
    section('Knowledge changes',box(asyncPanel(ctx,timeline.then(data => simpleBars(rowsBy(data.events,row => human(row.action)),'Action'))))),
    section('Who changes the knowbox',box(asyncPanel(ctx,timeline.then(data => simpleBars(rowsBy(data.events.filter(row => row.source === 'journal'),row => row.client || 'Unknown client'),'Client')))))),
    section('How searches get answered',box(ctx.slot('usage',searchFlow))),
    section('Where agents spend attention',box(asyncPanel(ctx,Promise.all([ctx.read('usage'),ctx.read('list')]).then(([data,notes]) => attention(data,notes.notes))))),
    el('div','pair-grid',section('What happens to proposals',box(asyncPanel(ctx,Promise.all([ctx.read('raw-backlog'),timeline]).then(([raw,data]) => {
      const marked = data.events.filter(row => row.action === 'raw-mark' || row.action === 'ingest');
      return stack(pairs([['Open now',raw.unreviewed],['Total entries now',raw.total],['Journaled ingest',marked.filter(row => row.detail.includes('ingested')).length],
        ['Journaled rejection',marked.filter(row => row.detail.includes('rejected')).length]]),link('Open Inbox','/review?queue=inbox'));
    })))),
    section('What long documents still hold',box(asyncPanel(ctx,sources.then(data => data.state === 'ready'
      ? stack(pairs([['Documents',data.total],['Without a section map',data.unmapped],['Unreadable',data.unreadable]]),link('Open Refs','/refs'))
      : empty('No reference documents found.')))))));
}

export function insights(ctx) {
  const tabs = [['shape','Shape',shape],['time','Time',time],['flow','Flow',flow]];
  const selected = tabs.find(([id]) => id === ctx.query.get('tab')) || tabs[0];
  return stack(hero('Insights'),el('nav','tabs',tabs.map(([id,label]) => {
    const item = link(label,url('/insights',{tab:id}),id === selected[0] ? 'active' : '');
    if (id === selected[0]) item.setAttribute('aria-current','page');
    return item;
  })),selected[2](ctx));
}

export function agent(ctx) {
  const project = textField('Project',ctx.state.agentProject ?? ctx.query.get('project') ?? '');
  const host = textField('Host',ctx.state.agentHost ?? ctx.query.get('host') ?? '');
  const submit = el('button','button primary','Show brief');
  submit.type = 'submit';
  const projectInput = project.querySelector('input'), hostInput = host.querySelector('input');
  projectInput.id = 'agent-project';
  hostInput.id = 'agent-host';
  projectInput.addEventListener('input',() => {ctx.state.agentProject = projectInput.value;});
  hostInput.addEventListener('input',() => {ctx.state.agentHost = hostInput.value;});
  projectInput.required = true;
  hostInput.required = true;
  const form = el('form','inline',project,host,submit);
  form.addEventListener('submit',event => {
    event.preventDefault();
    ctx.update({project:projectInput.value.trim(),host:hostInput.value.trim()});
  });
  const brief = ctx.query.has('project') && ctx.query.has('host') && ctx.slot('context',result => stack(
    inline(chip(result.characters + ' / ' + result.budget + ' characters','blue'),meta(result.usage),
      result.omitted > 0 && meta(plural(result.omitted,'matching item') + ' omitted')),
    el('pre','source',result.text),
    details('Why each note appears',...result.items.map(item => el('div','row',noteLink(item),el('p','',item.reason),
      item.triggers?.length && meta(item.triggers.join(' · ')),meta(join(item.verification,item.flags)))))),
    {project:ctx.query.get('project'),host:ctx.query.get('host')});
  const budget = ctx.slot('index',result => {
    const lines = result.markdown ? result.markdown.trimEnd().split('\n').length : 0;
    return stack(meta(lines ? lines + ' of about 200 routing lines' : 'No routing index'),link('Open routing index','/'));
  });
  const opened = Promise.all([ctx.read('usage'),ctx.read('list')])
    .then(([data,notes]) => attention(data,notes.notes));
  const test = textField('Search note triggers',ctx.state.agentTrigger || '','Describe the task');
  const triggerInput = test.querySelector('input');
  triggerInput.id = 'agent-trigger';
  const matches = el('div','stack');
  const triggerForm = el('form','stack',test,matches);
  const triggerTerms = value => new Set(value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) || []);
  function findTriggers() {
    const draft = triggerInput.value.trim();
    if (!draft) { matches.replaceChildren(); return; }
    const terms = triggerTerms(draft);
    ctx.read('list').then(data => {
      if (ctx.signal.aborted || draft !== triggerInput.value.trim()) return;
      const rows = data.notes.filter(note => note.frontmatter.status !== 'superseded').flatMap(note => {
        const triggers = Array.isArray(note.frontmatter.triggers) ? note.frontmatter.triggers : [note.frontmatter.triggers];
        return triggers.filter(value => typeof value === 'string').flatMap(trigger => {
          const score = [...triggerTerms(trigger)].filter(term => terms.has(term)).length;
          return score ? [{note,trigger,score}] : [];
        });
      }).sort((a,b) => b.score-a.score || a.note.id.localeCompare(b.note.id)).slice(0,10);
      matches.replaceChildren(rows.length ? stack(...rows.map(({note,trigger}) => el('div','row',noteLink(note),meta(trigger)))) : empty('No matching triggers.'));
    }).catch(error => ctx.onError(matches,error));
  }
  triggerForm.addEventListener('submit',event => { event.preventDefault(); findTriggers(); });
  triggerInput.addEventListener('input',() => {ctx.state.agentTrigger = triggerInput.value; findTriggers();});
  if (triggerInput.value) findTriggers();
  return stack(hero('Agent context'),box(form),brief && section('Session-start brief',box(brief)),
    el('div','pair-grid',section('Trigger tester',box(triggerForm)),section('Routing index budget',box(budget))),
    section('What agents open',box(asyncPanel(ctx,opened))));
}
