---
name: document-research-briefing
description: 'Use when Adrian or another research-oriented teammate needs to extract content from PDFs or long documents, convert it to Markdown, collect supporting URLs, and produce a source-backed briefing the team can learn from.'
---

# Document research briefing

Use this skill when the job is not just to read a source, but to turn a PDF, report, long webpage, or large technical document into reusable Markdown notes and a teachable research brief.

This includes:

- extracting text from PDFs into Markdown
- converting web or file-based documents into a reusable Markdown working draft
- summarizing long documents section by section before producing a final synthesis
- collecting the most relevant supporting URLs before explaining a topic
- producing source-backed explainers for the wider team, not just a private analyst summary

## Read these first

1. `analysis/ai-team-context-strategy.md`
2. `analysis/concepts/overview.md`
3. `analysis/concepts/deep-research-report.md`
4. any source document, PDF, or URL the developer provided
5. any nearby architecture or product notes the briefing is meant to influence

## Workflow

### 1. Normalize the source first

Decide what kind of input you have:

- local PDF or document file
- remote PDF URL
- webpage or documentation page
- multiple mixed sources

Convert the source into Markdown as early as possible so downstream notes, quoting, and summaries all work from one durable text form.

Prefer:

- URI-to-Markdown conversion for PDFs or file-backed documents
- webpage fetching for normal HTML pages
- recursive page fetching when relevant links found in the source materially improve the briefing

Always preserve the originating file path or URL in your notes.

### 2. Break large documents into sections

Before writing a final summary, identify:

- major headings or chapter boundaries
- definitions, claims, and evidence
- architecture or product implications
- open questions, caveats, or assumptions

For very large documents, summarize section by section first. Do not flatten a long source into one vague paragraph.

### 3. Collect supporting URLs deliberately

When outside evidence is helpful:

- search narrowly for official docs, source repos, standards, or primary references
- prefer a small, high-signal source set over a noisy link dump
- keep track of why each URL matters
- separate direct source evidence from commentary or inference

### 4. Teach, do not just compress

Write the explanation so a teammate who did not read the original source can still understand:

- what the source says
- what matters most
- where the evidence is strongest
- what is uncertain or missing
- what `ai-team` should do with the information

### 5. Produce a reusable briefing

Prefer an output structure like:

- **Source** — file path or URL
- **Scope** — what the document covers
- **Key points** — the highest-signal findings
- **Section notes** — brief per-section takeaways for longer sources
- **Supporting URLs** — additional references worth revisiting
- **Implication for ai-team** — why this matters here
- **Recommended next move** — adopt, test, watch, ignore, or delegate

## Working rules

- normalize documents into Markdown before heavy summarization when possible
- keep citations and source paths visible enough for follow-up review
- prefer official documentation, source repos, and primary materials over commentary
- for PDFs, note any extraction gaps or formatting weirdness instead of pretending the source was perfectly clean
- keep explanations teachable: concise, evidence-backed, and easy to route onward

## Successful outcome

- dense source material becomes reusable Markdown instead of trapped context
- long documents are summarized without losing their important structure
- supporting URLs are curated instead of dumped blindly
- the team gets a briefing that is easy to learn from and easy to cite later
