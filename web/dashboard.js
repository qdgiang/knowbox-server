import { el, stack, inline, meta, chip, muted, section, box, empty, notice, plural, join, human, textValue, url, link, noteLink, idLink, hero, button, details, table, sortedValues, repoText } from './ui.js';
import { eventRow } from './atlas.js';
import { editorUrl, textField, writeAttempt, writeStatus } from './editor.js';
import { knowledgeMap, vitalSigns } from './insights.js';

const typeColors = new Map([['fact','#2A4DB8'],['gotcha','#C2410C'],['howto','#0D8278'],['decision','#7940BB'],['reference','#9A6A00'],['project','#BE347E'],['session','#55792C']]);
function domainBar(mix) {
  const canvas = document.createElementNS('http://www.w3.org/2000/svg','svg');
  canvas.setAttribute('viewBox','0 0 100 5');canvas.setAttribute('preserveAspectRatio','none');canvas.setAttribute('class','domain-bar');
  canvas.setAttribute('aria-label',[...mix].map(([type,n]) => plural(n,type)).join(', '));canvas.setAttribute('role','img');
  const total = [...mix.values()].reduce((a,b) => a+b,0);
  const x = window.d3.scaleLinear().domain([0,total]).range([0,100]);
  let offset = 0;
  for (const [type,n] of mix) {
    const rect = document.createElementNS(canvas.namespaceURI,'rect');
    for (const [key,value] of Object.entries({x:x(offset),y:0,width:x(n),height:5,fill:typeColors.get(type) || '#6c737c'})) rect.setAttribute(key,value);
    canvas.append(rect);offset += n;
  }
  return canvas;
}
function domains(notes) {
  const domainMap = new Map(), types = new Set();
  for (const n of notes) {
    if (n.type === 'session') continue;
    types.add(n.type);
    if (!domainMap.has(n.domain)) domainMap.set(n.domain,{count:0,mix:new Map()});
    const row = domainMap.get(n.domain);row.count++;row.mix.set(n.type,(row.mix.get(n.type) || 0)+1);
  }
  const sorted = [...domainMap].sort(([a,x],[b,y]) => y.count-x.count || a.localeCompare(b));
  if (!sorted.length) return empty('No domains with non-session notes.');
  const size = window.d3.scaleQuantize([0,sorted[0][1].count],[1,2,3,4]);
  return stack(inline(...[...types].sort().map(t => inline(domainBar(new Map([[t,1]])),meta(t)))),
    el('div','domain-grid',...sorted.map(([name,{count,mix}]) => link(stack(inline(el('strong','',name),meta(count)),domainBar(mix)),
      url('/search',{domain:name}),'domain size-' + size(count)))),meta('Domain tiles count non-session notes. Their colour bands show the mix of note types.'));
}
function misses(data) {
  return data.entries.length ? stack(...data.entries.map(row =>
    el('div','row',link(row.query,url('/search',{q:row.query})),meta(join(row.timestamp || 'Unknown time',row.client || 'Unknown client',row.session))))) : empty('No search misses recorded.');
}
function metric(ctx,title,api,queue,render,caption) {
  return link(stack(el('span','metric-label',title),ctx.slot(api,render),meta(caption)),url('/review',{queue}),'card metric');
}
const number = (count,unit) => inline(el('b','metric-number',count),el('span','muted',unit));
function conflictsCount(data) {
  return data.state === 'ready' ? number(data.candidates.length,'candidate pairs') : stack(chip('Unavailable','amber'),meta(data.message || human(data.state)));
}
function repoInfo(data) {
  return stack(muted(repoText(data)), data.head && el('div','row',el('strong','',data.head.subject),meta(join(data.head.oid.slice(0,12),data.head.time,data.head.client))),
    data.changes?.length ? details('Working tree changes',...data.changes.map(c => el('div','row',meta(join(c.index + c.worktree,c.kind)),el('code','',join(c.original_path,c.path))))) : null,
    data.heartbeats?.length && section('Service heartbeats',...data.heartbeats.map(h => inline(el('span','',h.service),
      chip(h.state,h.state === 'fresh' ? 'green' : 'amber'),h.age_days != null && meta(plural(h.age_days,'day') + ' old')))));
}
export function home(ctx) {
  const date = new Intl.DateTimeFormat(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());
  const heading = ctx.slot('list', data => hero(plural(data.notes.length,'note') + ' in ' + plural(new Set(data.notes.map(n => n.domain)).size,'domain'),
    join(data.notes.filter(n => n.frontmatter.status === 'verified').length + ' marked verified',data.notes.filter(n => n.frontmatter.status === 'superseded').length + ' superseded',
      plural(data.notes.filter(n => n.type === 'reference').length,'reference note')),date));
  const stats = section('Waiting for your judgment',el('div','metrics',
    metric(ctx,'Conflicts','conflicts','conflicts',conflictsCount,'knowbox conflicts'),
    metric(ctx,'Inbox','raw-backlog','inbox',r => number(r.unreviewed,'open proposals'),'knowbox raw-backlog'),
    metric(ctx,'Trust','stale','trust',r => number(r.rows.filter(n => n.flags.includes('EDITED-SINCE-VERIFY')).length,'edited since verification'),'knowbox stale'),
    metric(ctx,'Lint','lint','lint',r => stack(number(r.errors,'errors'),meta(plural(r.warnings,'warning'))),'knowbox lint')));
  const index = ctx.slot('index',r => {
    if (r.markdown == null) return empty('Run knowbox reindex to create the routing index.');
    const lines = r.markdown.split('\n');
    return stack(el('pre','source index-preview',lines.slice(0,12).join('\n')),lines.length > 12 ? details('Open full index.md',el('pre','source',r.markdown)) : null);
  });
  return stack(heading,stats,
    ctx.insights && section('Vital signs',ctx.slot('metrics',data => vitalSigns(data,true))),
    el('div','split',stack(section('Domains',ctx.slot('list',r => domains(r.notes))),
    ctx.insights && section('Knowledge map',box(ctx.slot('map',knowledgeMap),link('Open Insights','/insights'))),
    section('The routing index',box(index)),section('Recent search misses',box(ctx.slot('misses',misses)))),
    stack(section('Recently changed',box(ctx.slot('timeline',r => r.events.length ? stack(...r.events.slice(0,4).map(eventRow),link('Open timeline','/timeline')) : empty('No events recorded.')))),
      section('Projects and sessions',box(ctx.slot('recent',r => r.sessions.length ? stack(...r.sessions.map(s => el('div','row',noteLink(s),meta(join(s.project,s.created)))),
        meta(plural(r.total,'session') + ' in the inventory')) : empty('No session notes.')))),
      section('Repository',box(ctx.slot('status',repoInfo))))));
}
function reviewForm(ctx, controls, label, action) {
  const status = el('div');
  status.setAttribute('aria-live','polite');
  const form = el('form','write-form stack',controls,status);
  const submit = el('button','button',label);
  submit.type = 'submit';
  form.append(inline(submit));
  const save = writeAttempt(ctx);
  let pending;
  form.addEventListener('submit',async event => {
    event.preventDefault();
    form.setAttribute('aria-busy','true');
    submit.disabled = true;
    status.replaceChildren(meta('Saving…'));
    try {
      pending ||= await action();
      const result = await save(pending);
      if (ctx.signal.aborted) return;
      ctx.state.writeFeedback = result;
      ctx.refresh();
    } catch (error) {
      if (!ctx.signal.aborted) {
        status.replaceChildren(notice('Review action unavailable',error.message));
        if (error.data && error.data.code !== 'incomplete') pending = null;
      }
    } finally {
      form.removeAttribute('aria-busy');
      submit.disabled = false;
    }
  });
  return form;
}
function verdictForm(ctx, c) {
  const verdicts = [['complementary','Complementary'],['duplicate','Duplicate'],['contradiction','Contradiction'],['false-positive','False positive']];
  const picker = el('select');
  for (const [value,label] of verdicts) picker.add(new Option(label,value));
  const reason = textField('Rationale','', 'What distinguishes these two notes?');
  const input = reason.querySelector('input');
  input.required = true;
  const winner = el('select');
  for (const [value,label] of [['','Record verdict only'],[c.a,'Keep ' + c.a],[c.b,'Keep ' + c.b]]) winner.add(new Option(label,value));
  const selection = el('label','field','Claim to retain',winner);
  selection.hidden = true;
  const form = reviewForm(ctx,inline(el('label','field','Verdict',picker),selection,reason),'Record and link',() => ({
    action:'verdict',a:c.a_path,b:c.b_path,verdict:picker.value,reason:input.value.trim(),link:picker.value === 'complementary',
    bases:{a:c.a_base_sha1,b:c.b_base_sha1},
    winner:selection.hidden ? undefined : winner.value || undefined
  }));
  const refresh = () => {
    selection.hidden = !['duplicate','contradiction'].includes(picker.value);
    form.querySelector('button').textContent = picker.value === 'complementary' ? 'Record and link'
      : !selection.hidden && winner.value ? 'Record and supersede' : 'Record verdict';
  };
  picker.addEventListener('change',refresh);
  winner.addEventListener('change',refresh);
  return form;
}
function conflictPanel(data, ctx) {
  if (data.state !== 'ready') return notice('Similarity scan unavailable',data.message || human(data.state));
  return stack(meta(join(plural(data.embedded,'embedded note'),'Up to ' + data.limit + ' unjudged pairs','Minimum cosine ' + data.minimum_cosine)),
    ...data.candidates.map(c => box(inline(chip('Candidate','amber'),meta('cos ' + c.cos.toFixed(3))),
      el('div','pair-grid',...[['a',c.a],['b',c.b]].map(([key,id]) => stack(idLink(id),el('p','',c[key + '_summary']),meta(join(c[key + '_status'],c[key + '_updated']))))),
      ctx.writable && verdictForm(ctx,c))),
    !data.candidates.length && empty('No unjudged candidates in the returned ranking.'));
}
function inbox(data, ctx) {
  return stack(meta(join(plural(data.unreviewed,'open proposal'),plural(data.total,'total entry','total entries'))),
    ...data.entries.map(row => {
      const reason = textField('Reason for rejection');
      const input = reason.querySelector('input');
      input.required = true;
      const proposal = {file:row.file, number:row.number, revision:row.revision};
      return box(meta(join(row.file,'entry ' + row.number)),el('h3','',row.title),el('pre','source',row.body),row.updates && inline(meta('Updates'),idLink(row.updates)),
        ctx.writable && inline(row.updates && link('Apply to ' + row.updates,editorUrl(row.updates,row),'button primary'),
          link('Ingest as new note',editorUrl(null,row),'button')),
        ctx.writable && details('Reject proposal',reviewForm(ctx,reason,'Reject',() => ({action:'reject',inbox:proposal,reason:input.value.trim()}))));
    }),
    !data.entries.length && empty('No open proposals.'));
}
function trust(data, ctx) {
  const rows = data.rows.filter(row => row.flags.length);
  const columns = ['Flag','Note','Verified','Age'];
  if (ctx.writable) columns.push('Evidence');
  return stack(meta(join('As of ' + data.as_of,'Stale threshold ' + plural(data.days,'day'))),rows.length ? table(columns,rows.map(n => {
    const cells = [inline(...n.flags.map(flag => chip(flag.toLowerCase().replaceAll('-',' '),'amber'))),stack(noteLink(n),meta(n.id)),textValue(n.verified) || 'Never',
      n.age == null ? 'Unknown' : plural(n.age,'day')];
    if (ctx.writable) {
      const evidence = textField('What did you check?');
      const input = evidence.querySelector('input');
      input.required = true;
      cells.push(reviewForm(ctx,evidence,'Verify',() => ({
        action:'edit',selector:n.path,base_sha1:n.base_sha1,input:{format:'patch',fields:{}},evidence:input.value.trim()
      })));
    }
    return cells;
  })) : empty('No notes flagged by the stale check.'));
}
function lint(data, ctx) {
  return stack(meta(join(plural(data.errors,'error'),plural(data.warnings,'warning'),data.waived + ' waived',plural(data.notes,'note'))),
    ...data.findings.map(f => el('div','row',inline(chip(f.severity,f.waived ? '' : f.severity === 'error' ? 'red' : 'amber'),f.waived && chip('Waived'),meta(f.code)),
      el('p','',f.message),f.path?.startsWith('notes/') && inline(noteLink({path:f.path},f.path),
        ctx.writable && link('Open in Editor',editorUrl(f.path),'button')))),
    !data.findings.length && empty('No lint findings.'));
}
function usageSummary(data) {
  const kinds = new Map();
  for (const row of data.access) kinds.set(row.kind,(kinds.get(row.kind) || 0) + row.count);
  const outcomes = new Map();
  for (const row of data.outcomes) outcomes.set(row.layer,(outcomes.get(row.layer) || 0) + row.count);
  return stack(meta(data.coverage_start ? 'Recorded since ' + data.coverage_start : 'No recorded coverage'),
    table(['Activity','Count'],[['Note opens',kinds.get('open') || 0],['Search exposures',kinds.get('search') || 0],['Graph exposures',kinds.get('graph') || 0]]),
    outcomes.size ? details('Search outcomes',table(['Layer','Searches'],[...outcomes])) : empty('No recorded searches.'),
    data.dropped_rows ? meta('Dropped records: ' + data.dropped_rows) : null,
    data.gaps?.length ? meta('Coverage gaps: ' + data.gaps.map(textValue).join(', ')) : null);
}
function gaps(ctx) {
  return stack(section('Link inventory',box(ctx.slot('graph',g => stack(link(plural(g.isolates.length,'isolated note'),'/graph'),meta(plural(g.edges.filter(e => e.dangling).length,'dangling link')))))),
    section('Unmapped documents',box(ctx.slot('refs',r => r.state === 'ready' ? link(plural(r.unmapped,'document') + ' without a map','/refs') : empty(r.state === 'missing' ? 'The refs directory is missing.' : 'The refs directory is empty.')))),
    section('Recent search misses',box(ctx.slot('misses',misses))));
}
export function review(ctx) {
  const queues = [
    ['conflicts','Conflicts','Cached similarity candidates','conflicts',conflictPanel],['inbox','Inbox','Open raw proposals','raw-backlog',inbox],
    ['trust','Trust','Verification and age','stale',trust],['lint','Lint','Findings and waivers','lint',lint],['gaps','Gaps','Links, maps and misses'],
    ['usage','Usage','Recorded opens and exposures','usage',usageSummary]
  ];
  const selected = queues.find(([id]) => id === ctx.query.get('queue')) || queues[0];
  const nav = box(el('h2','','Queues'),...queues.map(([id,label,desc]) => {
    const a = link(stack(el('strong','',label),meta(desc)),url('/review',{queue:id}),'row ref-link' + (selected[0] === id ? ' selected' : ''));
    if (selected[0] === id) a.setAttribute('aria-current','page');
    return a;
  }));
  const [,name,,api,render] = selected;
  const verdicts = selected[0] === 'conflicts' && section('Recorded verdicts',box(ctx.slot('timeline',data => {
    const rows = data.events.filter(e => e.action === 'verdict');
    return rows.length ? stack(...rows.map(eventRow)) : empty('No verdicts recorded in raw/.');
  })));
  return stack(hero('Review','Inspect the evidence behind open proposals, trust signals and maintenance findings.'),
    ctx.state.writeFeedback && writeStatus(ctx.state.writeFeedback),
    el('div','sidebar-grid',nav,stack(section(name,api ? box(ctx.slot(api,data => render(data,ctx))) : gaps(ctx)),verdicts)));
}
