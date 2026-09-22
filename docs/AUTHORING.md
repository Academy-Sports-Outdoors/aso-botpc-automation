# Writing PLP FAQ Docs

Use one Google Doc for one PLP. Place these lines before the first FAQ:

```text
PLP Type: Brand
PLP URL: /c/brand/example
Category ID: 12345
PLP Title: Example Brand PLP | 12345
Page Name: Example Brand PLP
Entry Title: Example Brand Pre Footer
```

The type can be `Brand`, `L1`, `L2`, or `L3`. Use the type of the Contentstack PLP entry, not the number of path segments in the URL. A full `https://www.academy.com/...` URL is accepted; the importer removes its query string and uses the path. The Category ID must come from the page's source record. The importer does not scrape it from academy.com.

`PLP Title` sets the `title` of a newly cloned PLP. `Page Name` separately sets its `page` field and must differ from `PLP Title`. `Entry Title` sets the dedicated Pre Footer title. Existing PLPs keep their current title and page name. For a new PLP, `Page Name` is required; the other titles default to `Brand PLP | 12345` and `Pre Footer | Brand | 12345` (with the chosen type and ID).

Example body:

```text
[Heading 1] How do I choose the right cleats?
Start with fit and playing surface. Link relevant words to an Academy guide.

• Check the size and width.
• Choose the sole for the field.

[Heading 2] Fit details
Include any additional explanation here.

[Heading 1] How should I care for my cleats?
Clean them after use and let them dry.
```

Heading 1 starts a new Pre Footer `seo_content` item: the heading becomes `seo_heading`, and everything until the next Heading 1 becomes its HTML `seo_body`. `FAQ: Question text` on a normal line works if Heading 1 cannot be used. Heading 2 and 3 inside an answer become HTML `h3` and `h4`.

Normal paragraphs, native Docs lists, links, bold, italic, tables, and inline images are supported. Links must use HTTP(S) or a relative path. Images should have descriptive alt text in Google Docs and should be checked in the preview. Image uploads happen only during `--apply`; the dry-run preview uses placeholder image URLs. Tables and images have limited dedicated storefront styling, so keep layouts simple and check them visually before publishing.

Editing this Doc and rerunning replaces the dedicated Pre Footer's FAQ sections. Review `out/preview.html` before saving drafts, and review the PLP draft before publishing.
