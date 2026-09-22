# Academy PLP Pre Footer FAQ importer

This repository imports bottom of page FAQ content from **one Google Doc per PLP** into Contentstack. The Doc declares whether its page is **Brand, L1, L2, or L3**. The importer creates a dedicated `preFooter200` entry from the Pre Footer template, fills its `seo_content`, and attaches it to that PLP. Later runs update the same importer-owned Pre Footer and PLP.

The default mode is a **dry run**. `--apply` saves drafts; publishing requires both `--apply` and `--publish`.

## 1. Prepare a Google Doc

Put these lines at the top of the Doc, using the page's real category ID:

```text
PLP Type: L2
PLP URL: https://www.academy.com/c/kids/kids-shoes/boys-footwear/boys-cleats
Category ID: 12345
```

Naming fields (`Page Name` is required only when the PLP must be created):

```text
PLP Title: Boys Cleats PLP | 12345
Page Name: Boys Cleats PLP
Entry Title: Boys Cleats Pre Footer
```

`PLP Title` maps to the PLP entry's `title`; `Page Name` maps separately to its `page` field; `Entry Title` names the dedicated Pre Footer. For an existing PLP, the importer preserves its current title and page name. If no matching PLP exists, `Page Name` is required and must differ from `PLP Title`; `PLP Title` and `Entry Title` otherwise have generated defaults.

Use **Heading 1** for each FAQ question or section title. Put its answer below it as normal paragraphs. Bulleted and numbered lists, links, bold, italic, Heading 2/3, tables, and inline images are supported. `FAQ: Your question` on a normal line also starts a section. The importer replaces the Pre Footer's entire `seo_content` with the sections in the Doc.

See [docs/AUTHORING.md](docs/AUTHORING.md) for examples and image guidance. Share the Doc with the service account email in `GOOGLE_SERVICE_ACCOUNT_JSON`.

## 2. Configure credentials

Use Node.js 22 or newer (the workflow uses Node 24). Run `npm ci` from this repository. There are no third-party runtime dependencies.

For local runs, set these environment variables:

| Variable | Purpose |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full Google service account JSON, or a local path to that JSON. Give the account Google Docs read access. |
| `CS_API_KEY` | Academy Contentstack stack API key. |
| `CS_AUTHTOKEN` | Contentstack user session token, sent in the `Cookie` header like `web-builder`. |
| `CS_PARENT_FOLDER_UID` | Optional Contentstack Assets folder for Doc images. |
| `CS_STACK_UID` | Optional override for edit links; defaults to the Academy stack UID. |
| `CS_CMA_BASE_URL` | Optional CMA base URL; defaults to `https://app.contentstack.com/api/v3`. |

The Academy stack UID is fixed in [scripts/lib/config.js](scripts/lib/config.js). Do not commit credentials or service account JSON. A Contentstack session token can expire; refresh the secret if authentication fails.

## 3. Preview and import

```bash
npm ci
npm test
node scripts/import.js --doc 'https://docs.google.com/document/d/DOC_ID/edit'
```

The default dry run writes `out/preview.html`, `out/payload.json`, and `out/report.json`. The report lists added, changed, and removed FAQ headings when it can compare against Contentstack. With Contentstack credentials, it also reads the schemas, templates, and matching entries to show whether the run would create or update them. Without Contentstack credentials, the preview is marked **offline** and cannot resolve target entries or compare prior FAQs. Dry runs never create entries, upload assets, or publish. Preview payloads use placeholder image URLs and, for new entries, a placeholder Pre Footer UID; do not submit them to Contentstack directly.

Review the preview and payload, then save drafts:

```bash
node scripts/import.js --doc 'https://docs.google.com/document/d/DOC_ID/edit' --apply
```

Publishing is opt-in. Confirm the target environment first; the importer checks that its name or UID exists in the stack before writing:

```bash
node scripts/import.js --doc 'https://docs.google.com/document/d/DOC_ID/edit' --apply --publish --environment development
```

The importer uploads and publishes images first, then publishes the Pre Footer, attaches it to the PLP, and publishes the PLP. Publishing an existing PLP entry can also release other pending draft edits on that entry, so review it before choosing `--publish`.

For a preview from a saved Google Docs API response without Google credentials:

```bash
node scripts/import.js --doc-json test/fixtures/sample-doc.json --dry-run
```

This fixture mode is intended for offline preview and tests.

## GitHub Actions

