import { bodyView, box, button, chip, el, empty, hero, inline, join, link, meta, noteLink, notice, section, stack, url } from './ui.js';

const fields = {
  title:'Title', type:'Type', domain:'Domain', status:'Status', confidence:'Confidence',
  project:'Project', source:'Source', summary:'Summary', tags:'Tags', aliases:'Aliases',
  triggers:'Read when', related:'Related IDs', verified:'Verified date'
};
const choices = {
  type:['fact','gotcha','howto','decision','reference','project','session'],
  status:['draft','active','verified','superseded'],
  confidence:['high','medium','low']
};
const listFields = new Set(['tags','aliases','triggers','related']);
const lines = text => text.replace(/\r\n?/g,'\n');
const quote = value => '"' + value + '"';

export function writeAttempt(ctx) {
  let last, requestId;
  return async operation => {
    const payload = JSON.stringify(operation);
    const bytes = new TextEncoder().encode(payload);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    const key = 'knowbox.explorer.pending.' + Array.from(hash,byte => byte.toString(16).padStart(2,'0')).join('');
    if (payload !== last) {
      last = payload;
      try { requestId = sessionStorage.getItem(key); } catch { requestId = null; }
      requestId ||= crypto.randomUUID();
      try { sessionStorage.setItem(key,requestId); } catch {}
    }
    const result = await ctx.post('write',{request_id:requestId, operation});
    try { sessionStorage.removeItem(key); } catch {}
    last = undefined;
    return result;
  };
}

export function writeStatus(result) {
  const git = result.git;
  const parts = [];
  if (result.replayed) parts.push('Recovered the earlier save');
  if (git?.state === 'committed') {
    parts.push(git.new ? 'Committed locally' : 'Local commit already recorded');
    if (git.push?.state === 'pushed') parts.push('Pushed to the configured upstream');
    if (git.push?.state === 'up_to_date') parts.push('Upstream is up to date');
    if (git.push?.state === 'no_remote') parts.push('No Git remote configured');
    if (git.push?.state === 'failed') parts.push(git.push.warning);
  } else if (git?.state === 'no_repository') {
    parts.push('Saved in the local knowledge base');
  }
  return box(el('strong','',result.event.stdout),meta(join(parts)),result.note && noteLink(result.note,'Open ' + result.note.id));
}

export function textField(title, value = '', placeholder = '') {
  const input = el('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  return el('label','field',el('span','',title),input);
}

export function editorUrl(target, proposal, mode) {
  return url('/editor',{
    target, file:proposal?.file, number:proposal?.number, revision:proposal?.revision, mode
  });
}

function preparedSource(text) {
  const match = /^(\uFEFF?---\n)([\s\S]*?)^---(\n|$)/m.exec(text);
  return match?.index === 0 ? { opening:match[1], fields:match[2], end:match[3], body:text.slice(match[0].length) } : null;
}

function readField(middle, key) {
  const rows = middle.split('\n');
  const start = rows.findIndex(line => line.startsWith(key + ':'));
  if (start < 0) return '';
  let value = rows[start].slice(key.length + 1).trim();
  if (listFields.has(key)) {
    if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1,-1);
    if (!value) {
      const list = [];
      for (const row of rows.slice(start+1)) {
        const item = /^\s+-\s+(.*)/.exec(row);
        if (!item) break;
        list.push(item[1].trim());
      }
      value = list.join(', ');
    }
  }
  return !listFields.has(key) && ((value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))) ? value.slice(1,-1) : value;
}

function makeDraft(proposal) {
  return '---\nid: pending\ntitle: ' + quote(proposal?.title || '') + '\ntype: fact\ndomain: \nstatus: active\nconfidence: medium\ncreated: pending\nupdated: pending\ntags: []\naliases: []\nrelated: []\nsupersedes: []\nsource: ' +
    quote(proposal ? 'raw/' + proposal.file + ' #' + proposal.number : '') + '\nsummary: ""\n---\n' + (proposal?.body.trim() || '');
}

