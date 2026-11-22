window.addEventListener('message',async event => {
  if (event.source !== parent || typeof event.data?.text !== 'string' || typeof event.data.token !== 'string') return;
  const {text,token} = event.data;
  let height = 0;
  try {
    globalThis.mermaid.initialize({
      startOnLoad:false, securityLevel:'strict', htmlLabels:false,
      maxTextSize:8192, maxEdges:90, suppressErrorRendering:true
    });
    const withoutConfig = text.replace(/^\s*---[\s\S]*?\n---\s*/,'').replace(/%%\{[\s\S]*?\}%%/g,'');
    const element = document.getElementById('diagram');
    const {svg} = await globalThis.mermaid.render('diagram-svg',withoutConfig);
    const image = document.createElement('img');
    image.alt = 'Mermaid diagram';
    image.style.width = '100%';
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await image.decode();
    element.replaceChildren(image);
    height = image.getBoundingClientRect().height;
  } catch (error) {
    console.debug('Mermaid rendering fell back to source', error.message);
  }
  parent.postMessage({token,height},'*');
},{once:true});
