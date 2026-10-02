#!/usr/bin/env node
import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentstackClient, editUrl } from './lib/contentstack.js';
import { PREFOOTER_TYPE } from './lib/config.js';
import { getGoogleDoc, docIdFromInput } from './lib/google-docs.js';
import { parseFaqDoc } from './lib/parse-faq-doc.js';
import { renderFaqs, previewHtml } from './lib/html-from-docs.js';
import { planImport, previewPayload, changeReport, applyImport } from './lib/importer.js';

function usage() {
  return `Usage:
  node scripts/import.js --doc <Google Doc URL or ID> [--dry-run] [--out out]
  node scripts/import.js --doc <Google Doc URL or ID> --apply
  node scripts/import.js --doc <Google Doc URL or ID> --apply --publish --environment <name or UID>[,<name or UID>...]
  node scripts/import.js --doc-json <local Docs API JSON> --dry-run

Dry-run is the default. --apply creates or updates drafts. --publish also requires --apply.
--environment accepts a comma-separated list and may be repeated to publish to several environments.`;
}

function argsFrom(argv) {
  const args = { dryRun: true, out: 'out', environments: [] };
  const values = new Set(['--doc', '--doc-json', '--out', '--environment']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (values.has(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${arg} requires a value.`);
      const value = argv[++i];
      if (arg === '--environment') args.environments.push(...value.split(',').map(item => item.trim()).filter(Boolean));
      else args[{ '--doc': 'doc', '--doc-json': 'docJson', '--out': 'out' }[arg]] = value;
    } else if (arg === '--apply') args.dryRun = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--publish') args.publish = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.help) return args;
  if (Boolean(args.doc) === Boolean(args.docJson)) throw new Error('Provide exactly one of --doc or --doc-json.');
  if (args.publish && args.dryRun) throw new Error('--publish requires --apply.');
  if (args.publish && !args.environments.length) throw new Error('--publish requires --environment.');
  if (args.docJson && !args.dryRun) throw new Error('--doc-json is for dry-run previews only.');
  return args;
}

async function writeSummary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

function summaryLines({ args, parsed, plan, environments, result }) {
  const applied = Boolean(result);
  const mode = args.dryRun ? 'Preview Only (no Contentstack writes)'
    : args.publish ? `CS Publish to ${environments.join(', ')}` : 'CS Draft';
  const link = (label, type, uid) => uid ? `[${label}](${editUrl(type, uid)})` : null;
  const lines = ['### Import Summary', `- Mode: ${mode}`, `- PLP: ${parsed.type} ${parsed.url}`, `- Category ID: ${parsed.categoryId}`, `- FAQs: ${parsed.faqs.length}`];
  if (!plan) {
    lines.push('- Target resolution: offline preview (Contentstack not checked)');
    return lines;
  }
  const plpUid = result?.plp.uid || plan.summary.plpUid;
  const prefooterUid = result?.prefooter.uid || plan.summary.prefooterUid;
  const plpAction = plan.plp ? (applied ? 'updated existing PLP' : 'will update existing PLP') : (applied ? 'created from template' : 'will be created from template');
  const prefooterAction = plan.prefooter ? (applied ? 'updated dedicated Pre Footer' : 'will update dedicated Pre Footer') : (applied ? 'created from template' : 'will be created from template');
  lines.push(`- PLP entry: ${[plpAction, link('Open in Contentstack', plan.config.contentType, plpUid)].filter(Boolean).join(' · ')}`);
  lines.push(`- Pre Footer: ${[prefooterAction, link('Open in Contentstack', PREFOOTER_TYPE, prefooterUid)].filter(Boolean).join(' · ')}`);
  if (plan.summary.replacedPrefooterUid) {
    lines.push(`- Replaced Pre Footer reference: ${link(plan.summary.replacedPrefooterUid, PREFOOTER_TYPE, plan.summary.replacedPrefooterUid)} (not deleted)`);
  }
  return lines;
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
  let environments = [];
  if (args.publish) environments = await client.validateEnvironments(args.environments);
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
    await writeSummary(summaryLines({ args, parsed, plan, environments }));
    return;
  }
  const result = await applyImport(plan, parsed, client, {
    docId: args.doc ? docIdFromInput(args.doc) : source.id,
    googleToken: source.token,
    environments, publish: Boolean(args.publish),
    assetFolderUid: process.env.CS_PARENT_FOLDER_UID,
    onProgress: message => console.log(message)
  });
  console.log(JSON.stringify(result, null, 2));
  await writeSummary(summaryLines({ args, parsed, plan, environments, result }));
}

main().catch(error => { console.error(`Import failed: ${error.message}`); process.exitCode = 1; });
