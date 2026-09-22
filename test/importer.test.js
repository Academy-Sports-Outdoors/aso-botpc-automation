import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseFaqDoc } from '../scripts/lib/parse-faq-doc.js';
import { planImport, applyImport } from '../scripts/lib/importer.js';
import { attachedPrefooterUids } from '../scripts/lib/attach-prefooter.js';
import { PLP_TYPES, PREFOOTER_TEMPLATE_UID } from '../scripts/lib/config.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/sample-doc.json', import.meta.url)));
const parsed = parseFaqDoc(fixture);

function fakeClient() {
  const entries = new Map();
  const schemas = new Map();
  const writes = [];
  for (const [, config] of Object.entries(PLP_TYPES)) {
    schemas.set(config.contentType, { schema: ['title', 'page', 'url', 'category_id', 'footer_components'].map(uid => ({ uid })) });
    entries.set(`${config.contentType}:${config.templateUid}`, {
      uid: config.templateUid, title: 'Template', url: '/template-plp', category_id: '[Category-ID]', page: 'Template',
      footer_components: [
        { preFooter200: [{ uid: PREFOOTER_TEMPLATE_UID, _content_type_uid: 'preFooter200' }] },
        { feedback: [{ uid: 'bltfeedback1', _content_type_uid: 'feedback' }] }
      ],
      main_components: [{ productListingPage200: [{ uid: 'blt5314d342aa913deb' }] }]
    });
  }
  entries.set(`preFooter200:${PREFOOTER_TEMPLATE_UID}`, { uid: PREFOOTER_TEMPLATE_UID, title: 'Template Pre Footer', seo_content: [], tags: [] });
  return {
    entries, writes, schemas,
    async getContentType(type) { return schemas.get(type); },
    async getEntry(type, uid) { const entry = entries.get(`${type}:${uid}`); if (!entry) throw new Error(`missing ${type}:${uid}`); return structuredClone(entry); },
    async queryEntries(type, field, value) {
      return [...entries.entries()].filter(([key, entry]) => key.startsWith(`${type}:`) && entry[field] === value).map(([, entry]) => structuredClone(entry));
    },
    async createEntry(type, entry) {
      const uid = `bltcreated${writes.length + 1}`;
      const result = { ...structuredClone(entry), uid, _version: 1 };
      entries.set(`${type}:${uid}`, result);
      writes.push({ method: 'POST', type, entry: result });
      return result;
    },
    async updateEntry(type, uid, entry) {
      const old = entries.get(`${type}:${uid}`);
      const result = { ...structuredClone(entry), uid, _version: old._version + 1 };
      entries.set(`${type}:${uid}`, result);
      writes.push({ method: 'PUT', type, entry: result });
      return result;
    },
    async queryAssets() { return []; },
    async validateEnvironment() { return 'development'; },
    async publishEntry(type, uid) { writes.push({ method: 'PUBLISH', type, uid }); },
    async waitForEntryPublication(type, uid) { writes.push({ method: 'CONFIRM', type, uid }); }
  };
}

test('dry-run planning makes no writes and preserves other footer references', async () => {
  const client = fakeClient();
  const plan = await planImport(parsed, client);
  assert.equal(client.writes.length, 0);
  assert.equal(plan.summary.plpAction, 'create from template');
  assert.equal(plan.proposedPlp.title, 'Boys Cleats PLP | 12345');
  assert.equal(plan.proposedPlp.page, 'Boys Cleats PLP');
  assert.equal(plan.proposedPlp.footer_components[1].feedback[0].uid, 'bltfeedback1');
  assert.equal(plan.proposedPlp.main_components[0].productListingPage200[0].uid, 'blt5314d342aa913deb');
});

test('creates dedicated Pre Footer and L2 PLP, then updates both on rerun', async () => {
  const client = fakeClient();
  const firstPlan = await planImport(parsed, client);
  const first = await applyImport(firstPlan, parsed, client);
  assert.equal(client.writes[0].type, 'preFooter200');
  assert.equal(client.writes[1].type, 'l2CategoryPlpPage');
  assert.deepEqual(attachedPrefooterUids(client.writes[1].entry.footer_components), [first.prefooter.uid]);
  const secondPlan = await planImport(parsed, client);
  const second = await applyImport(secondPlan, parsed, client);
  assert.equal(second.plp.uid, first.plp.uid);
  assert.equal(second.prefooter.uid, first.prefooter.uid);
  assert.deepEqual(client.writes.map(write => write.method), ['POST', 'POST', 'PUT', 'PUT']);
});

test('stops when the Doc PLP type disagrees with an existing page', async () => {
  const client = fakeClient();
  client.entries.set('brandPlpPage:bltwrongtype', { uid: 'bltwrongtype', url: parsed.url, category_id: parsed.categoryId });
  await assert.rejects(() => planImport(parsed, client), /exists under Brand/);
  assert.equal(client.writes.length, 0);
});

test('stops when a template lacks the Pre Footer slot', async () => {
  const client = fakeClient();
  const config = PLP_TYPES.L2;
  client.entries.get(`${config.contentType}:${config.templateUid}`).footer_components = [];
  await assert.rejects(() => planImport(parsed, client), /exactly one preFooter200/);
  assert.equal(client.writes.length, 0);
});

