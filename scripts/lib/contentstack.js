import { LOCALE, STACK_UID } from './config.js';

const SYSTEM_FIELDS = new Set(['uid', 'ACL', 'created_at', 'created_by', 'updated_at', 'updated_by', '_version', '_in_progress', 'locale', 'publish_details', '_workflow', '_metadata', '_branch']);
export function stripSystemFields(entry, { clone = false } = {}) {
  const result = {};
  for (const [key, value] of Object.entries(entry || {})) {
    if (SYSTEM_FIELDS.has(key)) continue;
    result[key] = clone ? stripNestedMetadata(value) : structuredClone(value);
  }
  return result;
}

function stripNestedMetadata(value) {
  if (Array.isArray(value)) return value.map(stripNestedMetadata);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '_metadata').map(([key, child]) => [key, stripNestedMetadata(child)]));
  return value;
}

export function editUrl(contentType, uid, stackUid = process.env.CS_STACK_UID || STACK_UID) {
  const stack = process.env.GITHUB_ACTIONS === 'true' ? `%${stackUid.charCodeAt(0).toString(16)}${stackUid.slice(1)}` : stackUid;
  return `https://app.contentstack.com/#!/stack/${stack}/content-type/${contentType}/${LOCALE}/entry/${uid}/edit`;
}

export class ContentstackClient {
  constructor({ fetchImpl = fetch, env = process.env } = {}) {
    this.fetch = fetchImpl;
    this.apiKey = env.CS_API_KEY;
    this.authtoken = env.CS_AUTHTOKEN;
    this.base = (env.CS_CMA_BASE_URL || 'https://app.contentstack.com/api/v3').replace(/\/+$/, '');
    if (!this.apiKey || !this.authtoken) throw new Error('CS_API_KEY and CS_AUTHTOKEN are required for Contentstack access.');
  }

  headers(extra = {}) {
    return {
      api_key: this.apiKey,
      Cookie: `authtoken=${this.authtoken}`,
      origin: 'https://app.contentstack.com',
      referer: 'https://app.contentstack.com/',
      'x-user-agent': 'contentstack-management-javascript/1.27.3',
      ...extra
    };
  }

  async request(method, path, { body, multipart } = {}) {
    const response = await this.fetch(`${this.base}${path}`, {
      method,
      headers: this.headers(multipart ? {} : { 'Content-Type': 'application/json' }),
      ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45000)
    });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    if (!response.ok) throw new Error(`Contentstack ${method} ${path.split('?')[0]} failed (${response.status}): ${json.error_message || json.error || text.slice(0, 250)}`);
    return json;
  }

  entryPath(type, uid) {
    return `/content_types/${encodeURIComponent(type)}/entries${uid ? `/${encodeURIComponent(uid)}` : ''}`;
  }

  async getContentType(type) {
    return (await this.request('GET', `/content_types/${encodeURIComponent(type)}`)).content_type;
  }

  async getEntry(type, uid) {
    const result = await this.request('GET', `${this.entryPath(type, uid)}?locale=${LOCALE}`);
    if (!result.entry) throw new Error(`Contentstack did not return ${type} ${uid}.`);
    return result.entry;
  }

  async queryEntries(type, field, value) {
    const query = encodeURIComponent(JSON.stringify({ [field]: value }));
    const result = await this.request('GET', `${this.entryPath(type)}?locale=${LOCALE}&limit=2&query=${query}`);
    return result.entries || [];
  }

  async createEntry(type, entry) {
    const result = await this.request('POST', `${this.entryPath(type)}?locale=${LOCALE}`, { body: { entry } });
    if (!result.entry?.uid) throw new Error(`Contentstack create ${type} returned no entry UID.`);
    return result.entry;
  }

  async updateEntry(type, uid, entry) {
    const result = await this.request('PUT', `${this.entryPath(type, uid)}?locale=${LOCALE}`, { body: { entry } });
    if (!result.entry?.uid) throw new Error(`Contentstack update ${type} returned no entry UID.`);
    return result.entry;
  }

  async uploadAsset({ bytes, contentType, filename, title, parentUid }) {
    const form = new FormData();
    form.set('asset[upload]', new Blob([bytes], { type: contentType }), filename);
    form.set('asset[title]', title);
    if (parentUid) form.set('asset[parent_uid]', parentUid);
    const result = await this.request('POST', '/assets', { body: form, multipart: true });
    if (!result.asset?.url) throw new Error('Contentstack asset upload returned no CDN URL.');
    return result.asset;
  }

  async queryAssets(filename) {
    const query = encodeURIComponent(JSON.stringify({ filename }));
    const result = await this.request('GET', `/assets?limit=2&query=${query}`);
    return result.assets || [];
  }

  async publishEntry(type, uid, version, environment) {
    if (!environment) throw new Error('A publish environment is required.');
    if (!Number.isInteger(version)) throw new Error(`Missing version for ${type} ${uid}.`);
    return this.request('POST', `${this.entryPath(type, uid)}/publish`, {
      body: { entry: { environments: [environment], locales: [LOCALE] }, locale: LOCALE, version }
    });
  }

  async publishAsset(uid, version, environment) {
    if (!Number.isInteger(version)) throw new Error(`Missing version for asset ${uid}.`);
    return this.request('POST', `/assets/${encodeURIComponent(uid)}/publish`, {
      body: { asset: { environments: [environment], locales: [LOCALE] }, version }
    });
  }

  async validateEnvironment(value) {
    const result = await this.request('GET', '/environments?include_count=true');
    const match = (result.environments || []).find(item => item.uid === value || item.name === value);
    if (!match) throw new Error(`Publish environment "${value}" does not exist in this stack.`);
    return match.name;
  }

  async waitForEntryPublication(type, uid, version, environment) {
    const path = `${this.entryPath(type, uid)}?locale=${LOCALE}&environment=${encodeURIComponent(environment)}`;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const result = await this.request('GET', path);
        if (result.entry?._version === version) return;
      } catch (error) {
        if (attempt === 11) throw error;
      }
      await new Promise(done => setTimeout(done, 3000));
    }
    throw new Error(`${type} ${uid} did not reach published version ${version} in ${environment}; PLP was not updated.`);
  }

  async waitForAssetPublication(uid, version, environment) {
    const path = `/assets/${encodeURIComponent(uid)}?environment=${encodeURIComponent(environment)}`;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const result = await this.request('GET', path);
        if (result.asset?._version === version) return;
      } catch (error) {
        if (attempt === 11) throw error;
      }
      await new Promise(done => setTimeout(done, 3000));
    }
    throw new Error(`Asset ${uid} did not reach published version ${version} in ${environment}; entries were not published.`);
  }
}
