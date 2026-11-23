// Malý a bezpečný převod Markdownu na DOM. Nikdy nepoužívá innerHTML,
// takže text od AI nemůže do stránky vložit HTML ani skript.

export function renderMarkdown(md, container) {
  container.replaceChildren();
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  let para = null;
  let list = null;
  let listType = null;

  const closePara = () => {
    para = null;
  };
  const closeList = () => {
    list = null;
    listType = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;

    if (!line.trim()) {
      closePara();
      closeList();
      continue;
    }
    if ((m = line.match(/^\s*(#{1,6})\s+(.*)$/))) {
      closePara();
      closeList();
      const h = document.createElement(m[1].length <= 3 ? 'h4' : 'h5');
      appendInline(h, m[2].replace(/\s+#+\s*$/, ''));
      container.append(h);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      closePara();
      closeList();
      container.append(document.createElement('hr'));
      continue;
    }
    if ((m = line.match(/^\s*[-*+•]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      closePara();
      const type = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (!list || listType !== type) {
        list = document.createElement(type);
        listType = type;
        container.append(list);
      }
      const li = document.createElement('li');
      appendInline(li, m[1]);
      list.append(li);
      continue;
    }
    if ((m = line.match(/^\s*>\s?(.*)$/))) {
      closePara();
      closeList();
      const q = document.createElement('blockquote');
      appendInline(q, m[1]);
      container.append(q);
      continue;
    }
    closeList();
    if (!para) {
      para = document.createElement('p');
      container.append(para);
    } else {
      para.append(document.createElement('br'));
    }
    appendInline(para, line.trim());
  }
}

const INLINE = /\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_|`([^`]+)`/g;

function appendInline(parent, text) {
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) parent.append(document.createTextNode(text.slice(last, m.index)));
    let node;
    if (m[1] !== undefined || m[2] !== undefined) {
      node = document.createElement('strong');
      appendInline(node, m[1] ?? m[2]);
    } else if (m[3] !== undefined || m[4] !== undefined) {
      node = document.createElement('em');
      node.textContent = m[3] ?? m[4];
    } else {
      node = document.createElement('code');
      node.textContent = m[5];
    }
    parent.append(node);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}
