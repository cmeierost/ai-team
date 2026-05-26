---
name: knowledge-brief-writing
description: 'Use when Adrian or another research-oriented teammate needs to turn accumulated findings, repo knowledge, or source-backed research into clearly structured, human-readable Markdown briefings, summaries, or analysis notes that teammates can skim and trust.'
---

# Knowledge brief writing

Use this skill when the hard part is no longer finding information, but turning what is already known into a document that other people can read quickly, understand easily, and act on confidently.

This includes:

- turning research notes into a clean Markdown briefing
- summarizing accumulated knowledge from multiple findings without losing the thread
- writing analysis documents that are easy to skim, cite, and revisit later
- producing sectioned summaries for architecture, product, or ecosystem topics
- translating analyst-style notes into human-readable team documents

## Read these first

1. the source notes, URLs, or documents being summarized
2. `analysis/ai-team-context-strategy.md`
3. `analysis/concepts/overview.md`
4. nearby `analysis/**/*` documents on the same topic
5. any architecture or product note the summary is meant to support

## Workflow

### 1. Decide what kind of document this is

Before writing, identify the output shape:

- short topic explainer
- focused research note
- architecture briefing
- comparison summary
- decision-support memo
- knowledge handoff for another teammate

Do not start drafting before you know what the reader should walk away understanding.

### 1.5. Write the one-sentence takeaway first

Before drafting the body, write one internal sentence that answers:

- what did the research actually show?
- why does it matter?
- what should the reader remember five minutes later?

If you cannot write that sentence clearly, the document is still too muddy.

### 2. Extract the real signal first

Separate the material into:

- durable facts
- evidence or citations
- informed inference
- open questions
- recommended next moves

If everything feels equally important, the document is not ready to be written yet.

### 3. Choose a structure that helps humans skim

Prefer strong headings, short sections, and visible hierarchy.

A good default structure is:

- **Scope** — what this document covers
- **Key points** — the main takeaways up front
- **What we know** — durable facts or observations
- **What it means** — implications for `ai-team`
- **Open questions** — uncertainty worth tracking
- **Recommended next move** — what to do with the knowledge
- **Sources** — the URLs, files, or notes behind the summary

Use this structure by default for research notes and analysis documents.

Use a different structure only when it clearly improves comprehension.

When useful, start from `templates/analysis-brief-template.md` and adapt it rather than improvising the whole structure from scratch.

### 3.5. Optimize for straight-to-the-point reading

Assume the reader will scan the top of the document before deciding whether to keep reading.

That means:

- the first section should tell them what the note is about
- the `Key points` section should surface the answer early
- the most important implication should appear before background detail
- lower-value context should move downward, not upward

Do not make the reader traverse setup, chronology, or scene-setting before they reach the conclusion.

### 4. Write for the teammate who did not do the research

Assume the reader is smart but busy.

Write so they can understand:

- the topic
- the most important findings
- why those findings matter
- how certain or uncertain the conclusion is
- what follow-up is worth doing

Do not make the reader reconstruct the argument from a pile of bullets.

### 5. Keep the prose human-readable

Prefer:

- a short opening paragraph that says the main point plainly
- short paragraphs
- concrete wording
- direct claims
- explicit transitions between sections
- bullets where comparison or scanability matters

Avoid:

- generic analyst filler
- buzzword-heavy summaries
- giant undifferentiated paragraphs
- mixing facts, guesses, and recommendations without labels
- writing the document in the order the research happened instead of the order a reader needs to understand it

If a sentence does not help the reader understand the answer faster, simplify it or cut it.

### 5.5. Keep the brief focused

Every section should earn its place.

Trim or rewrite anything that does not help the reader do one of these:

- understand the subject
- grasp the key finding
- see why it matters
- decide what to do next

If a detail is interesting but does not change the conclusion, shorten it or move it lower.

### 5.6. Use a clear writing standard

Before finishing, check the draft against this standard:

- **clear** — a smart teammate can understand it on one read
- **focused** — the main point is visible early and repeated only when useful
- **structured** — headings and bullets help scanning instead of fragmenting the logic
- **grounded** — claims trace back to evidence, notes, or sources
- **human** — the prose sounds natural, not like stitched-together analyst paste

### 6. End with something useful

A strong summary should leave the team with one of these:

- a clearer shared understanding
- a concrete recommendation
- a reusable explainer
- a precise list of questions worth answering next

If the ending does not help someone decide, route, or learn, tighten it.

## Working rules

- lead with the important point instead of burying it in the middle
- start with the conclusion, then support it
- use the same default section order unless there is a clear reason not to
- prefer clarity over completeness when the extra detail does not change the conclusion
- distinguish evidence from interpretation
- make headings informative enough that someone can skim the outline alone
- keep Markdown clean and reusable for future linking and citation
- when summarizing multiple sources, synthesize them into one coherent explanation instead of writing source-by-source sludge
- when the topic is strategic, include the implication for `ai-team` explicitly rather than expecting the reader to infer it
- prefer one strong sentence over three vague ones
- rewrite until the document sounds like a thoughtful teammate, not an automated report generator

## Successful outcome

- the document is easy to skim and easy to trust
- teammates can understand the subject without reading all original sources
- the structure makes the key points obvious
- the writing sounds human, clear, and intentional
- the main takeaway is visible early and remains stable throughout the document
- the knowledge becomes reusable instead of trapped in raw notes or chat history