function writeField(draft, key, value) {
  const parts = preparedSource(draft);
  if (!parts) return draft;
  const pattern = new RegExp('^' + key + ':[^\\n]*\\n(?:[ \\t]+-[ \\t]+[^\\n]*\\n)*','m');
  const replacement = key + ': ' + encodeField(key,value) + '\n';
  const middle = pattern.test(parts.fields) ? parts.fields.replace(pattern,() => replacement) : parts.fields + replacement;
  return parts.opening + middle + '---' + parts.end + parts.body;
}

function encodeField(key, value) {
  if (listFields.has(key)) return '[' + value.trim() + ']';
  return ['title','summary','source'].includes(key) ? quote(value) : value.trim();
}

function restoreLineEndings(draft, original) {
  if (original?.includes('\r\n') && !original.replaceAll('\r\n','').includes('\n')) return draft.replaceAll('\n','\r\n');
  if (original?.includes('\r') && !original.includes('\n')) return draft.replaceAll('\n','\r');
  return draft;
}

function editInput(opened, draft, rawEdited, markdown) {
  const before = preparedSource(lines(opened.markdown));
  const after = preparedSource(draft);
  if (rawEdited || !before || !after) return {format:'source',markdown};
  const updates = {};
  for (const key of Object.keys(fields)) {
    const value = readField(after.fields,key);
    if (value !== readField(before.fields,key)) updates[key] = encodeField(key,value);
  }
  return { format:'patch', fields:updates,
    body:after.body === before.body ? undefined : restoreLineEndings(after.body,opened.markdown) };
}

function firstClaim(text) {
  const first = text.trim().split(/\n\s*\n/)[0] || '';
  return /^.*?[.!?](?=\s|$)/s.exec(first)?.[0] || first;
}

function errorPanel(error, source) {
  const data = error.data;
  if (data?.code === 'changed') {
    return stack(notice('The note changed while you edited it','Compare both versions before reopening the latest copy. Your draft remains here.'),
      el('div','pair-grid',section('Your draft',el('pre','source',source)),section('Current note',el('pre','source',data.current_markdown))));
  }
  const title = data?.saved ? 'Saved with a follow-up needed' : data?.code === 'incomplete' ? 'Save needs recovery' : 'Save unavailable';
  return stack(notice(title,error.message),
    data?.findings?.length && el('ul','',data.findings.map(message => el('li','',message))),
    data?.saved?.note && noteLink(data.saved.note,'Open saved note'),
    data?.committed_locally && meta('The local commit already exists.'));
}

