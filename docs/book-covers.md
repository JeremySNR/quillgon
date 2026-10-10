# Book cover generation

Open **Book covers** in the workspace. **Generate from my book** uses the title,
genre, intent, characters, locations and opening scene cards. No completed draft is
required. Optionally add a pen name, choose an art medium, and describe subjects,
colors, mood or exclusions. Disable lettering for artwork to typeset yourself.
Each click creates one new cover; previous versions stay in the gallery. Use the
thumbnail check to inspect readability, reuse direction to generate a variation,
and download the front cover as PNG. Reusing direction generates a new composition;
it does not edit or preserve the previous image.

Images and their generation briefs are saved in the manuscript's `covers/` folder.
The brief reflects the story when that version was generated. Covers do not change
automatically when the manuscript changes, and manuscript exports do not embed them.

## Model and account setup

Researched October 10, 2026. OpenAI's current image family is GPT Image 2.5.
This workflow uses `gpt-image-2.5-sunburst` at high quality for a cover where quality
matters more than speed. Flare is the faster alternative in that family. Generation
uses `POST /v1/images/generations`, requests one opaque PNG at 1600 × 2560 (5:8),
and runs as a background job. This matches KDP's ideal ebook cover dimensions;
OpenAI currently labels outputs above 3,686,400 pixels experimental, including this
4,096,000-pixel size. Review the actual output before uploading.

Use `OPENAI_API_KEY`, or the custom API key environment variable and base URL
configured for an OpenAI frontier model. Other writing providers, including Codex,
use `OPENAI_API_KEY` for images. Offline mode blocks generation. Image access or
organization verification may be required. A Codex subscription does not supply
API billing for this workflow. Each generation is a separate paid API request;
there are no automatic retries, and only one cover job runs at a time. Image costs
are not included in the manuscript's text-token cost report.

## Prompt and review approach

The prompt separates the intended output, art direction, composition, craft,
lettering and bounded story context. Users can leave decisions to the book or
override visual direction. It favors a specific story motif, deliberate negative
space, genre cues and a limited palette. Concrete lighting, materials, anatomy,
ink and pigment qualities encourage a considered finish. These are design
heuristics, not a guarantee that a generated image will be indistinguishable from
human work. No artists or existing covers are copied as templates.

Lettering includes only the exact title and optional author name. Review spelling,
anatomy, visual artifacts, contrast and the focal point at thumbnail size. A front
cover PNG is not a print wrap: paper, trim size, page count, bleed and spine must
be handled separately using the printer's template.

Sources:

- [OpenAI image prompting](https://developers.openai.com/api/docs/guides/image-prompting): current models, visible-detail prompting, lettering and deliberate iteration.
- [OpenAI Images API reference](https://developers.openai.com/api/reference/resources/images/methods/generate): generation endpoint and parameters.
- [Reedsy: How to Design a Book Cover](https://reedsy.com/blog/guide/book-cover-design/how-to-design/): genre, communicative intent, focal point, contrast and legible type.
- [Reedsy: How to Create a Book Cover](https://reedsy.com/blog/guide/book-cover-design/how-to-create/): thumbnail review.
- [KDP ebook cover requirements](https://kdp.amazon.com/en_US/help/topic/G200645690): ideal ebook image dimensions.
- [KDP print cover calculator](https://kdp.amazon.com/en_US/cover-templates/): separate print layout specifications.
