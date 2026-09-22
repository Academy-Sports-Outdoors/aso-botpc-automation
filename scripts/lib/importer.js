import { PLP_TYPES, PREFOOTER_TYPE, PREFOOTER_TEMPLATE_UID } from './config.js';
import { attachedPrefooterUids, attachPrefooter } from './attach-prefooter.js';
import { stripSystemFields, editUrl } from './contentstack.js';
import { renderFaqs } from './html-from-docs.js';
import { downloadGoogleImage } from './google-docs.js';

const OWNER_TAG = (type, id) => `plp-faq-importer-${type.toLowerCase()}-${id.toLowerCase()}`;
const unique = entries => [...new Map(entries.map(entry => [entry.uid, entry])).values()];

function assertSchema(contentType, type) {
  const fields = new Set((contentType?.schema || []).map(field => field.uid));
  for (const uid of ['url', 'category_id', 'footer_components', 'title']) {
    if (!fields.has(uid)) throw new Error(`${type} schema is missing required field "${uid}". Inspect this page type before importing.`);
  }
}

export async function planImport(parsed, client) {
  const config = PLP_TYPES[parsed.type];
  const types = await Promise.all(Object.entries(PLP_TYPES).map(async ([name, value]) => {
    const schema = await client.getContentType(value.contentType);
    return { name, ...value, schema };
  }));
  const selected = types.find(item => item.name === parsed.type);
  assertSchema(selected.schema, parsed.type);
  const [template, prefooterTemplate] = await Promise.all([
    client.getEntry(config.contentType, config.templateUid),
    client.getEntry(PREFOOTER_TYPE, PREFOOTER_TEMPLATE_UID)
  ]);
  const templateRefs = attachedPrefooterUids(template.footer_components);
  if (templateRefs.length !== 1) throw new Error(`${parsed.type} template must contain exactly one preFooter200 reference slot.`);
  if (!Array.isArray(prefooterTemplate.seo_content)) throw new Error('Pre Footer template has no seo_content array.');

  const matches = await Promise.all(types.map(async item => {
    const fields = new Set((item.schema?.schema || []).map(field => field.uid));
    const byUrl = fields.has('url') ? await client.queryEntries(item.contentType, 'url', parsed.url) : [];
    const byCategory = fields.has('category_id') ? await client.queryEntries(item.contentType, 'category_id', parsed.categoryId) : [];
    return { type: item.name, entries: unique([...byUrl, ...byCategory]).filter(entry => entry.url === parsed.url || String(entry.category_id) === parsed.categoryId) };
  }));
  const conflicts = matches.filter(item => item.type !== parsed.type && item.entries.length);
  if (conflicts.length) throw new Error(`PLP URL or Category ID exists under ${conflicts.map(item => item.type).join(', ')}; check PLP Type in the Doc.`);
  const current = matches.find(item => item.type === parsed.type).entries;
  if (current.length > 1) throw new Error('PLP URL and Category ID match different or duplicate entries. Resolve the conflict in Contentstack.');
  const plp = current[0] ? await client.getEntry(config.contentType, current[0].uid) : null;
  if (plp && (plp.url !== parsed.url || String(plp.category_id) !== parsed.categoryId)) {
    throw new Error('Existing PLP URL and Category ID do not both match the Doc.');
  }
  const attached = plp ? attachedPrefooterUids(plp.footer_components || []) : [];
  if (attached.length > 1) throw new Error('PLP has multiple Pre Footer references.');
  const ownerTag = OWNER_TAG(parsed.type, parsed.categoryId);
  const titleMatches = (await client.queryEntries(PREFOOTER_TYPE, 'title', parsed.entryTitle)).filter(entry => entry.title === parsed.entryTitle);
  if (titleMatches.length > 1) throw new Error('Multiple Pre Footers have the requested title.');
  if (titleMatches[0] && !(titleMatches[0].tags || []).includes(ownerTag)) {
    throw new Error(`Pre Footer title "${parsed.entryTitle}" is already in use by an entry this importer does not own.`);
  }
  let prefooter = null;
  if (attached[0] && attached[0] !== PREFOOTER_TEMPLATE_UID) {
    const entry = await client.getEntry(PREFOOTER_TYPE, attached[0]);
    if ((entry.tags || []).includes(ownerTag)) prefooter = entry;
  }
  if (titleMatches[0]) {
    const byTitle = await client.getEntry(PREFOOTER_TYPE, titleMatches[0].uid);
    if (prefooter && prefooter.uid !== byTitle.uid) throw new Error('Two importer-owned Pre Footers match this PLP.');
    prefooter = byTitle;
  }
  const proposedPlp = plp ? stripSystemFields(plp) : stripSystemFields(template, { clone: true });
  if (!plp) {
    proposedPlp.title = parsed.plpTitle;
    proposedPlp.url = parsed.url;
    proposedPlp.category_id = parsed.categoryId;
    if ('page' in proposedPlp) proposedPlp.page = parsed.plpTitle;
  }
  proposedPlp.footer_components = attachPrefooter(proposedPlp.footer_components || [], template.footer_components, prefooter?.uid || 'blt0000000000000000');
  return {
    config, template, prefooterTemplate, plp, prefooter, proposedPlp, ownerTag,
    summary: {
      type: parsed.type, url: parsed.url, categoryId: parsed.categoryId,
      plpAction: plp ? 'update reference if needed' : 'create from template',
      prefooterAction: prefooter ? 'update dedicated entry' : 'create from template',
      plpUid: plp?.uid || null, prefooterUid: prefooter?.uid || null,
      replacedPrefooterUid: attached[0] && attached[0] !== prefooter?.uid ? attached[0] : null
    }
  };
}

