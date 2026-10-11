# Research: life stories and voice dictation

October 2026. Two questions:

1. Could Quillgon help someone write an autobiography or memoir with AI, as well as a novel?
2. Would Wispr-Flow-style dictation be worth adding, and how would we build it?

The answer to both is yes. This document covers what the research says, how each finding maps onto the current code, and a phased plan.

**How this was researched:**
- A read of the codebase.
- Two web research passes: memoir craft and life-story services, and Wispr Flow plus the open-source speech landscape.

**Caveats:**
- The egress proxy blocked many pages, so much of the external material comes from search-result summaries rather than full reads.
- Vendor latency and accuracy figures are the vendors' own.
- Prices move constantly. Treat every number here as a ballpark to check before relying on it.
- Nothing here is legal advice.

## Part 1: Can Quillgon write a life story?

### The short answer

Yes. The central idea carries over well, and in one way it fits memoir better than it fits fiction. The idea is that the story graph is the source and prose is compiled from it, with hand edits read back into the graph.

A memoir's facts are not invented, so the graph is the record of what actually happened:
- **Who:** the people in the author's life.
- **What and when:** dated events.
- **Who knew what:** what each person knew at each point.
- **Where:** places.

`shared.md` already tells every agent "Never invent facts", and the extractor already prefers precision over coverage. Those are exactly the instincts a memoir tool needs.

**What changes is the direction of travel:**
- **A novel** is built top down: idea → intent → plot points → structure → scene cards → prose. The planner invents the graph and the writer compiles it.
- **A memoir** is built bottom up. The raw material is the author's recollections: talked, dictated, typed, or prompted by a photograph. The graph has to be *harvested* from that material before it can be shaped.

So the main new piece is a **gathering stage** that turns conversations and dictation into timeline events, people, places and facts. Most of the machinery downstream of the graph can be reused.

### What carries over, what changes, what goes

