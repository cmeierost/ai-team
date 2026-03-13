# OST Reveal Template

A zero-build Reveal.js deck that ships with the official OST branding, hero layouts, and helpful authoring scripts. Open `index.html`, start typing, and every slide inherits the polished styling from `assets/ost-reveal.css` and `assets/ost-reveal.js`.

## Quick Start

1. Install dependencies: none. Everything is plain HTML, CSS, and JS.
2. Open `index.html` in a browser (or `npx serve .` if you prefer a local server).
3. Update the data attributes on the `.reveal` wrapper to match your course or talk.
4. Duplicate or edit the demo slides to build your own deck.

## Folder Layout

- `index.html` – sample deck that demonstrates every slide type and helper.
- `assets/ost-reveal.css` – OST theme, typography, colors, and utility classes.
- `assets/ost-reveal.js` – initialization script that injects metadata, footers, code toolbars, and figure captions.
- `brand/` – official OST logos and decorative artwork.
- `images/` – curated campus photos for title, chapter, and image slides.
- `fonts/` – Source Sans Pro font files plus the CSS that registers them.

## Slide Types

### Title Slide

Use `data-slide-type="title"` and supply background imagery. The CSS injects the OST blob, logo, and slogan overlays automatically.

```html
<section
  data-slide-type="title"
  data-background-image="images/saentis.jpg"
  data-background-size="cover"
>
  <h1>Module Title</h1>
  <h2>Lecture Subtitle</h2>
  <h3>Optional Tagline</h3>
</section>
```

### Chapter Slide

Divide major sections of your talk with the chapter layout. The JavaScript footer for chapter slides displays organization, module, speaker, and date.

```html
<section
  data-slide-type="chapter"
  data-background-image="images/rappi.jpg"
  data-background-size="cover"
>
  <h1>Topic Name</h1>
  <h2>One-line description</h2>
</section>
```

### Standard Content Slide

Plain `<section>` elements become fully branded slides. A chapter label is auto-inserted (based on the last chapter slide) and the fixed footer shows the slide number, module, email, and date.

```html
<section>
  <h1>Slide Title</h1>
  <div class="content">
    <p>Keep authoring semantic HTML.</p>
    <ul>
      <li>Bullets, fragments, and tables all render cleanly.</li>
      <li>Add `data-footer` or `data-date` when you need overrides.</li>
    </ul>
  </div>
</section>
```

### Full-Bleed Image Slide

When the photograph should dominate, switch to `data-slide-type="image"`. The overlay opacity can be tweaked per slide.

```html
<section
  data-slide-type="image"
  data-background-image="images/saentis.jpg"
  style="--overlay-opacity: 0.45"
>
  <div class="content">
    <h1>Headline</h1>
    <p>Explain the image or use it for quotes.</p>
  </div>
</section>
```

## Content Helpers

- **Global metadata:** The `.reveal` element accepts `data-organization`, `data-speaker`, `data-email`, `data-date`, and `data-module`. Values cascade to every slide so you configure them once.
- **Fragments:** Use Reveal’s `.fragment` class. Adding `.arrow` gives you the magenta pointer used throughout OST decks.
- **Two-column layout:** Wrap content with `.two-columns-container`, then add `.two-column-left` and `.two-column-right` for responsive columns.

  ```html
  <section>
    <h1>Comparison</h1>
    <div class="two-columns-container">
      <div class="two-column-left">Pros…</div>
      <div class="two-column-right">Cons…</div>
    </div>
  </section>
  ```

- **Figure captions & zoom:** Any `<img>` placed on a regular content slide and given `data-caption` is automatically wrapped in `<figure>` with a caption plus a click-to-fullscreen overlay.
- **Scale utilities:** Apply `scale09` through `scale06` on a section to shrink typography for dense content.

## Runtime Enhancements

The script in `assets/ost-reveal.js` adds niceties on top of Reveal.js:

- Injects fixed OST footers for regular slides and a larger footer for chapter slides.
- Copies metadata from the deck container to title, chapter, and standard slides.
- Adds slide numbers and preserves them when exporting to PDF via `?print-pdf`.
- Enhances `<pre><code>` blocks with copy-to-clipboard and fullscreen buttons.
- Wraps standalone images with `<figure>` and enables click-to-zoom.
- Briefly reveals the Reveal.js navigation controls after each slide change so presenters know where they are.

## Customization

- Adjust colors, spacing, or fonts inside `assets/ost-reveal.css`. All OST tokens live near the top of the file as CSS custom properties.
- Replace the hero artwork or logos inside `brand/` if you need another language variant.
- Swap the background photos in `images/` or point slide `data-background-image` attributes to your own assets.
- Add more fonts by editing `fonts/source-sans-pro.css` and updating the `@import` near the top of the theme CSS.

## Printing & Exporting

Reveal.js can export PDF handouts by appending `?print-pdf` to the deck URL. The script injects per-slide footers into the generated pages so the PDF matches the on-screen experience.

## Authoring Tips

- Keep each idea in its own `<section>`—small slides beat dense walls of text.
- Use chapter slides to reset attention and to update the auto-generated chapter label.
- Prefer semantic HTML elements (`<h1>`, `<p>`, `<ul>`, `<figure>`) so the CSS can do the heavy lifting.
- Test both light and dark rooms by trying your slides on a projector early; adjust overlay opacity or scale utilities as needed.