Run **Import PLP Pre Footer FAQ** from the Actions tab. Enter the Doc URL. `dry_run` defaults to true and `publish` defaults to false. For a draft import, set `dry_run` to false. For publication, also set `publish` to true and provide `contentstack_environment` (a Contentstack name or UID). The workflow runs tests, serializes imports to avoid overlapping updates, uploads the preview files, and writes the edit links to the job summary.

This workflow follows the `web-builder` credential layout. **The GitHub Environment is the triggering user's GitHub username** (`github.actor`); it controls access to that user's Contentstack token. `contentstack_environment` is a separate workflow input used only when publishing Contentstack entries.

Configure settings in **this repository** (`aso-botpc-automation`), because secrets in `web-builder` or the original `aso-botpc` repository do not automatically carry over. Open [Actions secrets and variables](https://github.com/Academy-Sports-Outdoors/aso-botpc-automation/settings/secrets/actions) and [Environments](https://github.com/Academy-Sports-Outdoors/aso-botpc-automation/settings/environments):

| GitHub location | Name | Value |
| --- | --- | --- |
| Settings → Secrets and variables → Actions → Repository secrets | `CS_API_KEY` | Academy Contentstack stack API key. |
| Settings → Secrets and variables → Actions → Repository secrets | `GOOGLE_CREDENTIALS` | Google service account JSON. You may instead use `GOOGLE_SERVICE_ACCOUNT_JSON`; the workflow checks that name first. |
| Settings → Environments → *your GitHub username* → Environment secrets | `CS_AUTHTOKEN` | Your Contentstack app session token. Create an actor Environment for each user who will run the workflow. |
| Settings → Secrets and variables → Actions → Repository variables | `CS_PARENT_FOLDER_UID` | Optional Contentstack Assets folder UID. |
| Settings → Secrets and variables → Actions → Repository variables | `CS_CMA_BASE_URL`, `CS_STACK_UID` | Optional overrides; normally unnecessary. |

Share each Google Doc with the `client_email` in the service account JSON and enable the Google Docs API for that account's project. If you reuse `web-builder`'s Google service account, configure its JSON as a repository secret here and give it Doc access. GitHub does not reveal saved secret values, so obtain the JSON and session token from their original sources when configuring this repository. Do not place `CS_AUTHTOKEN` in repository secrets; keep it in the actor Environment as in `web-builder`. GitHub gives an environment secret precedence if a same-named repository secret also exists. The workflow checks that required values are present before importing, without printing them.

The action requires repository read access only. A GitHub Environment can be created automatically if a workflow references a missing name, but it will have no secrets; configure each actor Environment before running. You can attach reviewers or branch restrictions to the actor Environment if needed.

## How entries are selected

| Doc `PLP Type` | Content type | Template UID |
| --- | --- | --- |
| `Brand` | `brandPlpPage` | `bltdb6f4024a49e825e` |
| `L1` | `l1CategoryPlpPage` | `blt18272c4989346304` |
| `L2` | `l2CategoryPlpPage` | `blte43b63cdf94f0aa9` |
| `L3` | `l3CategoryPlpPage` | `blt83444413144bbd0f` |

The importer checks exact URL and Category ID across these types. It stops if the Doc's type conflicts with an existing entry, if those identifiers disagree, or if the selected page schema/template lacks the expected Pre Footer slot. It never edits the shared `productListingPage200` entry.

The dedicated Pre Footer uses the `preFooter200` template `blt29ddffbf843c45a2`. New entries receive an importer ownership tag. On rerun, the importer updates only a Pre Footer bearing that page's ownership tag. If a page currently references the template or another unowned Pre Footer, the importer creates a dedicated copy and replaces only that reference. Other footer components and page fields are preserved. A failed run after creating a Pre Footer can be rerun; the importer finds its tagged entry by title.

Each successful write prints Contentstack edit links. If a run fails after a partial write, inspect those links and rerun with the same Doc. Images use a deterministic filename based on the Doc and inline object ID so reruns can reuse them. Avoid replacing an image inside the Doc while keeping the same inline object ID; remove and reinsert it to create a new asset identity.

## Current verification boundary

Automated tests cover parsing, safe HTML, template selection, reference preservation, conflicts, and rerun behavior. The local fixture preview has been run. This workspace has no Contentstack or Google credentials, so the four live template schemas, image upload, and publish flow still need a credentialed dry run and draft check before production use. The importer fails before writing when a page schema or template differs from its supported contract.
