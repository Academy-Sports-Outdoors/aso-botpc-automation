import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentstackClient } from '../scripts/lib/contentstack.js';

test('uses the established Contentstack cookie auth and publish request shape', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const json = options.method === 'POST' && url.endsWith('/publish')
      ? { notice: 'The requested action has been performed.' }
      : { entry: { uid: 'blttest', _version: 2 } };
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = new ContentstackClient({
    fetchImpl,
    env: { CS_API_KEY: 'bltstack', CS_AUTHTOKEN: 'session-token', CS_CMA_BASE_URL: 'https://app.contentstack.com/api/v3' }
  });
  await client.getEntry('brandPlpPage', 'blttest');
  await client.publishEntry('preFooter200', 'blttest', 2, ['development']);
  assert.equal(calls[0].options.headers.Cookie, 'authtoken=session-token');
  assert.equal(calls[0].options.headers.api_key, 'bltstack');
  assert.equal(calls[0].options.headers.authorization, undefined);
  assert.equal(calls[0].options.headers.authtoken, undefined);
  assert.equal(calls[1].url, 'https://app.contentstack.com/api/v3/content_types/preFooter200/entries/blttest/publish');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    entry: { environments: ['development'], locales: ['en-us'] }, locale: 'en-us', version: 2
  });
});

test('validates every requested publish environment by name or UID', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ environments: [
    { uid: 'bltdev', name: 'development' }, { uid: 'bltprod', name: 'production' }
  ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const client = new ContentstackClient({ fetchImpl, env: { CS_API_KEY: 'bltstack', CS_AUTHTOKEN: 'session-token' } });
  assert.deepEqual(await client.validateEnvironments(['development', 'bltprod', 'bltdev']), ['development', 'production']);
  await assert.rejects(() => client.validateEnvironments(['development', 'staging']), /"staging" does not exist/);
});
