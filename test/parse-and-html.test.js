import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseFaqDoc } from '../scripts/lib/parse-faq-doc.js';
import { renderFaqs } from '../scripts/lib/html-from-docs.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/sample-doc.json', import.meta.url)));

test('parses PLP type, normalized path, metadata, and Docs formatting', async () => {
  const parsed = parseFaqDoc(fixture);
  assert.equal(parsed.type, 'L2');
  assert.equal(parsed.url, '/c/kids/boys-cleats');
  assert.equal(parsed.categoryId, '12345');
  const items = await renderFaqs(parsed, () => { throw new Error('unexpected image'); });
  assert.deepEqual(items, [{
    seo_heading: 'How do I choose cleats?',
    seo_body: '<p>Start with <strong>the right fit</strong>.</p><ul><li>Check the surface.</li><li>Try them on.</li></ul><h3>Fit details</h3><p><a href="https://www.academy.com/c/guide">Read our guide</a>.</p>'
  }]);
});

test('fails before writing when required Doc metadata or answer is missing', () => {
  const missingType = structuredClone(fixture);
  missingType.body.content.shift();
  assert.throws(() => parseFaqDoc(missingType), /PLP Type/);
  const missingCategory = structuredClone(fixture);
  missingCategory.body.content.splice(2, 1);
  assert.throws(() => parseFaqDoc(missingCategory), /Category ID/);
  const noAnswer = structuredClone(fixture);
  noAnswer.body.content.length = 4;
  assert.throws(() => parseFaqDoc(noAnswer), /has no answer/);
});

test('rejects unsafe Doc links and escapes text', async () => {
  const doc = structuredClone(fixture);
  doc.body.content[4].paragraph.elements = [
    { textRun: { content: '<script>', textStyle: { link: { url: 'javascript:alert(1)' } } } }
  ];
  const items = await renderFaqs(parseFaqDoc(doc), () => {});
  assert.match(items[0].seo_body, /&lt;script&gt;/);
  assert.doesNotMatch(items[0].seo_body, /javascript:|<script>/);
});

test('renders a native Docs table and escapes its cell text', async () => {
  const doc = structuredClone(fixture);
  doc.body.content.push({ table: { tableRows: [{ tableCells: [
    { content: [{ paragraph: { elements: [{ textRun: { content: 'Size < 5\n' } }] } }] },
    { content: [{ paragraph: { elements: [{ textRun: { content: 'Small\n' } }] } }] }
  ] }] } });
  const items = await renderFaqs(parseFaqDoc(doc), () => {});
  assert.match(items[0].seo_body, /<table><tbody><tr><td><p>Size &lt; 5<\/p><\/td><td><p>Small<\/p><\/td><\/tr><\/tbody><\/table>/);
});

test('reads lists and inline images from Google Docs tab content', async () => {
  const doc = { title: fixture.title, tabs: [{ documentTab: {
    body: structuredClone(fixture.body), lists: structuredClone(fixture.lists),
    inlineObjects: { image1: { inlineObjectProperties: { embeddedObject: {
      description: 'A pair of cleats', imageProperties: { contentUri: 'https://lh3.googleusercontent.com/image' }
    } } } }
  } }] };
  doc.tabs[0].documentTab.body.content.push({ paragraph: { elements: [{ inlineObjectElement: { inlineObjectId: 'image1' } }] } });
  const parsed = parseFaqDoc(doc);
  const items = await renderFaqs(parsed, () => 'https://assets.contentstack.io/image.png');
  assert.match(items[0].seo_body, /<ul><li>Check the surface.<\/li><li>Try them on.<\/li><\/ul>/);
  assert.match(items[0].seo_body, /<img src="https:\/\/assets.contentstack.io\/image.png" alt="A pair of cleats">/);
});
