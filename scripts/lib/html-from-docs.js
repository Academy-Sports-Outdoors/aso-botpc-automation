const escapeText = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

function safeHref(raw) {
  const value = String(raw || '').trim();
  if (value.startsWith('/') && !value.startsWith('//') && !/[\\\u0000-\u001f]/.test(value)) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function listTag(block, lists) {
  const bullet = block.paragraph?.bullet;
  if (!bullet) return null;
  const level = bullet.nestingLevel || 0;
  const glyph = lists[bullet.listId]?.listProperties?.nestingLevels?.[level]?.glyphType || '';
  return /DECIMAL|ALPHA|ROMAN/.test(glyph) ? 'ol' : 'ul';
}

async function renderInline(paragraph, context) {
  const chunks = [];
  for (const el of paragraph.elements || []) {
    if (el.inlineObjectElement) {
      const id = el.inlineObjectElement.inlineObjectId;
      const object = context.inlineObjects[id]?.inlineObjectProperties?.embeddedObject;
      const uri = object?.imageProperties?.contentUri;
      if (!uri) throw new Error(`Image ${id} has no content URI.`);
      const alt = object.description || object.title || '';
      const src = await context.imageResolver({ id, uri, alt });
      if (!/^https:\/\//.test(src)) throw new Error(`Image ${id} did not resolve to an HTTPS URL.`);
      chunks.push(`<img src="${escapeText(src)}" alt="${escapeText(alt)}">`);
      continue;
    }
    if (!el.textRun) continue;
    const text = el.textRun.content?.replace(/\n$/, '') || '';
    if (!text) continue;
    const style = el.textRun.textStyle || {};
    let html = escapeText(text).replace(/\n/g, '<br>');
    if (style.bold) html = `<strong>${html}</strong>`;
    if (style.italic) html = `<em>${html}</em>`;
    const href = safeHref(style.link?.url);
    if (href) html = `<a href="${escapeText(href)}">${html}</a>`;
    chunks.push(html);
  }
  return chunks.join('');
}

async function renderTable(table, context) {
  const rows = [];
  for (const row of table.tableRows || []) {
    const cells = [];
    for (const cell of row.tableCells || []) {
      const body = await renderBlocks(cell.content || [], context);
      cells.push(`<td>${body}</td>`);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return `<table><tbody>${rows.join('')}</tbody></table>`;
}

export async function renderBlocks(blocks, context) {
  const result = [];
  const stack = [];
  const closeTo = depth => {
    while (stack.length > depth) {
      const current = stack.pop();
      if (current.itemOpen) result.push('</li>');
      result.push(`</${current.tag}>`);
    }
  };
  for (const block of blocks) {
    if (block.table) {
      closeTo(0);
      result.push(await renderTable(block.table, context));
      continue;
    }
    const para = block.paragraph;
    if (!para) continue;
    const body = await renderInline(para, context);
    const tag = listTag(block, context.lists);
    if (tag) {
      const requested = Math.min((para.bullet.nestingLevel || 0) + 1, stack.length + 1);
      closeTo(requested);
      if (stack[requested - 1] && stack[requested - 1].tag !== tag) closeTo(requested - 1);
      else if (stack[requested - 1]?.itemOpen) {
        result.push('</li>');
        stack[requested - 1].itemOpen = false;
      }
      while (stack.length < requested) {
        result.push(`<${tag}>`);
        stack.push({ tag, itemOpen: false });
      }
      result.push(`<li>${body}`);
      stack.at(-1).itemOpen = true;
      continue;
    }
    closeTo(0);
    if (!body.trim()) continue;
    const style = para.paragraphStyle?.namedStyleType;
    const headingTag = style === 'HEADING_2' ? 'h3' : style === 'HEADING_3' ? 'h4' : null;
    const outTag = headingTag || 'p';
    result.push(`<${outTag}>${body}</${outTag}>`);
  }
  closeTo(0);
  return result.join('');
}

export async function renderFaqs(parsed, imageResolver) {
  const context = { lists: parsed.lists, inlineObjects: parsed.inlineObjects, imageResolver };
  const items = [];
  for (const faq of parsed.faqs) {
    const html = await renderBlocks(faq.blocks, context);
    if (!html) throw new Error(`FAQ "${faq.heading}" has no rendered answer.`);
    items.push({ seo_heading: faq.heading, seo_body: html });
  }
  return items;
}

export function previewHtml(parsed, seoContent) {
  const sections = seoContent.map(item => `<details><summary>${escapeText(item.seo_heading)}</summary>${item.seo_body}</details>`).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeText(parsed.plpTitle)} FAQ preview</title><style>body{font:16px/1.5 system-ui;max-width:800px;margin:3rem auto;padding:0 1rem}details{border-block-start:1px solid #ddd;padding:1rem}summary{font-weight:700;cursor:pointer}img{max-width:100%}table{border-collapse:collapse}td{border:1px solid #ddd;padding:.5rem}</style><h1>${escapeText(parsed.plpTitle)}</h1>${sections}</html>`;
}
