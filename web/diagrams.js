export function renderDiagrams(root) {
  const diagrams = [...root.querySelectorAll('pre > code.language-mermaid')].slice(0,8);
  for (const code of diagrams) render(code);
}

function render(code) {
  const text = code.textContent;
  if (!text || text.trimEnd().split('\n').length > 15 || text.length > 8192) return;
  const token = [...crypto.getRandomValues(new Uint32Array(4))].join('-');
  const frame = document.createElement('iframe');
  frame.className = 'mermaid-frame';
  frame.title = 'Mermaid diagram';
  frame.sandbox = 'allow-scripts';
  frame.classList.add('mermaid-pending');
  frame.setAttribute('aria-hidden','true');
  const original = code.parentElement;
  let timeout;
  const tidy = () => {
    clearTimeout(timeout);
    window.removeEventListener('message', update);
  };
  const update = event => {
    if (event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.token !== token) return;
    tidy();
    if (Number.isFinite(event.data.height) && event.data.height > 0 && frame.isConnected) {
      frame.setAttribute('height',String(Math.min(800,Math.ceil(event.data.height + 8))));
      frame.classList.remove('mermaid-pending');
      frame.removeAttribute('aria-hidden');
      original.hidden = true;
    } else {
      frame.remove();
    }
  };
  window.addEventListener('message',update);
  timeout = setTimeout(() => { tidy(); frame.remove(); },8000);
  frame.addEventListener('load',() => frame.contentWindow?.postMessage({token,text},'*'),{once:true});
  frame.src = '/assets/diagram.html';
  original.after(frame);
}
