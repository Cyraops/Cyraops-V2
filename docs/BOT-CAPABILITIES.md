# What the CyraOps bot can do

**Status:** 16 November 2026. Written after checking every claim against the running
assistant runtime rather than the feature list.

The bot is the CRM's assistant: one per person, with memory, live CRM data, a browser, and the
ability to author **Pages** — designed documents that can be shared and now exported.

---

## Ready to use now

| Capability | Detail |
|---|---|
| Answer from live CRM data | 56 tools: leads, deals, contacts, tasks, pipeline and sales reports |
| Produce a document | `create_page` writes HTML with a component kit; every save is a version |
| **Export a document** | **PDF (print dialog), Markdown, HTML** — from the page panel |
| Share a document | Public link with expiry, revocable by regenerating |
| Research on the web | `browser_navigate`, `browser_extract`, `browser_screenshot`, click and type |
| **Analyse a spreadsheet** | **`analyse_table`** on an uploaded `.csv`/`.xlsx`: types, nulls, min/max/mean/median/sum, top values, per sheet |
| Delegate multi-step work | `start_team_goal` → three AI teammates (research, sales, communication) with progress tracking |
| Remember context | 40 memories, 12 recalled per message |
| Choose the model | Per-assistant model picker (`deepseek-flash`, `deepseek-v4-pro`, or a configured provider) |

## The page kit

Authored as declarative tags, rendered on the server, no scripts in the output:

| Tag | Renders |
|---|---|
| `<cy-metrics>` / `<cy-metric>` | A row of headline numbers with a hint |
| `<cy-bars>` / `<cy-line>` | Inline SVG charts from `values` and `labels` |
| `<cy-callout tone title>` | The one thing to act on |
| `<cy-pill tone>` | Inline status chip |
| `<cy-toc/>` | A contents list, built from the document's `h2`/`h3`, with anchors |
| `<cy-figure src alt caption>` | A captioned image (http/https only) |
| `<cy-code lang>` | An escaped code block |
| `<table>` | Plain HTML tables, styled in the kit |

## Export

`GET /api/pages/:id/export?format=md|html|print` — owner only, `404` for anyone else.

- **md** — real Markdown: headings, pipe tables, lists, blockquotes. Kit tags become bold lists,
  blockquotes and label/value lists, so nothing is lost in the conversion.
- **html** — a self-contained document with the kit CSS, ready to archive or attach.
- **print** — A4 page setup, headers kept with their content, table headers repeated across
  pages, and the browser's print dialog opened automatically. **"Save as PDF" in that dialog is
  how a PDF is produced** — there is no headless browser in the container, and this is the
  honest trade: no 400 MB Chromium layer for a feature the browser already has.

## Known limits

| Limit | Why | Consequence |
|---|---|---|
| No server-side PDF | No Chromium in the image | PDF comes from the browser's print engine; fine for reports, not for pixel-exact templates |
| No code execution | Deliberate — nothing the model writes can run | No ad-hoc scripts; table maths is computed in the app (`analyse_table`), bounded to 20k rows |
| Web research is browser-based | No search API key | Bot-protected sites refuse; the assistant is instructed to say so rather than invent |
| Default model is `deepseek-flash` | Cost and latency | Fine for ops Q&A; switch to `deepseek-v4-pro` for long-form analysis |
| No image generation | Not implemented | Figures must reference an existing URL |

## The honest verdict

**Internal use: ready today.** Briefs, pipeline reviews, research summaries, spreadsheet
questions, shareable pages, and now exportable files.

**Client-facing deliverables: ready with one caveat** — the PDF arrives via the print dialog, so
the layout is only as good as the print stylesheet. It is good for a report; it is not a
designed brochure.
