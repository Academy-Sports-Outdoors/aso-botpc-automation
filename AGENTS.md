# AGENTS.md — Academy PLP Pre Footer FAQ importer

## Repository of record

This checkout at `/Users/A0800955/Documents/GitHub/aso-botpc-automation` is the active repository for this project. Its `origin` is `https://github.com/Academy-Sports-Outdoors/aso-botpc-automation.git`. The sibling `../aso-botpc` checkout is the original development copy and is no longer the working repository. The user referred to `../aso-botpc-autoomation`, but the actual cloned directory is `../aso-botpc-automation`. Start future agent sessions here, and make all code, workflow, documentation, and test changes here. Do not silently sync from or edit the old checkout.

Run `npm ci` and `npm test` here before committing code changes. Commit and push from this checkout when authorized; GitHub Actions runs the pushed workflow and code, not local uncommitted files. Keep credentials out of the repository. For operator setup and use, follow [README.md](README.md) and [docs/AUTHORING.md](docs/AUTHORING.md).

The organization repository is currently public. Its workflow uploads `out/preview.html`, `out/payload.json`, and `out/report.json` as an artifact; these can contain unpublished FAQ copy. Check repository visibility and artifact access before importing confidential Docs. Never put credentials in Doc content, preview files, commits, or logs.

## Mission

Import bottom of page FAQ content from one Google Doc per Academy PLP. The Doc explicitly declares `PLP Type`, `PLP URL`, and `Category ID`. Supported PLP types are Brand, L1, L2, and L3. Each PLP gets its own `preFooter200` cloned from the Pre Footer template. Later imports update the same importer-owned Pre Footer. Save drafts by default; publish only with explicit flags and an existing environment.

The user's current decisions supersede earlier Brand-only and shared-Pre-Footer plans. Do not implement a `Reuse Pre Footer` field or update an unowned/shared Pre Footer in place.

## Templates and stack

Stack UID: `blt964243cdd7810dea`; locale: `en-us`.

| Doc type | Content type | Template UID |
| --- | --- | --- |
| Brand | `brandPlpPage` | `bltdb6f4024a49e825e` |
| L1 | `l1CategoryPlpPage` | `blt18272c4989346304` |
| L2 | `l2CategoryPlpPage` | `blte43b63cdf94f0aa9` |
| L3 | `l3CategoryPlpPage` | `blt83444413144bbd0f` |

Pre Footer type `preFooter200`, template UID `blt29ddffbf843c45a2`. The common PLP component type `productListingPage200` and its shared entry `blt5314d342aa913deb` are not FAQ write targets.

Template edit URLs use `https://app.contentstack.com/#!/stack/{stack}/content-type/{contentType}/en-us/entry/{uid}/edit`.

The Brand template has `url`, `category_id`, `title`, `page`, and `footer_components`. L1–L3 field contracts have not been independently verified in this workspace. The importer checks each selected content-type schema and template before writing and fails if expected fields or the Pre Footer slot are absent. Do not guess replacement field UIDs. Preserve other page fields and footer component references.

Pre Footer `seo_content` is a multiple group of `{seo_heading, seo_body}`. The title/answer mapping is Heading 1 to `seo_heading` and following Docs blocks to HTML `seo_body`.

## Google Doc contract

Required metadata at the top:

```text
PLP Type: L2
PLP URL: /c/kids/kids-shoes/boys-footwear/boys-cleats
Category ID: 12345
```

Optional: `PLP Title` for a newly cloned PLP and `Entry Title` for the dedicated Pre Footer. One Doc per PLP. Use Heading 1 for each FAQ; `FAQ: ...` is a fallback. Normal paragraphs, lists, links, bold, italic, tables, inline images, and Heading 2/3 are converted to safe HTML.

Stop without Contentstack writes on missing/unsupported type, missing URL/Category ID, malformed Doc, or zero FAQs. A dry run may read Contentstack but must never create/update/publish entries or assets. No browser scraping or Playwright/Puppeteer. The Category ID comes from the Doc.

## Selection and idempotency

Find PLPs by exact normalized URL and Category ID across the four types. A conflicting type, duplicate match, or disagreement between URL and Category ID is an error. For a new PLP, clone the declared type's template and set its required page fields. For an existing PLP, preserve its fields and replace only its Pre Footer reference.

Create a dedicated Pre Footer from the template unless an already attached Pre Footer has the importer ownership tag for this PLP. New Pre Footers receive that tag. A tagged Pre Footer matching the requested title can be reused after an interrupted run. Never edit the template Pre Footer or another unowned entry in place. A rerun updates the existing dedicated entry instead of making another. Replacing a manual/unowned reference does not delete the old entry.

Do not write FAQs into `productListingPage200`. Do not change Related Categories, Monetate, or unrelated component references.

## Auth, workflow, and publishing

The Contentstack CMA client adapts the `web-builder/scripts/lib/contentstack.js` authentication pattern: `api_key`, `Cookie: authtoken=<CS_AUTHTOKEN>`, `Content-Type: application/json` for JSON requests, `origin`/`referer`, and `x-user-agent`. Do not put the session token in an `authtoken` or `authorization` header. `CS_CMA_BASE_URL` can override the default `https://app.contentstack.com/api/v3`.

Google Docs is read with a service account from `GOOGLE_SERVICE_ACCOUNT_JSON`; share each Doc with its client email. Secrets must not be committed or logged.

The CLI and GitHub Actions default to dry run. `--apply` creates/updates drafts. `--apply --publish --environment <name-or-UID>` first validates the environment, publishes images, updates and publishes the Pre Footer, then attaches and publishes the PLP. If adding publish behavior, preserve this order and verify the Pre Footer has finished publishing before exposing its reference on a published PLP. Inspect existing PLP drafts before publishing because other pending changes can be released too.

The workflow uses `workflow_dispatch`, Node 24, `npm ci`, `npm test`, preview artifacts, and Contentstack edit links in the job summary. It mirrors `web-builder`: `CS_API_KEY` and Google JSON are repository secrets, `CS_AUTHTOKEN` is an actor GitHub Environment secret, and optional nonsecret UIDs/endpoints are repository variables. The GitHub Environment name (`github.actor`) differs from the Contentstack publish environment input. See [README.md](README.md) for commands and setup.

## Verification

Use fixture and mocked CMA tests for parse/render behavior, field preservation, four-type selection, conflict handling, idempotency, and publication order. Perform a credentialed dry run and one draft integration run for each type before production usage. This workspace currently has no Google or Contentstack credentials, so no live template or storefront verification has been performed here.