function prefooterPayload(plan, parsed, seoContent) {
  const body = plan.prefooter ? stripSystemFields(plan.prefooter) : stripSystemFields(plan.prefooterTemplate, { clone: true });
  body.title = parsed.entryTitle;
  body.tags = [...new Set([...(body.tags || []), plan.ownerTag])];
  body.seo_content = seoContent;
  return body;
}

async function assertUnchanged(client, type, entry) {
  if (!entry) return;
  const latest = await client.getEntry(type, entry.uid);
  if (latest._version !== entry._version) {
    throw new Error(`${type} ${entry.uid} changed since planning; rerun the import to avoid overwriting another edit.`);
  }
}

export function previewPayload(plan, parsed, seoContent) {
  return {
    summary: plan?.summary || { type: parsed.type, url: parsed.url, categoryId: parsed.categoryId, targetResolution: 'offline preview' },
    prefooter: plan ? prefooterPayload(plan, parsed, seoContent) : { title: parsed.entryTitle, seo_content: seoContent },
    plp: plan?.proposedPlp || null
  };
}

export function changeReport(plan, parsed, seoContent) {
  if (!plan) return {
    target: { type: parsed.type, url: parsed.url, categoryId: parsed.categoryId, targetResolution: 'offline preview' },
    proposedHeadings: seoContent.map(item => item.seo_heading),
    added: null, changed: null, removed: null, unchanged: null,
    note: 'No Contentstack comparison was possible without credentials.'
  };
  const previous = new Map((plan?.prefooter?.seo_content || []).map(item => [item.seo_heading, item.seo_body]));
  const proposed = new Map(seoContent.map(item => [item.seo_heading, item.seo_body]));
  return {
    target: plan.summary,
    added: [...proposed.keys()].filter(heading => !previous.has(heading)),
    changed: [...proposed.keys()].filter(heading => previous.has(heading) && previous.get(heading) !== proposed.get(heading)),
    removed: [...previous.keys()].filter(heading => !proposed.has(heading)),
    unchanged: [...proposed.keys()].filter(heading => previous.has(heading) && previous.get(heading) === proposed.get(heading))
  };
}

export async function applyImport(plan, parsed, client, { docId, googleToken, environment, publish = false, fetchImpl = fetch, assetFolderUid, onProgress = () => {} } = {}) {
  if (publish && !environment) throw new Error('Publishing requires a verified environment.');
  const assets = [];
  const imageResolver = async ({ id, uri, alt }) => {
    const filenameBase = `plp-faq-${docId || 'fixture'}-${id}`.replace(/[^A-Za-z0-9_-]/g, '-');
    const { bytes, contentType } = await downloadGoogleImage(uri, googleToken, fetchImpl);
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[contentType];
    const filename = `${filenameBase}.${ext}`;
    const found = (await client.queryAssets(filename)).filter(item => item.filename === filename);
    if (found.length > 1) throw new Error(`Multiple Contentstack assets have filename ${filename}.`);
    const asset = found[0] || await client.uploadAsset({ bytes, contentType, filename, title: alt || filename, parentUid: assetFolderUid });
    if (!asset.uid || !asset.url) throw new Error(`Asset ${filename} is missing UID or URL.`);
    assets.push(asset);
    return asset.url;
  };
  const seoContent = await renderFaqs(parsed, imageResolver);
  if (publish) {
    for (const asset of unique(assets)) {
      await client.publishAsset(asset.uid, asset._version, environment);
      await client.waitForAssetPublication(asset.uid, asset._version, environment);
    }
  }
  const prefooterBody = prefooterPayload(plan, parsed, seoContent);
  await assertUnchanged(client, PREFOOTER_TYPE, plan.prefooter);
  const prefooter = plan.prefooter
    ? await client.updateEntry(PREFOOTER_TYPE, plan.prefooter.uid, prefooterBody)
    : await client.createEntry(PREFOOTER_TYPE, prefooterBody);
  onProgress(`Pre Footer draft: ${editUrl(PREFOOTER_TYPE, prefooter.uid)}`);
  if (publish) {
    await client.publishEntry(PREFOOTER_TYPE, prefooter.uid, prefooter._version, environment);
    await client.waitForEntryPublication(PREFOOTER_TYPE, prefooter.uid, prefooter._version, environment);
  }
  const plpBody = structuredClone(plan.proposedPlp);
  plpBody.footer_components = attachPrefooter(plpBody.footer_components, plan.template.footer_components, prefooter.uid);
  await assertUnchanged(client, plan.config.contentType, plan.plp);
  const plp = plan.plp
    ? await client.updateEntry(plan.config.contentType, plan.plp.uid, plpBody)
    : await client.createEntry(plan.config.contentType, plpBody);
  onProgress(`PLP draft: ${editUrl(plan.config.contentType, plp.uid)}`);
  if (publish) {
    await client.publishEntry(plan.config.contentType, plp.uid, plp._version, environment);
    await client.waitForEntryPublication(plan.config.contentType, plp.uid, plp._version, environment);
  }
  return {
    plp: { uid: plp.uid, editUrl: editUrl(plan.config.contentType, plp.uid) },
    prefooter: { uid: prefooter.uid, editUrl: editUrl(PREFOOTER_TYPE, prefooter.uid) },
    assets: unique(assets).map(asset => ({ uid: asset.uid, url: asset.url }))
  };
}