export async function editor(ctx) {
  if (!ctx.writable) return stack(hero('Editor'),notice('Read-only','Open a writable Knowbox Explorer to create or edit notes.'));
  const target = ctx.query.get('target');
  const requestedMode = ctx.query.get('mode');
  const mode = target && ['split','supersede'].includes(requestedMode) ? requestedMode : 'edit';
  const file = ctx.query.get('file');
  const source = target ? await ctx.read('editor',{target}) : null;
  const opened = mode === 'edit' ? source : null;
  const proposal = file ? (await ctx.read('raw-backlog')).entries.find(row =>
    row.file === file && row.number === Number(ctx.query.get('number')) && row.revision === ctx.query.get('revision')) : null;
  if (file && !proposal) return stack(hero('Proposal unavailable'),notice('Inbox changed','Open the proposal again from Review.'),link('Go to Inbox','/review?queue=inbox'));
  const inbox = proposal ? {file:proposal.file, number:proposal.number, revision:proposal.revision} : undefined;
  const original = opened?.markdown;
  let draft = lines(original || makeDraft(proposal));
  if (source && !opened) {
    for (const key of ['type','domain','project','source']) {
      if (typeof source.frontmatter?.[key] === 'string') draft = writeField(draft,key,source.frontmatter[key]);
    }
  }
  let raw = !preparedSource(draft), rawEdited = false, previewNumber = 0, timer, sentUnknown = null;
  const save = writeAttempt(ctx);
  const status = el('div');
  status.setAttribute('aria-live','polite');
  const output = el('div','editor-preview',empty('Waiting for draft'));
  const report = el('div', 'stack');
  const form = el('form','stack write-form');
  const fieldset = el('div','editor-fields');
  const modeArea = el('div','stack');
  const text = el('textarea','editor-text');
  const label = el('span','', 'Markdown body');
  const textField = el('label','field',label,text);
  const evidence = opened?.frontmatter?.status === 'verified' ? textFieldForEvidence() : null;
  const remaining = mode === 'split' ? el('textarea','editor-text') : null;
  if (remaining) remaining.value = source.body || '';
  const reason = mode === 'supersede' ? textFieldForReason() : null;
  const cancel = source ? noteLink(source,'Cancel') : link('Cancel',proposal ? '/review?queue=inbox' : '/');
  const rawMode = button('Raw source',() => {
    if (raw && !preparedSource(draft)) {
      status.replaceChildren(notice('Frontmatter needs two exact --- fences'));
      return;
    }
    raw = !raw;
    drawFields();
  });
  const submit = el('button','button primary',opened ? 'Save changes' : mode === 'split' ? 'Split and link' : mode === 'supersede' ? 'Create successor' : 'Create note');
  submit.type = 'submit';
  const saveDraft = !source && !proposal && button('Save as draft',() => {
    draft = writeField(draft,'status','draft');
    drawFields();
    form.requestSubmit();
  });
  const links = el('div');
  const drawFields = () => {
    const parts = preparedSource(draft);
    rawMode.textContent = raw ? 'Show fields' : 'Raw source';
    label.textContent = raw ? 'Complete Markdown source' : 'Markdown body';
    text.value = raw ? draft : parts?.body || '';
    fieldset.hidden = raw;
    fieldset.replaceChildren();
    if (parts && !raw) for (const [name,title] of Object.entries(fields)) {
      const value = readField(parts.fields,name);
      const control = choices[name] ? el('select') : el('input');
      if (choices[name]) for (const option of new Set([value,...choices[name]])) control.add(new Option(option,option));
      else control.type = 'text';
      control.value = value;
      control.addEventListener('input', () => {
        draft = writeField(draft,name,control.value);
        schedule();
      });
      fieldset.append(el('label','field',el('span','',title),control));
    }
    schedule();
  };
  const chosenText = () => {
    if (original && draft === lines(original)) return original;
    return restoreLineEndings(draft,original);
  };
  const schedule = () => {
    const generation = ++previewNumber;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (ctx.signal.aborted) return;
      const markdown = chosenText();
      try {
        const data = await ctx.post('draft',{path:opened?.path, markdown});
        if (ctx.signal.aborted || previewNumber !== generation) return;
        output.replaceChildren(data.body_html ? bodyView(data) : empty('No Markdown to preview.'));
        const lint = data.lint;
        report.replaceChildren(inline(chip(lint.errors + ' errors',lint.errors ? 'red' : ''),chip(lint.warnings + ' warnings',lint.warnings ? 'amber' : '')),
          ...lint.findings.map(f => el('div','row',el('small','meta',f.severity),el('p','',f.message))));
      } catch (error) {
        if (!ctx.signal.aborted && previewNumber === generation) report.replaceChildren(notice('Draft lint unavailable',error.message));
      }
      const parts = preparedSource(draft);
      const title = !opened && parts ? readField(parts.fields,'title').trim() : '';
      if (title.length < 4) { links.replaceChildren(); return; }
      try {
        const data = await ctx.read('search',{q:title,local:1});
        if (ctx.signal.aborted || previewNumber !== generation) return;
        const hits = (data.hits || []).filter(row => row.id).slice(0,3);
        links.replaceChildren(...hits.map(row => el('div','row',meta('Related search match'),
          noteLink(row),inline(link('Open for editing',editorUrl(row.path || row.id,proposal)),
          button('Link when creating',() => {
            const selected = preparedSource(draft);
            if (!selected) return;
            const ids = readField(selected.fields,'related').match(/\bkb-\d{4}\b/g) || [];
            draft = writeField(draft,'related',[...new Set([...ids,row.id])].join(', '));
            drawFields();
          })))));
      } catch { /* A stale search index leaves the draft available. */ }
    },260);
  };
  ctx.signal.addEventListener('abort',() => clearTimeout(timer),{once:true});
  text.addEventListener('input',() => {
    const parts = preparedSource(draft);
    if (raw && text.value !== draft) rawEdited = true;
    draft = raw || !parts ? text.value : parts.opening + parts.fields + '---\n' + text.value;
    schedule();
  });
  form.append(modeArea,inline(rawMode,
    opened && link('Split into another note',editorUrl(opened.path,proposal,'split'),'button'),
    opened && link('Supersede with a new note',editorUrl(opened.path,proposal,'supersede'),'button')),
    fieldset,textField,evidence,
    remaining && el('label','field',el('span','','Body remaining in ' + source.id),remaining),
    reason,inline(submit,saveDraft,cancel));
  const setBusy = busy => {
    form.setAttribute('aria-busy',String(busy));
    for (const item of form.querySelectorAll('input, select, textarea, button')) item.disabled = busy;
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const markdown = chosenText();
    const parts = preparedSource(draft);
    const claim = parts && firstClaim(parts.body);
    if (!sentUnknown && opened && claim !== firstClaim(opened.body || '') &&
      !window.confirm('The first sentence changed. Save this edit only if the original claim still holds.')) return;
    let followup;
    if (remaining) followup = {kind:'split',path:source.path,base_sha1:source.base_sha1,remaining:remaining.value};
    if (reason) followup = {kind:'supersede',path:source.path,base_sha1:source.base_sha1,reason:reason.querySelector('input').value.trim()};
    const action = opened ? {
      action:'edit', selector:opened.path, base_sha1:opened.base_sha1, input:editInput(opened,draft,rawEdited,markdown),
      inbox, evidence:evidence?.querySelector('input').value.trim() || undefined
    } : { action:'create', markdown, related:(parts ? readField(parts.fields,'related').match(/\bkb-\d{4}\b/g) : null) || [], inbox, followup };
    const operation = sentUnknown || action;
    setBusy(true);
    status.replaceChildren(meta('Saving…'));
    try {
      const result = await save(operation);
      if (ctx.signal.aborted) return;
      status.replaceChildren(writeStatus(result));
      form.hidden = true;
      sentUnknown = null;
    } catch (error) {
      if (ctx.signal.aborted) return;
      status.replaceChildren(errorPanel(error,markdown));
      if (!error.data || error.data.code === 'incomplete') {
        sentUnknown = operation;
        status.append(button('Retry the same save',() => form.requestSubmit()));
      } else {
        sentUnknown = null;
      }
    } finally {
      if (!ctx.signal.aborted) setBusy(Boolean(sentUnknown));
    }
  });
  drawFields();
  const title = opened ? 'Edit ' + opened.id : mode === 'split' ? 'Split ' + source.id : mode === 'supersede' ? 'Supersede ' + source.id : 'Create a note';
  return stack(hero(title, evidence && 'Edits can make the previous verification stale. Add evidence to verify the new version.'),
    status,el('div','split',stack(box(form),proposal && section('Inbox proposal',box(meta(join(proposal.file,'entry ' + proposal.number)),el('h3','',proposal.title),el('pre','source',proposal.body)))),
      stack(section('Preview',box(output)),section('Draft lint',box(report)),links)));
}

function textFieldForEvidence() {
  return textField('Re-verify with evidence', '', 'Leave empty to keep the existing verification date');
}

function textFieldForReason() {
  const field = textField('Why does the new claim replace the old one?');
  field.querySelector('input').required = true;
  return field;
}