| Today | In a life story | Code |
| --- | --- | --- |
| Thinking partner (one question at a time, every reply edits the board, undo per reply) | **The biographer.** The interview at the heart of the mode. The pattern is already right. | `muse/prompt.md` talk task, `engine/ideation.ts` `talk()` / `applyTalk()` |
| Interviewer (one round of at most five questions) | Replaced by the biographer, which runs across many sessions | `interviewer/` |
| `timeline.yaml` | **The life timeline.** Real dates, now the spine of the book. Needs date precision, confidence and source. | `TimelineEvent`, schemas 226-236 |
| Characters, `state.yaml` (knows / feels / location) | **People.** Keep knowledge and feelings per scene. Add relationship, living or deceased, real name / pseudonym / composite, consent. Drop want / need / wound / lie / arc. | `CharacterBio` 181-199 |
| Locations, fact glossary | Places, with period detail as prompts for the senses | `Locations`, `FactGlossary` |
| Plot points | **Key moments**: high point, low point, turning point and so on (see below) | `PlotPoint` 143-159 |
| Structure (three alternatives: expected, unexpected, wild card) | **Shape**: chronological, thematic, braided, frame, vignettes, one season. The author picks; it is not invented. | `planner`, `structure.yaml` |
| Scene cards | Kept. Add *then* (what I knew at the time) and *now* (what I understand looking back), plus the memories each card draws on. | `SceneCard` 269-293 |
| Extraction and sync | Kept as is. It matters more here, because much of the prose is the author's own. | `engine/extraction.ts`, `sync.ts` |
| Ripples and impact analysis | Kept. "Grandad's death was 1983, not 1981" should ripple through every scene that depends on it. | `impact`, `ripple` |
| Style sheet, learned rules, both-orders judge | Kept. The voice is the author's own speech, so samples come from their transcripts. | `style.yaml`, `humaniser`, `judge` |
| Git history, what-if branches | Kept. Branches suit "the version for the family" against "the version for publication". | `git` |
| Obligations ledger (clue, promise, Chekhov's gun) | **Themes and threads ledger**: a motif, an object or a question the book raises and returns to. Paying off a "clue" makes no sense in a life. | `Obligation` 303-316, `obligations.ts` |
| Reader report: twist guessed early, twist fair | Drop twist scoring. Keep engagement, confusion and boredom, which matter just as much in memoir. | `quality/reader.ts` |
| Muse divergence (personas, least-typical ideas first, cliché flags) | **Remove.** Steering away from the probable is the right instinct for fiction and the wrong one for a true story: it would invent a life. | `ideation.ts` 20-34 |
| Critic checklist (passive protagonist, coincidence, tidy resolution) | Rewrite for memoir. Real lives have coincidences. The useful checks are a missing narrator-now voice, no stated "what this is about", and a timeline-dump middle. | `critic/`, `engine/critics.ts` |
| Writer: "do not add events not on the card" | Keep, and tighten. Every factual claim in the prose must trace back to a memory (see *Truth*). | `writer/prompt.md` |

### What the research says about how life stories are built

**Three forms, three sets of defaults**

| Form | What it is | What the tool should default to |
| --- | --- | --- |
| **Autobiography** | The whole life so far, usually chronological. | Coverage matters most. |
| **Memoir** | One slice, period or theme of a life, chosen for meaning rather than completeness. | Leaving things out is the main craft decision. |
| **Legacy or life-story book** | Usually private, for children and grandchildren. In practice mostly an autobiography ([LifeBook](https://www.lifebookmemoirs.com/what-is-the-difference-between-a-memoir-and-an-autobiography/)). | Completeness is a virtue ("don't forget Aunt May"). Legal flags matter less, because it is private. |

So the first question should be which of the three the author is writing, because the answer changes:
- interview coverage versus a theme-led outline;
- whether the legal review matters;
- how polished the prose should be.

**Common shapes, with examples**

| Shape | Examples |
| --- | --- |
| **Chronological**, cradle to grave | Most legacy books. *Born a Crime* is mostly chronological across three parts. |
| **Thematic**: chapters are subjects, not years | David Carr, *The Night of the Gun* |
| **Braided**: two or more strands, often then and now | *H is for Hawk* (grief, the hawk, T. H. White); *Wild* (the trail plus flashbacks); *The Color of Water* |
| **Frame or in medias res**: open on a later moment, then go back | *Wild*'s lost boot; *The Glass Castle*'s opening; *The Liars' Club*'s circular shape |
| **Vignettes or essays**: fragments | *Crying in H Mart* is often cited as non-linear |
| **One season or one arc**: a single transformation | *Wild* (one summer), *H is for Hawk* (one year), *Educated* |

([Writers for Hire](https://thewritersforhire.com/?p=38110), [LitCharts on Wild](https://litcharts.com/lit/wild/prologue), [eNotes on H is for Hawk](https://www.enotes.com/topics/h-hawk))

**Craft ideas the data model should hold**

- **Situation and story** (Vivian Gornick, *The Situation and the Story*).
  - The *situation* is what happened. The *story* is "the emotional experience that preoccupies the writer": what the author came to understand.
  - Intent needs a field for the story, separate from the events ([eNotes](https://www.enotes.com/topics/situation-story)).
- **Memoir as an argument** (Marion Roach Smith, *The Memoir Project*).
  - Know what the book is about, write it on the wall, and keep only the stories that serve it.
  - This is the test for what to leave out ([Creative Penn](https://www.thecreativepenn.com/2013/08/26/writing-memoir/)).
- **"Think small"** (William Zinsser).
  - Make "a series of reducing decisions", and choose small, vivid incidents over the ones that seem "important" ([NPR](https://www.npr.org/5339491)).
- **Two narrators.**
  - Phillip Lopate and David Mura place a memoir's power in the tension between the self who lived it and the self who now understands it ([Lopate](https://whitman.edu/documents/edit/Reflection%20and%20Retrospection-%20A%20Pedagogic%20Mystery%20Story%20%C2%BB%20Phillip%20Lopate.pdf), [Gulf Coast](https://gulfcoastmag.org/online/blog/story-and-narrative-voice-in-memoir)).
  - This becomes the then / now pair on every card.
- **Carnality and voice** (Mary Karr, *The Art of Memoir*).
  - Sensory detail "zips the reader into your skin", and a memoir lives or dies on voice.
  - Karr's truth contract: untruth is "making up events with the intention to deceive" ([Kirkus](https://kirkusreviews.com/book-reviews/mary-karr/the-art-of-memoir)).

**How professionals gather a life**

- **Ghostwriters:**
  - Interview for about 10 to 60 hours, depending on the service and the length of the book. Scribe quotes about 20 hours in 2-hour sessions ([Scribe](https://scribemedia.com/lp/q/memoir-ghostwriter), [DePauw](https://depauw.edu/stories/details/the-ghostwriter)).
  - Work from the transcripts to absorb the subject's voice.
  - Rewrite speech into prose that reads as if the subject wrote it.
- **LifeBook:**
  - About twelve 90-minute interviews over several months, scanning photos and documents during the visits.
  - Chapters drafted after each interview and approved in stages.
  - No outside research: every detail comes from the subject ([LifeBook](https://www.lifebookmemoirs.com/en-gb/how-it-works/)).
- **Dan McAdams' Life Story Interview** is the best scaffold found:
  1. Split the life into 2 to 7 titled chapters.
  2. Ask for key scenes: high point, low point, turning point, earliest memory, a vivid adult memory, a wisdom event.
  3. For each scene, ask what happened, who was there, what you thought and felt, and why it matters.
  4. Then the future, challenges and values.
  - ([outline](https://web.lemoyne.edu/~hevern/psy444_24F/documents/The%20Life%20Story%20Interview%20Outline%2020241022.pdf))
- **Consumer services:**
  - **Storyworth** sends a weekly emailed prompt for a year and prints the answers.
  - **Remento** records spoken answers, transcribes and rewrites them with AI, and prints QR codes in the book that link to the original audio.
  - **Newer AI-interviewer apps:** Autobiographer, StoriedLife, Life Story AI, memoir.bot.
  - The common complaint about AI rewrites is that they **drift from what was actually said**: one Remento customer wanted "more of her actual words" ([Remento](https://resources.remento.co/getting-started/4-minute-overview), [Storyworth's review of Remento](https://welcome.storyworth.com/blog/remento---how-it-works-pricing-reviews-top-alternatives)).

That complaint is the strongest argument for Quillgon's approach. Every sentence of a drafted chapter could be traced to the memory it came from, and anything without a source could be flagged.

**Truth, real people and hard memories**

- **Memory is reconstructive.**
  - The usual practice is to signal uncertainty in the text and to add an author's note about reconstructed dialogue, compressed time and composite characters.
  - *Educated* footnotes places where family accounts differ ([Jane Friedman](https://janefriedman.com/memoir/)).
  - James Frey's *A Million Little Pieces* shows the cost of getting this wrong ([Ethics Unwrapped](https://ethicsunwrapped.utexas.edu/case-study/million-little-pieces)).
- **Writing about living people** can raise defamation, false-light and private-facts claims, and the last can apply even when the content is true.
  - Self-publishers are advised to consider signed releases ([Authors Alliance guide](https://authorsalliance.org/2023/12/05/authors-alliance-releases-new-legal-guide-to-writing-about-real-people)).
  - UK law differs from US law.
- **Trauma-informed interviewing:**
  - The narrator sets the pace.
  - Offer pause, skip and "off the record" at any time.
  - Start with neutral topics.
  - Accept memories that arrive out of order and in fragments.
  - Never push for detail ([Voice of Witness](https://voiceofwitness.org/resources/trauma-informed-storytelling-practices/)).

### Proposed design: a life-story mode

**1. A book kind.**
- Add `kind: novel | memoir | autobiography | legacy` to `Book`; today there is only a free-text `genre`.
- Every mode-specific prompt, stage list and view switches on it.
- `shared.md` currently says "helps an author build a novel" and cannot be overridden, so it needs a variant per kind.

**2. Stages.** These replace `idea → intent → plot-points → structure → cards → prose`:

| Stage | What happens |
| --- | --- |
| **Purpose** | Pick the form and the audience (family only or published). Then the *story* in one line (Gornick or Smith), separate from the situation. Also hard rules ("nothing about my sister's divorce") and the people who must not be named. |
| **Gathering** | The biographer interviews over as many sessions as needed, McAdams-style, and the author dictates and attaches photos or letters. Every session is stored raw, then extracted into events, people, places and facts, each change reviewable and undoable as the thinking partner does today. This stage never really closes: the author can return to it from anywhere. |
| **Timeline** | Review the harvested life. Merge duplicates, fix dates and mark key moments. Gaps become questions. |
| **Shape** | Pick a shape (chronological, thematic, braided, frame, vignettes, one season), then title the life chapters. The planner proposes which memories go in which chapter. Anything the "about" test leaves out goes to a **kept, not cut** pile, which a legacy edition can bring back. |
| **Cards** | One card per scene, built from the memories behind it. Each card holds then / now, the senses, and the people present. |
| **Prose** | Choose how much to write in the author's own words: *verbatim*, *light* (cleaned speech; the default) or *polished*. The writer is limited to what the linked memories contain. |

**3. New data:**
- **`memories/<id>/`**: `audio.webm` (optional), `transcript.md` (raw ASR output, never changed), `cleaned.md`, `meta.yaml` (date, source, provider, linked events). These files are the evidence behind everything else.
- **Timeline events** gain:
  - `date_precision`: day, month, year, decade or approximate;
  - `age`;
  - `source`: memory, letter, photo, record, or someone else's account;
  - `confidence`;
  - `memories: [ids]`.
- **People** gain:
  - `relationship`;
  - `living`;
  - `naming`: real, pseudonym or composite;
  - `consent`: not asked, asked, approved or objected;
  - `sensitivity`.
- **Truth flags per fact**: verified, memory only, disputed (with the other version), reconstructed dialogue, compressed time, composite. These generate the author's note.
- **`questions.yaml`**: questions the biographer still wants to ask, generated from gaps:
  - events with no date;
  - people who have no scene;
  - a chapter with no high or low point;
  - a scene with no senses.
  - Questions for *someone else* ("ask Mum about the move to Leeds") go here as well.

**4. Agents:**
- **biographer**: the talk task, rewritten for memoir. One question at a time, sensory and "why does it matter" follow-ups, McAdams prompts, never pushes a topic the author has marked as sensitive.
- **extractor**: unchanged in kind. It needs a memory-to-graph mode that can create people and events; today unknown character ids are filtered out (`extraction.ts:110`).
- **planner**: proposes chapter assignments for a chosen shape instead of inventing three structures.
- **writer**: memoir rules. First person with the narrator-now voice. No event, person, date or quotation that is not in the linked memories. Mark reconstructed dialogue.
- **reviewer before publishing**: a living-people pass covering consent, potentially defamatory statements and private facts. It is presented as information, not legal advice.

**5. Truth as a check, not just a prompt.**
- The existing `compareWithCard` already raises contradictions when prose does not match its card.
- In memoir, extend it to compare the facts extracted from a drafted chapter with the facts in its source memories.
- A sentence asserting something with no source is flagged as *invented*, and the author confirms it, rewrites it or marks it as reconstructed.
- Remento-style AI tools have no such mechanism, and this addresses their users' main complaint.

**6. Privacy.**
- The local-first model is a real advantage here: a family history in plain files on your own machine, under git, works offline.
- Any cloud provider that sees transcripts or audio should be named on screen, per provider.

### Cost of building it

| Change | Size |
| --- | --- |
| `Book.kind`, a `shared.md` per kind, and prompt variants for biographer, planner, writer, extractor and critic | Small to medium. Overrides already load per agent (`define.ts:24-35`), but per task and per kind needs a little plumbing. |
| Memory store, gathering stage, timeline view | Medium. This is the bulk of the new work. |
| Stages per kind | Medium. Stages are a hard-coded linear enum shared by `pipeline.ts` and the UI stepper. There is no registry yet. |
| Fields for people, timeline and truth flags | Small. These are Zod additions with defaults, so existing books still validate. |
| Draft-against-sources check | Medium. It reuses extraction and contradiction reporting. |
| Living-people review, author's note generation | Small to medium. |
| Removing or hiding twist, Chekhov and muse-divergence features in memoir mode | Small. They become conditional UI and checks. |

## Part 2: Voice dictation

### What Wispr Flow does

Wispr Flow is a system-wide dictation app: hold a key, speak, release, and clean text appears at the cursor in any app. It runs on Mac, Windows, iOS and, since early 2026, Android.

**Architecture** (from the company's own posts and its host's case study):
- **Two stages:** speech recognition (ASR), then a fine-tuned **Llama** model that cleans and formats the text.
- **Latency target:** about **700 ms at p99**, from the end of speech to the final formatted text. That splits into roughly 200 ms each for ASR, LLM and network ([Wispr: technical challenges](https://wisprflow.ai/post/technical-challenges), [Baseten case study](https://www.baseten.co/resources/customers/wispr-flow/)).
- The cleanup model has to produce 100+ tokens in under 250 ms.
- The company says its ASR models are built in-house and retrained weekly. Its accuracy claims (about 10% errors against 27% for Whisper) are its own benchmark ([TechCrunch](https://techcrunch.com/?p=3069483)).

**Why it feels better than plain dictation:**
1. **Speed.** Text lands almost as you let go of the key. ASR runs on chunks while you are still speaking, so only the last fraction is left at release.
2. **The cleanup pass.** Fillers and false starts disappear. "Backtrack" resolves self-corrections ("it was Tuesday, no, Wednesday") using context to tell a correction from a real "actually" ([docs](https://docs.wisprflow.ai/articles/5373093536-how-do-i-use-smart-formatting-and-backtrack)).
3. **Context.** It reads the active app and the text near the cursor through accessibility APIs. Mid-sentence it starts in lowercase; in chat apps it drops the final full stop ([docs](https://docs.wisprflow.ai/articles/4678293671-feature-context-awareness)).
4. **A personal dictionary.** Names you use get spelled correctly.
5. **Command mode.** Select text, say "make this shorter", and it is rewritten.

The stated goal is to minimise edits after dictation.

**Weak points:**
- It is cloud-only, with no offline mode.
- Privacy Mode (zero retention) is off by default for consumers.
- In 2025 it was criticised when users found the context feature sending screenshots. Training on user data became opt-in afterwards, according to secondary sources.
- In 2026 it withdrew compliance certificates tied to the Delve audit scandal and re-certified ([Wispr](https://wisprflow.ai/post/a-note-on-our-compliance-program)).

For a book about someone's family, that history is a reason to design for local processing first.

### What exists in open source

**Speech models.** All the models below run on a laptop.

| Model | Why it matters |
| --- | --- |
| **Whisper large-v3-turbo** (MIT) | The safe default: many languages, good accuracy. Needs voice-activity detection (VAD) in front of it, because it can hallucinate on silence. |
| **NVIDIA Parakeet TDT 0.6B v3** | Very fast even on CPU, European languages. Most local dictation apps now use it as their "fast" option. Check the licence; it is reported as CC-BY-4.0. |
| **Moonshine / Moonshine Streaming** | Tiny English-only streaming models (34M to 245M parameters) for low-end machines. |
| **Newer high-accuracy models** | Cohere Transcribe, IBM Granite Speech, Qwen3-ASR (all Apache-2.0). They lead the Open ASR leaderboard but are heavier. |
| **Mistral Voxtral Realtime** (Apache-2.0) | Kyutai STT and Nemotron streaming are in the same class: true streaming with tunable delay. Better suited to servers than laptops today. |

**Runtimes:**
- **[whisper.cpp](https://github.com/ggml-org/whisper.cpp)** (MIT)
  - GPU support: Metal, Core ML, Vulkan, CUDA.
  - Built-in Silero VAD.
  - Ships a Node addon example.
- **[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)** (Apache-2.0)
  - Node addon and WASM builds.
  - Runs Parakeet, Moonshine, streaming Zipformer and Silero VAD.
- **[transcribe.cpp](https://github.com/handy-computer/transcribe.cpp)** (MIT)
  - One runtime for about 20 model families, from Handy's author.
  - Promising but very new.
- **[@ricky0123/vad-web](https://github.com/ricky0123/vad)**
  - Silero VAD in the browser.
  - Hands back 16 kHz audio for each stretch of speech.
- **Transformers.js on WebGPU**
  - Runs small Whisper models in the browser with no native code.
  - Native code is clearly faster for turbo-class accuracy.

**Open-source Wispr alternatives worth reading:**

| Project | Licence | Why look at it |
| --- | --- | --- |
| **[OpenWhispr](https://github.com/OpenWhispr/openwhispr)** | MIT | **Nearly our stack**: Electron, React 19, TypeScript, better-sqlite3. Local whisper.cpp and Parakeet (via sherpa-onnx), bring-your-own-key cloud for ASR and cleanup, llama.cpp for local cleanup. The closest reference implementation. |
| **[Handy](https://github.com/cjpais/Handy)** | MIT | Tauri and Rust, fully local, Whisper and Parakeet, Silero VAD, hold or toggle. Well loved and cleanly scoped. |
| **[Whispering (Epicenter)](https://github.com/EpicenterHQ/epicenter/tree/main/apps/whispering)** | AGPL-3.0 | **The original transcript is never changed.** Each LLM transformation is saved as a new file, and recordings and transcripts live as Markdown and audio in a git-versioned folder. This matches Quillgon's book-as-git-repo model; borrow the idea, not the code (AGPL). |
| **[VoiceInk](https://github.com/Beingpax/VoiceInk)** | GPL-3.0 | macOS. Per-app "modes", dictionary plus replacements. |
| **[VoiceTypr](https://github.com/moinulmoin/voicetypr)** | AGPL | Separate ASR and formatting providers. |
| **[nerd-dictation](https://github.com/ideasman42/nerd-dictation)** | GPL | Small Linux tools built on older stacks (Vosk). |
| **[WhisperWriter](https://github.com/savbell/whisper-writer)** | GPL | Small Linux tool on older stacks (faster-whisper). |

**What makes the open-source tools good** is the same recipe as Wispr:
- VAD-chunked ASR that starts while you speak;
- an optional LLM cleanup pass;
- a dictionary;
- hold-to-talk.

What they lack compared with Wispr is a fine-tuned cleanup model on a globally tuned low-latency cloud. For a writing app that gap matters less than it does for system-wide typing. Half a second more after a long memory is fine. Changing what the author said is not.

**Hosted APIs:** ballparks, check before use.

| API | Price | Streaming | Vocabulary |
| --- | --- | --- | --- |
| OpenAI `gpt-4o-mini-transcribe` / `gpt-4o-transcribe` | About $0.003 / $0.006 per minute | Batch; separate realtime models | Free-text prompt |
| Groq `whisper-large-v3-turbo` | About $0.04 per hour | Batch, very fast | Whisper prompt |
| Deepgram Nova-3 / Flux | About $0.005 to $0.008 per minute | Yes, low latency | Keyterms |
| AssemblyAI Universal-Streaming | About $0.15 per hour | Yes, about 300 ms | Up to 100 keyterms, updatable mid-stream |
| ElevenLabs Scribe v2 Realtime | About $0.39 per hour | Yes | Not confirmed for realtime |
| Mistral Voxtral Realtime | About $0.006 per minute | Configurable delay | Not confirmed |

### Why dictation fits Quillgon especially well

- **The graph is the personal dictionary.** Wispr has to learn names from your corrections. Quillgon already knows every character, place, alias and glossary term in the book, and in memoir mode every person in the author's life.
  - Feed them to the ASR prompt. Whisper's prompt holds about 224 tokens, so rank names by how relevant they are to the current scene.
  - Feed them to provider keyterms.
  - Feed the full list to the cleanup pass.
  - Then "Siobhan" and "Auntie Bríd" come out right the first time.
- **Context awareness without screenshots.** Wispr reads other apps through accessibility APIs. Quillgon *is* the app, so the cleanup pass can see:
  - the scene card;
  - the previous paragraph;
  - whether the cursor is mid-sentence;
  - the style sheet (spelling variant, quote style, em-dash rules).

  Then the cleaned text matches the book's conventions before it lands. Every word already goes through the style checks afterwards.
- **Command mode exists already.** Select text and say an instruction: this is the humaniser and reviser's span-edit flow with a voice front end. Spoken edits go through the same review and both-orders judging as typed ones.
- **The author's words are the memoir.** Keeping the raw transcript unchanged, and linking prose back to it, is the provenance a memoir needs. It is also the answer to Remento's "more of her actual words" complaint.
- **Novels benefit too.** Talking a plot through with the thinking partner is more natural out loud. Today that input is a plain `<textarea>` (`views/spark.tsx`).

### Proposed architecture

**Two ways to dictate:**
1. **Bursts** (Wispr-style): hold a key in the prose editor, the thinking-partner box or a card field.
   - ASR starts on VAD chunks while you speak.
   - On release, run cleanup and insert at the cursor as a normal CodeMirror transaction, so undo works.
   - Target under 1 s at p90 for the local default.
2. **Memory sessions**: start recording and talk for as long as you like.
   - VAD splits the audio at pauses into segments of 30 s or less. Each segment is transcribed with the end of the previous text as its prompt.
   - Text appears live, greyed out until committed.
   - Cleanup runs per paragraph.
   - When you stop, the memory is saved under `memories/` and the extractor proposes timeline events, people and facts for review.
   - In memoir mode the biographer can then ask its follow-up question out loud or on screen.

**Pipeline:**

```
renderer: getUserMedia → AudioWorklet (16 kHz mono) → Silero VAD
                │                                       │ speech segments
                │ MediaRecorder (Opus, kept as evidence)▼
                ▼                           Electron utilityProcess or server
          memories/<id>/audio.webm          Transcriber: whisper.cpp | sherpa-onnx (Parakeet) | cloud
                                                        │ raw text (never edited)
                                                        ▼
                                  Cleanup: existing model adapter + dictionary + cursor context + style sheet
                                                        │ verbatim | light | polished
                                                        ▼
                                  insert at cursor  /  memory → extractor → reviewable graph changes
```

**Engines.** A `Transcriber` interface beside the existing `Backend`, chosen per book like the model tiers:

| Engine | What it uses | When |
| --- | --- | --- |
| **Offline (default)** | whisper.cpp with large-v3-turbo quantised, or sherpa-onnx with Parakeet v3 | Fast on CPU. Models download on first use and are never bundled. This keeps the "works offline, no API key" promise. |
| **Cloud** | OpenAI `gpt-4o-mini-transcribe` (reuses `OPENAI_API_KEY`), Groq, or a streaming vendor with keyterms | Opt-in. |
| **Offline cleanup** | A small local model via llama.cpp, or no cleanup | Without cleanup, verbatim is still useful. |

**Guardrails on cleanup:**
- Diff the raw text against the cleaned text.
- Flag any proper noun that appears in neither the transcript nor the dictionary.
- Flag a change in content-word count beyond a threshold.
- Never let cleanup add a fact. This is the same discipline as the writer.
- Learn from corrections: when the author fixes a transcribed name, offer to add it to the dictionary, much as the style sheet's "learned from your edits" already proposes rules.

**What has to change in the code:**

| Where | Change |
| --- | --- |
| `apps/desktop/electron/main.cjs:179-181` | Every permission request and check is denied. Allow `media` with audio only, and only for the app's own origin. |
| `apps/desktop/electron-builder.config.cjs` | Add `NSMicrophoneUsageDescription` and call `systemPreferences.askForMediaAccess('microphone')` on macOS. |
| `apps/desktop/index.html:7` (CSP) | Add `media-src 'self' blob:` for playback. Cloud ASR calls go through the server, so `connect-src 'self'` stays. |
| `packages/server/src/index.ts` `readBody` | Accepts JSON only, up to 20 MB. Add one audio upload route with its own size limit and the same token and origin checks; base64 in JSON would also work for bursts. |
| `packages/agents/src/adapter/types.ts` | `Backend` is text-in, JSON-out. Add a separate `Transcriber`. The cover generator's direct call to the OpenAI images endpoint (`server/src/covers.ts`) shows the pattern for a non-chat API. |
| Native modules | whisper.cpp or sherpa-onnx bindings need rebuilding for Electron, as `better-sqlite3` already is in `prepare-package.mjs`. Running them in a `utilityProcess` keeps the UI responsive. |
| Offline suite | A fixed transcript for the offline provider, so e2e tests can drive dictation without a microphone. |

**What to measure:**
- time from key release to inserted text (p50 and p90);
- edits per 100 dictated words;
- dictionary-term hit rate;
- for memoir, the share of drafted sentences that trace back to a memory.

## Part 3: Where it sits in the UI

**Recommendation:** life stories are a core part of Quillgon, chosen per book when the book is created. They are not a top-level mode switch, and not a separate product.

**Why not a mode tab in the top bar:**
- A book is never both a novel and a memoir, so a switch you can flip mid-book has nothing sensible to show.
- It would also mean two navigation trees to keep in sync, test and screenshot.

**Why not a separate area:**
- It would duplicate the parts that carry the value: the editor, sync, ripples and history.

**How it works:**
- The welcome screen asks three things:
  - **What are you writing?** A novel, a life story or a memoir.
  - **Whose story is it?** Mine, or someone else's.
  - **Who is it for?** Family, or publishing.
- The kind is shown beside each book under "Open a book".
- The shell stays as it is: top bar, search, command palette, status bar, branches and focus mode.
- The sidebar adapts to the kind:

| Novel | Life story | |
| --- | --- | --- |
| Writing desk | Writing desk | Adapted: counts memories and years covered; the next step is often the ghostwriter's next session or a draft waiting for notes |
| | **Sessions** | New: interview sessions with the ghostwriter (see Part 4); recordings, transcripts and photos |
| Story planning | Shaping the book | Adapted: every chapter has its own stage (see Part 4) instead of the whole book moving together |
| Manuscript | Manuscript | Same |
| | **Timeline** | New: years along the axis with age beneath, fuzzy dates as bars, gaps shaded and turned into questions |
| Characters | People | Adapted: relationship, living, real name or pseudonym, consent |
| Threads | Themes | Adapted: the same horizontal chart |
| Ripple review | Ripple review | Same |
| | **Ghostwriter's notebook** | New: what the AI has learned about the author, editable |
| Reader report | Before you share | Adapted and new: reader report without twists, plus unsourced claims, consent and the author's note |

**What is hidden in a life-story book:**
- the idea board's personas;
- the "how predictable is this turn?" check;
- twist verdicts;
- the setups ledger.

**The scene editor changes least.** It gains three things:
- a microphone (hold a key to dictate at the cursor);
- a source marker per paragraph that plays the recording behind it;
- a wavy underline on claims no memory supports. This reuses the style-check decorations in `prose-editor.tsx`.

**Dictation belongs to every kind of book.** It works the same everywhere: in the editor, the thinking partner, card fields, interview sessions and margin notes. Its settings are a new Voice tab in Settings.

## Part 4: The AI as ghostwriter

In a life-story book the AI should not wait for the author to write. It should work like a professional ghostwriter:
- interview over many sessions;
- keep asking until a story has real detail;
- draft the chapters itself;
- go back and forth with the author until each chapter is signed off.

This replaces the "biographer" described in Part 1. That one only interviewed; this one also drafts and revises.

### How professionals do it

All the sources below came from search summaries, and many are ghostwriters' own marketing, so treat the numbers as rough.

- **Interview hours.** About 20 to 30 hours for a full memoir. Reported figures run from 10 hours to Moehringer's roughly 250 hours with Agassi. A rough rule is 1.5 to 3 hours per chapter ([Amy Suto](https://www.amysuto.com/desk-of-amy-suto/my-process-how-i-ghostwrite-books-as-a-memoir-ghostwriter), [Scribe](https://scribemedia.com/lp/q/memoir-ghostwriter), [London Writers Club on Andrew Crofts](https://londonwritersclub.com/?p=999)).
- **A sample chapter sets the voice.** Scribe drafts one chapter first, and finishes the rest only once the client agrees the voice ([Scribe](https://scribemedia.com/how-it-works)).
- **Drafting is a rolling loop.** Other ghostwriters share chapters as they are finished, so they can be discussed in later interviews.
- **Questions between sessions.** Ghostwriters send written questions between drafts. Clients often give better material answering them later by voice memo than live ([Writers for Hire](https://www.thewritersforhire.com/the-insiders-perspective-what-ghostwriters-wish-clients-knew-before-starting-a-memoir-project/)).
- **Revision summaries.** Each round comes with a short summary of what changed ([River Editor](https://rivereditor.com/blogs/9-revision-strategies-keep-ghostwriting-clients-happy)).
- **Voice comes from the transcripts.**
  - Mark "gold quotes" and keep the client's signature phrases.
  - Ask "does this sound like you?"
  - Watch for clients starting to "perform" in later sessions ([River Editor](https://rivereditor.com/blogs/how-ghostwriters-capture-client-voice-first-interview)).
  - Over-polishing is the common failure. A plain line made grand no longer sounds like the person who lived it.
- **The ghost argues, the client decides.** Crofts calls the ghost "an instrument of the client". Moehringer's 2 a.m. argument with Prince Harry over the last line of a *Spare* scene ended with Harry agreeing to cut it ([ET](https://www.etonline.com/prince-harrys-ghostwriter-recalls-arguing-with-royal-over-princess-diana-story-for-spare-memoir)).

**Interviewing technique:**
- **Open questions.** Baylor's oral-history manual prefers "Tell me how you felt about the place where you grew up" to a leading yes/no question. It also warns against fully scripted questions ([Baylor](https://library.web.baylor.edu/sites/g/files/ecbvkj1806/files/2024-12/intro_manual_2016.pdf)).
- **StoryCorps follow-ups.** "What happened next?", "How did that make you feel?", "What were you thinking at the time?" ([StoryCorps](https://storycorps.org/participate/tips-for-a-great-conversation/)).
- **The cognitive interview** (Fisher and Geiselman):
  - rebuild the context;
  - report everything;
  - recall in a different order;
  - recall from another perspective.

  It raises the number of correct details recalled with only a small rise in errors, and older adults benefit more ([Memon, Meissner and Fraser 2010](https://repository.royalholloway.ac.uk/items/2f9938b0-c01b-7310-9ec8-e0aee92c9d17/2)).

**Risks the design has to handle:**
- **Planted memories.** Misleading wording and imagined events can plant memories. Imagining an event makes people more confident it happened ([Loftus](https://research.universityofcalifornia.edu/profiles/2011/07/elizabeth-loftus.html), [imagination inflation](https://staff.washington.edu/eloftus/Articles/Imagine.htm)). An AI that writes a plausible detail and asks "is that right?" is doing exactly this.
- **Memory conformity.** 71% of witnesses who discussed an event with a partner later reported details they had only heard from the partner ([Gabbert, Memon and Allan 2003](https://research.gold.ac.uk/id/eprint/10677)). Relatives' accounts must stay separate.
- **Weak follow-ups.** LLM interviewers produced data of comparable quality to human interviewers, but mostly failed the instruction to follow up on surprising or unclear answers ([Wuttke et al. 2024](https://arxiv.org/pdf/2410.01824)). NN/g found AI moderators interrupting and repeating questions ([NN/g](https://www.nngroup.com/articles/ai-interviewers/)).

### The behaviour

**Three loops**, each feeding the others:

1. **Interview.** Sessions with an agenda the ghostwriter sets and explains ("chapter 2 has one finished scene; you've mentioned Jean three times but I can't picture her").
   - One question at a time.
   - Answers are kept as recordings. Exact quotes are marked as verbatim.
   - Each story climbs a **ladder** until it is enough for a scene:
     - what happened;
     - one particular time;
     - who was there;
     - what you saw and heard;
     - what was said;
     - what you felt then;
     - what it means now.
   - "That's all I remember" and "Move on" always end the climb.
2. **Draft.** When a chapter has enough material, the ghostwriter drafts it from those memories only, in the voice agreed in the sample chapter.
   - Where something is missing, it leaves a gap and a margin note instead of guessing.
3. **Revise.** The author reacts in plain speech or comments ("too posh", "Dad wasn't soft").
   - The ghostwriter plays back a numbered plan of what it understood.
   - It proposes per-passage diffs to accept or reject.
   - Standing preferences become style rules (never-words). Gaps become questions for the next session.

**Who holds the pen** is a setting, per book and changeable per chapter:

| Setting | What the AI does |
| --- | --- |
| **Interviewer** | Asks and checks; the author writes every word. |
| **Co-writer** | Drafts scenes the author hands it. |
| **Ghostwriter** (the default for life stories) | Drafts every chapter; the author answers, reacts and approves. |

**Per-chapter stages:**
- Gathering → Ready → Draft → Your notes → Revising → Approved.
- Chapter 1 is the voice sample.
- The book board shows whose turn each chapter is.

**Margin notes come in four kinds:**

| Kind | Example |
| --- | --- |
| **Gap** | "What was the street? I've left it blank rather than guess." |
| **Two versions** | "Session 3 and session 7 disagree. Which is right?" |
| **Thin** | "This tells me you loved the dances. Is there one night you remember?" |
| **Voice** | "You say 'our Peter', so I've kept it." |

There is deliberately no "I imagined this detail, keep it?" note.

**A notebook the author can edit:**
- how they talk;
- what is off limits;
- what it promised to come back to;
- what to ask other people.

**Questioning rules, enforced in the prompt and, where possible, in code:**
1. **Open questions, never supplied details.** "Tell me about Jean", not "Was Jean older than you?"
2. **Ask for one particular time** to turn "we always…" into a scene.
3. **Rebuild the place first** (the room, the season, the radio), then ask what they remember.
4. **Ask for then and now** on every important story.
5. **"I don't remember" is an answer.** The draft says so honestly.
6. **Revisit stories in later sessions**, from a draft, a photo or a date.
7. **Short sessions** (default 20 to 40 minutes), check-ins after hard stories, and pause, skip and off-the-record always available. Off-limits topics are never raised.
8. **Chase the surprising answer.** A vague, surprising or emotional answer gets a follow-up before anything else on the agenda.
9. **Other people's versions stay separate.** Ask the author an open question; never relay a relative's account as fact.
10. **Argue once, then defer**, and note the decision.
11. **Verbatim quotes and signature phrases** survive every revision.

### What it reuses

| Need | Existing code |
| --- | --- |
| Turns that file what was said, each undoable | Thinking partner: `talk()`, `undoTalk()`, `applyTalk()` / `revertTalk()` and the `TalkChange` log (`packages/core/src/engine/ideation.ts`; schema in `packages/core/src/schemas/index.ts`). The "Talk it through" prompt in `muse/prompt.md` already asks one question at a time and records the author's words as theirs. |
| Questions from a draft | Every agent output already has `needs_decision`, and `shared.md` tells agents to put missing facts there instead of inventing them. Margin notes are `needs_decision` grown up: anchored to a quote and offset, with a kind and a status. |
| Revising passages from feedback | The reviser's "Revise flagged lines" job (`packages/agents/src/agents/reviser/prompt.md`). |
| Showing a revision round | Ripple review's diff view and `j`/`k`, `a`/`r`, `⇧↵` keys (`apps/desktop/src/views/ripple.tsx`, `components/diff.tsx`). |
| Feedback that becomes rules | Style sheet never-words and "learned from your edits" (`style/style.yaml`, `views/style-settings.tsx`). |
| Signing off a chapter | Scene `lock` and `Status` (`approved`, `locked`) in the schema. |
| One commit per round, revertible | `store.commit(...)`, as `finish()` in `ideation.ts` does. |

### What is new

- **A `ghostwriter` agent** (`packages/agents/src/agents/ghostwriter/`) with six tasks:
  1. plan a session from the question queue and chapter stages;
  2. interview turn, with explicit probe triggers for vague, surprising or emotional answers;
  3. wrap a session: summary, filed changes, new questions;
  4. draft a chapter, with notes;
  5. find gaps in a draft;
  6. plan a revision from free-form feedback.
- **`sessions/<id>/`:** audio, turns, and what each turn filed.
- **`ghostwriter/notebook.yaml`:** voice observations, off-limits topics, promises, questions for other people.
- **`questions.yaml`:** a queue. Each question has:
  - a target (chapter, scene or person);
  - the technique it uses;
  - why it is asked;
  - a priority;
  - a status (queued, asked, answered, parked, off-limits).
- **A per-chapter `stage` on chapters in `structure.yaml`.** Today stages are global (`STAGES` in `packages/core/src/engine/pipeline.ts`), and the whole book moves through them together.
- **`scenes/<id>/notes.yaml`:** anchored margin notes.
- **Verbatim marks** on quoted spans that revision passes may not change. The line editor already keeps a change only when code confirms it broke nothing; this adds one more check.
- **Checks in code:**
  - a leading-question lint (yes/no questions that introduce a name, place or detail that is not in the author's own words);
  - an off-limits filter on every planned question;
  - the draft-against-sources check from Part 1.

### How to know it works

Extend `quillgon eval` with **simulated interviewees**. Each is a model given a hidden, fixed life story (a few hundred facts) and instructions to answer like a person: vague at first, more specific when asked well. This mirrors the simulated reader. Score each run on:
- **detail per session hour:** hidden facts elicited;
- **leading-question rate:** questions that introduce facts the interviewee never gave;
- **follow-up rate:** probes after answers that were seeded as surprising;
- **invented-fact rate:** draft claims found in neither the transcript nor the hidden life;
- **voice match:** the both-orders judge comparing drafts with the interviewee's transcripts.

## Suggested order

1. **Dictation into the existing app**, novel mode, bursts only:
   - mic permission, offline whisper.cpp or Parakeet, and an OpenAI option;
   - dictionary from characters and locations;
   - light cleanup with the guardrails.

   Small, useful straight away, and it builds the audio plumbing.
2. **Sessions and the interviewing ghostwriter:**
   - `Book.kind` and the memoir `shared.md`;
   - long-form recording with raw, never-changed transcripts in `sessions/`, versioned with git;
   - the interview loop: agendas, the story ladder, probe triggers, pacing and off-limits controls;
   - extraction into timeline, people and places, with reviewable, undoable changes;
   - `questions.yaml` and the notebook;
   - the simulated-interviewee eval, from the start, so interview quality can be measured as it changes.
3. **Drafting with notes:**
   - shape picker and per-chapter stages;
   - a voice sample chapter first;
   - chapter drafts from memories only, with anchored margin notes;
   - the draft-against-sources check.
4. **Revision rounds:**
   - free-form feedback to a numbered plan to per-passage diffs, reusing ripple review;
   - feedback that becomes style rules;
   - verbatim marks;
   - chapter sign-off.
5. **Before sharing:**
   - truth flags and an author's note;
   - living-people review;
   - family and published editions as branches.

## What was built

Steps 1 to 5 of the suggested order are in the code, with these differences and gaps.

| Step | Built | Where |
| --- | --- | --- |
| 1. Dictation | Mic in every prose editor, note and answer box; hold `Alt D`; pause-split 16 kHz recording; OpenAI `gpt-4o-mini-transcribe`, local whisper.cpp or an offline placeholder; a dictionary from the book's names; a scribe agent for tidy-up, with `checkCleanup` keeping the raw words when the tidy-up adds a name or rewrites; Settings → Voice; macOS microphone entitlement | `packages/core/src/dictation.ts`, `packages/server/src/dictation.ts`, `apps/desktop/src/components/dictate.tsx`, `apps/desktop/src/lib/recorder.ts` |
| 2. Sessions | `Book.kind` (novel, life story, memoir) and the life settings; a separate shared prompt for true stories; agendas with reasons; the story ladder; probe triggers; the leading-question and off-limits checks (one retry, then a safe open question); "I don't remember", "Move on", "Off the record" and "This is hard"; filing into people, stories, timeline, questions and notebook as undoable changes; other people's versions kept separate; `quillgon session` | `packages/core/src/engine/interview.ts`, `packages/core/src/life.ts`, `packages/agents/src/agents/ghostwriter/`, `apps/desktop/src/views/sessions.tsx` |
| 2. Eval | Simulated interviewees with hidden facts; `quillgon eval-life` scores facts drawn out, depth, follow-up on surprises, refused, leading and off-limits questions, and unsourced sentences | `evals/lives.yaml`, `packages/core/src/eval-life.ts`, `packages/agents/src/agents/interviewee/` |
| 3. Drafting | Shapes proposed by the ghostwriter (by decade offline); per-chapter stages; Chapter 1 as the voice sample; drafts from the stories only, with `[TK: …]` gaps instead of guesses; margin notes (gap, two versions, thin, voice, no source) anchored in the text; the source check | `packages/core/src/engine/lifebook.ts`, `apps/desktop/src/views/shaping.tsx`, `apps/desktop/src/components/notes-panel.tsx` |
| 4. Revision | Free-form feedback, then a numbered plan, then per-passage changes to accept or reject; one pushback per point, which the author can overrule (recorded in the notebook as settled); book-wide feedback becomes style rules; edits that would change a quote are refused; one commit per round; approval locks the chapter | `lifebook.ts` `revise` / `applyRevision`, `apps/desktop/src/views/revision.tsx` |
| 5. Sharing | Claims with no source, open gaps and notes, people with no consent decision, sensitive stories in the text, unapproved chapters; an author's note written from the author's choices, put at the front of the export | `lifebook.ts` `shareReview` / `authorsNote`, `apps/desktop/src/views/share.tsx` |

Also built: the timeline view (by year and age, shaded gaps, "Ask me about these years"; moving a date carries it into stories and scenes and leaves a note), and the editable ghostwriter's notebook.

**Changed from the plan.** Session audio is kept in the book folder under `audio/` but is **not** committed: recordings are large and personal, and a book repo is easy to push somewhere by accident. The transcripts in `sessions/` are versioned.

**Not built yet:**
- Parakeet and other local models beyond whisper.cpp, and streaming transcription (dictation is transcribed per pause).
- Speaker diarisation. Another speaker is named by hand.
- Family and published editions as branches. The what-if branches work, but there is no edition-specific flow.
- Phone or companion-page interviews, and photos as prompts (see Open questions).
- A live-model run of `eval-life`. Offline runs check the plumbing only.

**Verification.** Unit and integration tests cover the dictation clean-up and guardrails, the life checks, interviews (filing, undo, refusal and retry, off the record, other speakers), drafting, notes, revision, the timeline and the eval. `scripts/e2e-life.ts` (`pnpm e2e:life`) drives the whole workflow in Chromium with a fake microphone, and the novel e2e still passes.

## Open questions

- **Who is speaking?** Should one book allow several narrators? Family members recording their own memories (Meminto does this) means speaker labels, and possibly diarisation; Sortformer comes with transcribe.cpp.
- **Interviewing over the phone.** Many legacy books are recorded with an elderly parent. A companion web page or phone call into the local app breaks the localhost-only model, so it would need a deliberate design.
- **Photos as prompts.** Attach a photo and the biographer asks about it. This needs an image-capable model tier, and images go to the provider.
- **Licences.** Check the Parakeet and Nemotron model licences before bundling a downloader.
- **Encrypting audio at rest.** It is plain files in git today, which suits the user who wants to read them and worries the user who shares a laptop.
