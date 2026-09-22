import { canonicalPlpType } from './config.js';

export function documentData(doc) {
  if (Array.isArray(doc.tabs) && doc.tabs.length) {
    const tabs = [];
    const collect = tab => {
      const data = tab.documentTab;
      if (data?.body?.content?.some(block => block.table || block.paragraph?.elements?.some(el => el.textRun?.content?.trim() || el.inlineObjectElement))) tabs.push(data);
      for (const child of tab.childTabs || []) collect(child);
    };
    for (const tab of doc.tabs) collect(tab);
    if (tabs.length !== 1) throw new Error(`Expected one populated Google Doc tab; found ${tabs.length}.`);
    return tabs[0];
  }
  if (doc.body?.content?.length) return doc;
  throw new Error('Google Doc has no body content.');
}

export function paragraphText(paragraph) {
  return (paragraph?.elements || []).map(el => el.textRun?.content || '').join('').trim();
}

export function normalizePlpUrl(value) {
  const text = String(value || '').trim();
  let path;
  if (text.startsWith('/')) path = text;
  else {
    let url;
    try { url = new URL(text); } catch { throw new Error('PLP URL must be a relative path or academy.com URL.'); }
    if (!['academy.com', 'www.academy.com'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('PLP URL must point to academy.com.');
    }
    path = url.pathname;
  }
  path = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (!path.startsWith('/c/') || path.includes('..') || /[\u0000-\u001f]/.test(path)) {
    throw new Error('PLP URL must be a valid /c/ storefront path.');
  }
  return path;
}

const META = new Map([
  ['plp type', 'type'], ['plp url', 'url'], ['category id', 'categoryId'],
  ['plp title', 'plpTitle'], ['entry title', 'entryTitle']
]);

export function parseFaqDoc(doc) {
  const data = documentData(doc);
  const blocks = data.body.content;
  const metadata = {};
  const faqs = [];
  let current = null;
  let inFaqs = false;
  for (const block of blocks) {
    const para = block.paragraph;
    const text = para ? paragraphText(para) : '';
    const style = para?.paragraphStyle?.namedStyleType;
    const fallback = text.match(/^FAQ:\s*(.+)$/i);
    const isFaq = Boolean((style === 'HEADING_1' && text) || fallback);
    if (isFaq) {
      inFaqs = true;
      current = { heading: fallback ? fallback[1].trim() : text, blocks: [] };
      if (!current.heading) throw new Error('FAQ heading cannot be empty.');
      faqs.push(current);
      continue;
    }
    if (!inFaqs) {
      if (!para || !text) continue;
      const match = text.match(/^([^:]+):\s*(.*)$/);
      const key = META.get(match?.[1]?.trim().toLowerCase());
      if (!key) throw new Error(`Unexpected text before the first FAQ: ${text.slice(0, 80)}`);
      if (!match[2].trim()) throw new Error(`${match[1]} cannot be empty.`);
      if (metadata[key] !== undefined) throw new Error(`Duplicate metadata field: ${match[1]}.`);
      metadata[key] = match[2].trim();
    } else if (block.paragraph || block.table) {
      current.blocks.push(block);
    }
  }
  const type = canonicalPlpType(metadata.type);
  if (!type) throw new Error('PLP Type must be Brand, L1, L2, or L3.');
  if (!metadata.url) throw new Error('PLP URL is required.');
  if (!metadata.categoryId) throw new Error('Category ID is required.');
  if (!/^[A-Za-z0-9_-]+$/.test(metadata.categoryId)) throw new Error('Category ID contains invalid characters.');
  if (!faqs.length) throw new Error('At least one Heading 1 or FAQ: section is required.');
  for (const faq of faqs) {
    if (!faq.blocks.some(block => block.table || block.paragraph?.elements?.some(el => el.textRun?.content?.trim() || el.inlineObjectElement))) {
      throw new Error(`FAQ "${faq.heading}" has no answer.`);
    }
  }
  return {
    docTitle: doc.title || '',
    type, url: normalizePlpUrl(metadata.url), categoryId: metadata.categoryId,
    plpTitle: metadata.plpTitle || `${type} PLP | ${metadata.categoryId}`,
    entryTitle: metadata.entryTitle || `Pre Footer | ${type} | ${metadata.categoryId}`,
    faqs,
    inlineObjects: data.inlineObjects || {},
    lists: data.lists || {}
  };
}
