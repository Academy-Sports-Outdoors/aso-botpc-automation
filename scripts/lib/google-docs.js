import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function docIdFromInput(input) {
  const value = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return value;
  let url;
  try { url = new URL(value); } catch { throw new Error('Use a Google Doc URL or document ID.'); }
  if (url.hostname !== 'docs.google.com') throw new Error('The Doc URL must be on docs.google.com.');
  const match = url.pathname.match(/^\/document\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
  if (!match) throw new Error('Could not find a document ID in the Google Doc URL.');
  return match[1];
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is required to read a Google Doc.');
  const account = JSON.parse(raw.trimStart().startsWith('{') ? raw : await readFile(raw, 'utf8'));
  if (!account.client_email || !account.private_key) throw new Error('Invalid Google service account JSON.');
  return account;
}

export async function googleAccessToken(fetchImpl = fetch) {
  const account = await loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/documents.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const assertion = `${header}.${claim}.${signer.sign(account.private_key, 'base64url')}`;
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    signal: AbortSignal.timeout(30000)
  });
  const json = await response.json();
  if (!response.ok || !json.access_token) throw new Error(`Google token request failed (${response.status}): ${json.error || 'no access token'}`);
  return json.access_token;
}

export async function getGoogleDoc(input, fetchImpl = fetch) {
  const id = docIdFromInput(input);
  const token = await googleAccessToken(fetchImpl);
  const url = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}?includeTabsContent=true`;
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  const json = await response.json();
  if (!response.ok) throw new Error(`Google Docs request failed (${response.status}): ${json.error?.message || 'unknown error'}`);
  return { doc: json, id, token };
}

export async function downloadGoogleImage(uri, token, fetchImpl = fetch) {
  const url = new URL(uri);
  if (url.protocol !== 'https:' || !['googleusercontent.com', 'google.com', 'gstatic.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error(`Unexpected Google Docs image host: ${url.hostname}`);
  }
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Google Docs image download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 15 * 1024 * 1024) throw new Error('Google Docs image exceeds the 15 MB limit.');
  const contentType = response.headers.get('content-type')?.split(';')[0]?.toLowerCase() || '';
  if (!/^image\/(png|jpeg|gif|webp)$/.test(contentType)) throw new Error(`Unsupported image type: ${contentType}`);
  return { bytes, contentType };
}