test('selects the declared template for every supported PLP type', async () => {
  for (const type of Object.keys(PLP_TYPES)) {
    const client = fakeClient();
    const candidate = { ...parsed, type, plpTitle: `${type} PLP | 12345`, pageName: `${type} PLP`, entryTitle: `Pre Footer | ${type} | 12345` };
    const plan = await planImport(candidate, client);
    assert.equal(plan.config.contentType, PLP_TYPES[type].contentType);
    assert.equal(plan.config.templateUid, PLP_TYPES[type].templateUid);
    assert.equal(plan.proposedPlp.category_id, '12345');
  }
});

test('requires a distinct Page Name only when creating a PLP', async () => {
  const missing = { ...parsed, pageName: null };
  await assert.rejects(() => planImport(missing, fakeClient()), /Page Name is required/);
  const duplicate = { ...parsed, pageName: parsed.plpTitle.toUpperCase() };
  await assert.rejects(() => planImport(duplicate, fakeClient()), /different from PLP Title/);

  const client = fakeClient();
  const config = PLP_TYPES.L2;
  const existing = structuredClone(client.entries.get(`${config.contentType}:${config.templateUid}`));
  existing.uid = 'bltexistingplp';
  existing.url = parsed.url;
  existing.category_id = parsed.categoryId;
  existing.title = 'Existing title';
  existing.page = 'Existing page name';
  client.entries.set(`${config.contentType}:${existing.uid}`, existing);
  const plan = await planImport(missing, client);
  assert.equal(plan.proposedPlp.title, 'Existing title');
  assert.equal(plan.proposedPlp.page, 'Existing page name');
});

test('creates a dedicated copy when an existing PLP points at an unowned Pre Footer', async () => {
  const client = fakeClient();
  const config = PLP_TYPES.L2;
  const existing = structuredClone(client.entries.get(`${config.contentType}:${config.templateUid}`));
  existing.uid = 'bltexistingplp';
  existing.url = parsed.url;
  existing.category_id = parsed.categoryId;
  existing.footer_components[0].preFooter200[0].uid = 'bltmanualfooter';
  client.entries.set(`${config.contentType}:${existing.uid}`, existing);
  client.entries.set('preFooter200:bltmanualfooter', { uid: 'bltmanualfooter', title: 'Manual footer', seo_content: [], tags: [] });
  const plan = await planImport(parsed, client);
  assert.equal(plan.prefooter, null);
  await applyImport(plan, parsed, client);
  assert.equal(client.writes[0].method, 'POST');
  assert.equal(client.writes[0].type, 'preFooter200');
  assert.equal(client.entries.get('preFooter200:bltmanualfooter').title, 'Manual footer');
  assert.equal(client.writes[1].entry.footer_components[1].feedback[0].uid, 'bltfeedback1');
});

test('does not overwrite a Pre Footer changed after planning', async () => {
  const client = fakeClient();
  await applyImport(await planImport(parsed, client), parsed, client);
  const plan = await planImport(parsed, client);
  client.entries.get(`preFooter200:${plan.prefooter.uid}`)._version++;
  const writesBefore = client.writes.length;
  await assert.rejects(() => applyImport(plan, parsed, client), /changed since planning/);
  assert.equal(client.writes.length, writesBefore);
});

test('confirms Pre Footer publication before updating or publishing the PLP', async () => {
  const client = fakeClient();
  const plan = await planImport(parsed, client);
  await applyImport(plan, parsed, client, { publish: true, environment: 'development' });
  assert.deepEqual(client.writes.map(write => `${write.method}:${write.type}`), [
    'POST:preFooter200', 'PUBLISH:preFooter200', 'CONFIRM:preFooter200',
    'POST:l2CategoryPlpPage', 'PUBLISH:l2CategoryPlpPage', 'CONFIRM:l2CategoryPlpPage'
  ]);
});

test('uploads and confirms an inline image before publishing entries', async () => {
  const withImage = structuredClone(parsed);
  withImage.faqs[0].blocks.push({ paragraph: { elements: [{ inlineObjectElement: { inlineObjectId: 'image1' } }] } });
  withImage.inlineObjects = { image1: { inlineObjectProperties: { embeddedObject: {
    description: 'Boys cleats', imageProperties: { contentUri: 'https://lh3.googleusercontent.com/image' }
  } } } };
  const client = fakeClient();
  client.uploadAsset = async ({ filename }) => {
    client.writes.push({ method: 'UPLOAD', type: 'asset', filename });
    return { uid: 'bltasset1', filename, url: 'https://assets.contentstack.io/image.png', _version: 1 };
  };
  client.publishAsset = async uid => client.writes.push({ method: 'PUBLISH', type: 'asset', uid });
  client.waitForAssetPublication = async uid => client.writes.push({ method: 'CONFIRM', type: 'asset', uid });
  const fetchImpl = async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } });
  const plan = await planImport(withImage, client);
  await applyImport(plan, withImage, client, {
    publish: true, environment: 'development', docId: 'test-doc', googleToken: 'test-token', fetchImpl
  });
  assert.deepEqual(client.writes.slice(0, 6).map(write => `${write.method}:${write.type}`), [
    'UPLOAD:asset', 'PUBLISH:asset', 'CONFIRM:asset',
    'POST:preFooter200', 'PUBLISH:preFooter200', 'CONFIRM:preFooter200'
  ]);
  assert.match(client.writes[3].entry.seo_content[0].seo_body, /<img src="https:\/\/assets.contentstack.io\/image.png" alt="Boys cleats">/);
});
