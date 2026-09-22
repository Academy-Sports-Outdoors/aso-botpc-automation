#!/usr/bin/env node
import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentstackClient } from './lib/contentstack.js';
import { getGoogleDoc, docIdFromInput } from './lib/google-docs.js';
import { parseFaqDoc } from './lib/parse-faq-doc.js';
import { renderFaqs, previewHtml } from './lib/html-from-docs.js';
import { planImport, previewPayload, changeReport, applyImport } from './lib/importer.js';

function usage() {
  return `Usage:
  node scripts/import.js --doc <Google Doc URL or ID> [--dry-run] [--out out]
  node scripts/import.js --doc <Google Doc URL or ID> --apply
  node scripts/import.js --doc <Google Doc URL or ID> --apply --publish --environment <name or UID>
  node scripts/import.js --doc-json <local Docs API JSON> --dry-run

Dry-run is the default. --apply creates or updates drafts. --publish also requires --apply.`;
}

function argsFrom(argv) {
  const args = { dryRun: true, out: 'out' };
  const values = new Set(['--doc', '--doc-json', '--out', '--environment']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (values.has(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${arg} requires a value.`);
      args[{ '--doc': 'doc', '--doc-json': 'docJson', '--out': 'out', '--environment': 'environment' }[arg]] = argv[++i];
    } else if (arg === '--apply') args.dryRun = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--publish') args.publish = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.help) return args;
  if (Boolean(args.doc) === Boolean(args.docJson)) throw new Error('Provide exactly one of --doc or --doc-json.');
  if (args.publish && args.dryRun) throw new Error('--publish requires --apply.');
  if (args.publish && !args.environment) throw new Error('--publish requires --environment.');
  if (args.docJson && !args.dryRun) throw new Error('--doc-json is for dry-run previews only.');
  return args;
}

async function writeSummary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  if (args.help) { console.log(usage()); return; }
  const source = args.docJson
    ? { doc: JSON.parse(await readFile(resolve(args.docJson), 'utf8')), id: 'local-fixture', token: null }
    : await getGoogleDoc(args.doc);
  const parsed = parseFaqDoc(source.doc);
  const hasCmaCredentials = Boolean(process.env.CS_API_KEY && process.env.CS_AUTHTOKEN);
  if (!args.dryRun && !hasCmaCredentials) throw new Error('CS_API_KEY and CS_AUTHTOKEN are required for --apply.');
  const client = hasCmaCredentials ? new ContentstackClient() : null;
  const plan = client ? await planImport(parsed, client) : null;
  let environment;
  if (args.publish) environment = await client.validateEnvironment(args.environment);
  const previewContent = await renderFaqs(parsed, ({ id }) => Promise.resolve(`https://preview.invalid/images/${encodeURIComponent(id)}`));
  const output = resolve(args.out);
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(resolve(output, 'preview.html'), previewHtml(parsed, previewContent)),
    writeFile(resolve(output, 'payload.json'), JSON.stringify(previewPayload(plan, parsed, previewContent), null, 2) + '\n'),
    writeFile(resolve(output, 'report.json'), JSON.stringify(changeReport(plan, parsed, previewContent), null, 2) + '\n')
  ]);
  console.log(`Preview: ${output}/preview.html`);
  console.log(`Payload: ${output}/payload.json`);
  console.log(`Change report: ${output}/report.json`);
  if (plan) console.log(JSON.stringify(plan.summary, null, 2));
  else console.log('Offline preview: Contentstack targets could not be resolved without CS_API_KEY and CS_AUTHTOKEN.');
  if (args.dryRun) {
    await writeSummary(['### PLP FAQ dry run', `- PLP: ${parsed.type} ${parsed.url}`, `- FAQs: ${parsed.faqs.length}`, `- Target resolution: ${plan ? plan.summary.plpAction : 'offline preview'}`]);
    return;
  }
  const result = await applyImport(plan, parsed, client, {
    docId: args.doc ? docIdFromInput(args.doc) : source.id,
    googleToken: source.token,
    environment, publish: Boolean(args.publish),
    assetFolderUid: process.env.CS_PARENT_FOLDER_UID,
    onProgress: message => console.log(message)
  });
  console.log(JSON.stringify(result, null, 2));
  await writeSummary(['### PLP FAQ import', `- PLP: ${result.plp.editUrl}`, `- Pre Footer: ${result.prefooter.editUrl}`, `- Mode: ${args.publish ? `published to ${environment}` : 'draft only'}`]);
}

main().catch(error => { console.error(`Import failed: ${error.message}`); process.exitCode = 1; });
