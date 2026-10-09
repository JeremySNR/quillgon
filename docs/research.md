# Research: making Novel Engine better at turning an idea into a novel

October 2026. This combines three research passes (academic work on long-form AI fiction, agent and LLM techniques, and the product landscape with author feedback) and maps each finding onto Novel Engine's architecture.

Caveats:
- Most results are the authors' own figures and have not been replicated.
- Several 2026 papers are preprints.
- Some sources were read through abstracts or summaries rather than in full.

## What the research confirms we already got right

- **The graph comes first and prose is compiled from it.** DOC, the hierarchical-outline successor to Re3, reported +22.5 points on coherence and +21 on interestingness by putting creative effort into detailed outlines rather than into editing prose afterwards ([DOC](https://aclanthology.org/2023.acl-long.190)). Agents' Room, from DeepMind, uses a similar planner/writer split ([ICLR 2025](https://arxiv.org/abs/2410.02603)).
- **The writer gets scoped context.** Accuracy falls as input length grows in every model tested, and a focused history beat a 113k-token one ([Chroma](https://research.trychroma.com/context-rot)). The workflow authors arrive at independently is the same: never feed the model raw earlier chapters; give it the outline plus a compressed record of story state.
- **Knowledge is tracked per character, per scene.** "A character knows something they shouldn't" is the continuity failure authors report most often. NovelCrafter's Codex "progressions" and hobbyist "epistemic QA" pipelines exist because of it.
- **A simulated reader that flags twists it guessed.** Fong & Gui showed that measuring a model's expectations and surprise explains reader engagement well across 30,000 chapters ([arXiv 2412.15239](https://arxiv.org/abs/2412.15239)).
- **Alternatives at each layer.** The research says these are needed, but generating them in a single call isn't enough (see section 1).

## Where the evidence says we should push

### 1. The front end: from a raw idea to a premise worth writing
**Problem.** LLM fiction converges on the same stories:
- 88% of 20,000 generated stories contained stock elements: a character named Elara, a lighthouse ([arXiv 2605.26492](https://arxiv.org/abs/2605.26492)).
- Outputs converge across model families ([Artificial Hivemind, NeurIPS 2025](https://arxiv.org/abs/2510.22954)).
- Raising the temperature or adding negative prompts barely helps ([arXiv 2606.17350](https://arxiv.org/abs/2606.17350)).

Our interviewer asks five questions and goes straight to intent, so the premise is never stretched.

**Do:**
- **Ask before proposing.** Draw the ideas out of the author first, and offer suggestions only to fill gaps (OpenAI's own writing guidance takes the same position).
- **Diverge from clichés first.** The agent lists the genre's stock moves, then deliberately branches away from them.
- **Verbalized sampling with personas.** Ask for k candidates with their estimated probabilities, generated through different author personas (noir, literary minimalist, comic), and sample from the tail. This gave 1.6–2.1× more diversity and +25.7% human ratings in creative writing ([arXiv 2510.01171](https://arxiv.org/abs/2510.01171)). Diverse personas also restored plot diversity in a study with human writers.
- **Remove near-duplicates by embedding distance**, not by generating more. In one study only about 200 of 4,000 generated ideas were unique ([Si et al.](https://arxiv.org/abs/2409.04109)).
- **Keep a keep/discard pile.** Loglines, what-ifs and character seeds the author can pin or reject.
- **Expand in Snowflake steps:** one-line logline → one paragraph → one-page synopsis → character sheets (want, need, wound, lie) → plot points. Each step is a cheap gate before the expensive ones.
- **Build a story bible early:** world rules, places, factions and a hard-rules list, each linked to the graph.

**Cost:** low. Brainstorming tokens are small next to prose.

### 2. Judge plans before writing a word
Changing a plan costs almost nothing compared with rewriting prose, so this is where to put quality control.

- **Sameness test** ([Echoes in AI, PNAS 2025](https://arxiv.org/abs/2501.00273)). For each chosen beat or twist, sample 5–10 independent alternatives. If most of them contain the same element, the beat is predictable; ask for something else. Apply this especially to the "unexpected" and "wildcard" structures.
- **A narrative-shape critic** that runs on structures and beat cards. Two studies found the most reliable signs of AI fiction are structural rather than stylistic:
  - StoryScope ([arXiv 2604.03136](https://arxiv.org/abs/2604.03136)) separates AI from human stories with 93% accuracy using narrative features alone. AI stories over-explain their themes, run on a single plot track, lack moral ambiguity, have simple time structure and flat escalation, and Claude stood out for flat escalation.
  - CASPER (ACL 2026) found AI characters fall back on archetypes and their arcs resolve too neatly.

  A humaniser cannot fix any of these; they have to be caught in the plan.
- **An outline reader.** Run the first reader on synopses and beat cards, not only on finished prose. A twist it guesses from the outline is far cheaper to fix there than in chapter 20.
- **Judge twists on both sides:** the reader should not predict the twist beforehand, and should find it fair in hindsight ([WNU 2025](https://preview.aclanthology.org/setup/2025.wnu-1.7)). Optimising only for "not predicted" rewards randomness.
- **Suspense by design** ([Xie & Riedl](https://arxiv.org/abs/2402.17119)). For tense chapters, list the protagonist's options and build the conditions under which each one fails. Offer this as one of the two beat alternatives.

### 3. An obligations ledger (setups and payoffs)
This is the strongest structural idea in the papers ([NstAgent](https://arxiv.org/abs/2609.35759), [codified foreshadowing–payoff](https://arxiv.org/abs/2601.07033)). The most-reported "the middle collapses" failures are forgotten foreshadowing and clues that are never used.

Add `obligations/` to the graph. Each entry is a setup → trigger → payoff with a planned payoff chapter (a clue, a promise, a Chekhov's gun, a question raised).
- **Planner:** creates obligations.
- **Writer:** receives only the obligations due in the scene it is writing.
- **Extractor:** opens and closes them as prose lands.
- **Continuity checker:** flags obligations that are never paid off, or paid off before they are set up.
- **Ripples:** follow these edges.
- **Reveal schedule:** this is what the reader's "guessed early" check is measured against.

**Cost:** low to medium. It reuses the thread, extractor and impact machinery.

### 4. Style: easy to direct, enforced on every word
Authors' top request to Sudowrite is several labelled style samples; Sudowrite's limit is about 1,000 words in one box.

Chakrabarty et al. found experts preferred human prose about 83% of the time when the AI was only prompted. After fine-tuning on an author's own books the AI was preferred instead, because fine-tuning removed the AI tics ([arXiv 2510.13939](https://arxiv.org/abs/2510.13939)).

We can't fine-tune Claude, so we get as close as we can mechanically:
- **`style.yaml` with dials** that each map to a check: spelling variant, punctuation, dialogue tags, sentence-length range, dialogue share, adverb and filter-word rates, register, and always/never word lists.
- **A fingerprint measured from the author's own pages**, with several labelled samples (narration, dialogue, action) and a voice per point-of-view character.
- **Choose by ear.** Four versions of the same paragraph; the author picks the closest, and the dials are inferred from the picks.
- **Enforcement in layers:**
  - Mechanical rules on every word, deterministic and guaranteed.
  - Statistical checks on every paragraph.
  - Pairwise judgement against the author's samples.
- **Repair spans, never whole scenes.** Replace the whole-scene humaniser with a detect-and-edit pass based on LAMP's seven categories of AI habit ([arXiv 2409.14509](https://arxiv.org/abs/2409.14509)). A repair is kept only if a judge that hasn't seen earlier passes prefers it to the original ("no change" can win). At most two passes, with a voice-drift guard.
- **Learn from the author's own edits.** Mine the diffs and propose new rules ("you always change 'gaze' to 'look'").
- **A tic profiler for the whole book.** The Hachette title *Shy Girl* was pulled after readers counted "sharp" 159 times and "edge" 84 times. Track phrase frequency against genre baselines, lists of three, "not X — Y" constructions, and a slop rate per chapter, alongside the per-scene banned-pattern list.

### 5. Measure tension, not just engagement
- **Predicted continuations.** After each scene the reader writes 3–5 continuations it expects. How much they disagree is the **uncertainty**; how far the real next scene lands from them is the **surprise** ([Fong & Gui](https://arxiv.org/abs/2412.15239), [Wilmot & Keller](https://arxiv.org/abs/2004.14905)). Chart both across the book and flag flat stretches and spoiled reveals.
- **A threads × chapters grid** (like Dabble's Plot Grid). It shows escalation per thread, gaps in the middle, and relationships that move too fast (authors report the love interest arriving "within 3 pages").
- **Reader panels with care.** A panel of persona readers was *worse* than a plain reader at predicting a real audience ([arXiv 2609.25010](https://arxiv.org/abs/2609.25010)). Use 3–5 genre-taste personas for diagnosis only, always with a plain reader alongside as a control.

### 6. Characters as agents, where it pays
Several systems drive the plot with character agents: BookWorld ([ACL 2025](https://arxiv.org/abs/2504.14538)), MAGNET/ATLAS ([preprint](https://arxiv.org/abs/2607.00918), with 41% fewer editor notes and 50% fewer hallucinations at 100 pages), and Yu et al. (role-play first, then rewrite to the plan).

We already store exactly what each character knows at each scene, which is the input these agents need.
- **Use it only where it matters:** confrontation and decision scenes. Two to four Sonnet agents role-play, each limited to its own character's knowledge. The transcript is raw material for the writer, not prose.
- **Cost:** about 3–5× on those scenes, roughly +20–40% for the whole book if limited to about 15% of scenes.
- **Character interviews.** Let the author interrogate a character as of a given scene ("What do you think happened to your father?"). NovelCrafter users use this to catch inconsistent traits.

### 7. Continuity that shows its evidence
- **Quote every flag.** Require an exact quote and a subtype from the 19-subtype error taxonomy for every flag ([ConStory, ACL 2026](https://arxiv.org/abs/2603.05890)). Errors cluster in factual and timeline details and in the middle chapters, so check those more densely.
- **Re-plan as the book is written** ([DOME](https://arxiv.org/abs/2412.13575)). After each chapter is extracted, the planner proposes updates to the beats that follow, through the existing ripple review.
- **Choose the writer's context by graph links.** Follow links from the current scene's events and open obligations instead of using the most recent scenes ([StoryWriter](https://arxiv.org/abs/2506.16445)). Add NovelAI-style lore that is pulled in only when it's relevant.

### 8. Graph views that explain themselves
Not a global force-directed graph: at novel length it loses story order and turns into a tangle. Instead:
- **Ripple blast radius:** the change at the centre, affected scenes in rings by hop distance, and a reason on every edge.
- **Local graph in the scene editor.**
- **Fact-flow view:** where a fact is revealed, who learns it, and where each person mentions it.
- **Relationships over time,** with a slider.

Scenes are pinned to story order on the horizontal axis.

### 9. Running it, and what it costs
- **Bulk passes on the Batch API.** Extraction, continuity, reader, n-gram statistics and judging go through the Batch API at 50% off, with a 1-hour cached manuscript prefix for book-wide passes. Cache reads cost about 0.1× ([docs](https://platform.claude.com/docs/en/build-with-claude/batch-processing)).
- **Overnight drafting.** Draft scenes in parallel wherever they don't depend on each other, with a JSON checkpoint per scene and approval gates after the plan, after act 1, and before ripple rewrites. Run the overnight orchestrator on the Agent SDK or Managed Agents, and keep per-scene calls as plain API or batch requests.
- **A model per stage, with costs shown per chapter.** Sudowrite users' biggest complaint is unpredictable credit use ("40,000 credits for one chapter").

### 10. Trust, ownership and publishing
- **A provenance ledger.** Git already knows who wrote each line; tag passages as human-written, AI-drafted or AI-edited. This answers two things:
  - Amazon KDP requires disclosure of AI-*generated* text, even after heavy editing, but not of AI-*assisted* work.
  - Copyright needs a human-authorship statement: the Supreme Court declined to hear *Thaler* in March 2026.

  Produce a disclosure report from the ledger.
- **Writer agency** (Dramatron and Wordcraft user studies). Over half of Dramatron's professional users felt they didn't own its output, and strict top-down order didn't suit everyone.
  - Default to offering choices at the card level.
  - Let authors enter at any level.
  - Add a **discovery-writer path**: write freely, and the app rebuilds cards, threads and structure from the prose, then checks them against the intent.
- **Structure templates as overlays.** Show how each structure alternative maps to Save the Cat, Seven-Point or Story Grid, and flag missing beats. An overlay, not an engine.
- **A series bible** shared across books.

### 11. Evaluate before tuning
Off-the-shelf LLM judges agreed with humans only 73% of the time on fiction ([LitBench](https://arxiv.org/abs/2507.00769)) and did not agree with experts on creativity ([TTCW](https://arxiv.org/abs/2309.14556)). Prompt changes need a harness:
- **A frozen eval set:** about 20 premises × key scenes (opening, twist, climax).
- **Automatic metrics:** slop score, name and n-gram overlap across books, embedding diversity, voice distance, continuity error count, twist-prediction rate.
- **Pairwise Elo,** with every comparison run in both orders.
- **Human spot checks** on about 5% of judgments.
- **Author decisions as data.** Every accept or reject in ripple review becomes preference data for calibrating the judge.

## Recommended order

| # | Change | Why first | Cost |
|---|---|---|---|
| 1 | Divergent ideation front end (§1) | The idea → premise stage is where the book's distinctiveness is decided, and it's cheap | Low |
| 2 | Obligations ledger (§3) | Fixes the most common long-book failure; reuses the existing graph | Low–med |
| 3 | Style system with span repair and learning from edits (§4) | Directly answers "stick to my style"; removes the riskiest current pass (whole-scene humaniser) | Med |
| 4 | Plan-level critics: sameness test, narrative shape, outline reader, two-sided twists (§2) | Catches structural AI tells where they're cheap to fix | Low–med |
| 5 | Eval harness (§11) | Needed before tuning any prompt with a live model | Med |
| 6 | Tension curve and threads × chapters grid (§5) | Makes pacing visible | Low–med |
| 7 | Batch API and caching (§9) | Halves the cost of bulk passes | Low |
| 8 | Graph views (§8) and quote-backed continuity (§7) | Makes ripples and errors understandable | Med |
| 9 | Character agents and interviews (§6) | Sharper motives and dialogue where it matters | Med–high |
| 10 | Provenance ledger and disclosure report (§10) | Publishing readiness | Low |
| 11 | Overnight orchestrator, rolling re-plan, discovery path, series bible | Scale and flexibility once quality is proven | Med–high |

## Status

| # | Change | Status |
|---|---|---|
| 1 | Divergent ideation front end | ✅ Built: the Idea step and `novel spark` (personas, verbalized sampling, tail first, embedding dedupe, cliché flags, Snowflake expansion, want/need/wound/lie/arc) |
| 2 | Obligations ledger | ✅ Built: `obligations/`, `sets_up`/`pays_off` on cards, writer told plant/pay/keep open, extraction checks it landed, ledger view, `novel ledger`, obligation changes ripple |
| 3 | Style system | ✅ Built: `style/style.yaml` dials, code-checked spans, deterministic fixes, span-level line edits gated by code and both-ways judging, live underlines in the editor, fingerprinting samples, rules learned from edits, `novel style` |
| 4 | Plan-level critics | ✅ Built: structural critic (book and per structure), predictability test per scene, outline reader, two-sided twist verdicts, `novel critique` |
| 7 | Caching | ✅ Prompt caching on the system prompt with cache-aware cost. Batch API not yet |
| 8 | Graph views | ◐ Ripple blast-radius map and the ledger chart built; scene local graph and fact flow not yet |
| 5, 6, 9–11 | Eval harness, tension curve, character agents, provenance, orchestration | Not yet |
