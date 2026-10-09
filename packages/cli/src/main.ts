#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  analyseImpact,
  CharacterBio,
  CharacterVoice,
  Engine,
  GraphStore,
  initProject,
  loadProject,
  mechanicalContinuity,
  partitionImpacts,
  paths,
  PlotPoint,
  Ripple,
  SceneCard,
  sceneOrder,
  StateSnapshot,
  Structure,
  Thread,
  costSummary,
  checkStyle,
  fingerprint,
  obligationIssues,
  readEdits,
  suggestRules,
  suggestSheet,
  type Change,
  type Impact,
  type RippleItem,
} from '@quillgon/core';
import { createSuite, suiteMode } from '@quillgon/agents';
import { diffLines, diffWords } from 'diff';

// ------------------------------------------------------------------ args & output

const argv = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
const args: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('-')) flags[k] = argv[++i];
    else flags[k] = true;
  } else args.push(a);
}
const cmd = args.shift() ?? 'help';
const yes = !!flags.yes || !process.stdin.isTTY;

process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const tty = process.stdout.isTTY;
const c = (code: number) => (s: string | number) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = c(1);
const dim = c(2);
const red = c(31);
const green = c(32);
const yellow = c(33);
const cyan = c(36);
const say = (...s: unknown[]) => console.log(...s);

const rl = () => createInterface({ input: process.stdin, output: process.stdout });
async function ask(q: string, def = ''): Promise<string> {
  if (yes) return def;
  const r = rl();
  const a = (await r.question(`${q}${def ? dim(` [${def}]`) : ''} `)).trim();
  r.close();
  return a || def;
}
async function confirm(q: string, def = true): Promise<boolean> {
  const a = (await ask(`${q} ${dim(def ? '(Y/n)' : '(y/N)')}`, def ? 'y' : 'n')).toLowerCase();
  return a.startsWith('y');
}

function projectDir(): string {
  const d = (flags.dir as string) ?? process.env.QUILLGON_PROJECT ?? '.';
  if (!fs.existsSync(path.join(d, paths.book))) {
    console.error(red(`No book.yaml in ${path.resolve(d)}. Run \`quillgon init <dir>\` or pass --dir.`));
    process.exit(1);
  }
  return d;
}

function openEngine(): Engine {
  const store = GraphStore.open(projectDir());
  const agents = createSuite(store, { record: flags.record as string | undefined, replay: flags.replay as string | undefined });
  if (suiteMode(store) === 'offline' && !flags.quiet) say(dim('Offline models: placeholder output, no API calls.'));
  return new Engine(store, agents);
}

const progress = (stage: string, detail?: string) => say(dim(`  · ${detail ?? stage}`));

function showImpact(impacts: Impact[], hopLimit: number) {
  const { conflicts, proposals, listed } = partitionImpacts(impacts, hopLimit);
  if (!impacts.length) return say(green('  No other scene is affected.'));
  for (const i of conflicts) say(`  ${red('■ conflict')} ${bold(i.scene)} hop ${i.hop} ${dim(`(${i.conflict!.lock} lock)`)}\n      ${i.reasons.join('\n      ')}`);
  for (const i of proposals) say(`  ${yellow('●')} ${bold(i.scene)} hop ${i.hop} ${dim(`${Math.round(i.confidence * 100)}%`)}\n      ${i.reasons.join('\n      ')}`);
  for (const i of listed) say(`  ${dim(`○ ${i.scene} hop ${i.hop} — ${i.reasons.join('; ')}`)}`);
}

function printDiff(a: string, b: string, words = false) {
  const parts = words ? diffWords(a, b) : diffLines(a, b);
  let out = '';
  for (const p of parts) out += p.added ? green(words ? `[+${p.value}]` : prefix(p.value, '+ ')) : p.removed ? red(words ? `[-${p.value}]` : prefix(p.value, '- ')) : words ? p.value : dim(prefix(p.value, '  '));
  say(out);
}
const prefix = (s: string, p: string) => s.replace(/\n$/, '').split('\n').map((l) => p + l).join('\n') + '\n';

// ------------------------------------------------------------------ commands

const commands: Record<string, { help: string; run: () => Promise<void> | void }> = {
  help: {
    help: 'Show this help',
    run() {
      say(bold('quillgon') + ' — the story graph is the source; prose is compiled output.\n');
      for (const [k, v] of Object.entries(commands)) say(`  ${cyan(k.padEnd(10))} ${v.help}`);
      say(`\nOptions: --dir <book>  --yes (accept defaults)  --record <dir> / --replay <dir> (model fixtures)`);
    },
  },

  init: {
    help: 'init <dir> [--title T] [--words 12000] [--offline]   Create a new book',
    async run() {
      const dir = args[0] ?? (await ask('Folder for the new book:', 'my-book'));
      const title = (flags.title as string) ?? (await ask('Title:', path.basename(dir)));
      const store = await initProject(dir, { title, target_words: Number(flags.words) || 12000, offline: !!flags.offline });
      say(green(`Created ${store.dir}`));
      say(`Next: ${cyan(`quillgon spark --dir ${dir}`)} to develop an idea, or ${cyan(`quillgon intent --dir ${dir}`)} if you have a premise.`);
      store.close();
    },
  },

  validate: {
    help: 'validate [dir]   Check every file against its schema and every reference',
    run() {
      const dir = args[0] ?? projectDir();
      const { project, issues } = loadProject(dir);
      const errors = issues.filter((i) => i.severity === 'error');
      for (const i of issues) say(`${i.severity === 'error' ? red('error') : yellow('warn ')} ${i.file}${i.path ? dim(` › ${i.path}`) : ''}: ${i.message}`);
      say(errors.length ? red(`\n${errors.length} error(s)`) : green(`✓ ${project.book.title}: ${project.scenes.size} scenes, ${project.characters.size} characters, ${project.threads.size} threads, ${project.plotPoints.size} plot points`));
      if (errors.length) process.exitCode = 1;
    },
  },

  index: {
    help: 'index [--snapshot]   Rebuild the SQLite index from files',
    run() {
      const store = GraphStore.open(projectDir());
      const snap = store.index!.snapshot();
      if (flags.snapshot) say(JSON.stringify(snap, null, 2));
      else say(green(`✓ index rebuilt: ${snap.entities.length} entities, ${snap.refs.length} refs, ${snap.facts.length} facts, ${snap.embedded} scene embeddings`));
      store.close();
    },
  },

  status: {
    help: 'status   Word count, scenes by status and sync state, health',
    run() {
      const store = GraphStore.open(projectDir());
      const p = store.project;
      const sync = store.sync();
      const words = [...p.scenes.values()].reduce((n, s) => n + (s.prose?.meta.word_count ?? 0), 0);
      say(`${bold(p.book.title)}  ${dim(p.book.genre)}`);
      say(`Stage: ${cyan(p.book.stage)}   Words: ${words.toLocaleString('en')} / ${p.book.target_words.toLocaleString('en')}`);
      const badge = { in_sync: green('in sync'), card_ahead: yellow('card ahead'), prose_ahead: yellow('prose ahead'), conflict: red('conflict'), unwritten: dim('unwritten') };
      for (const a of p.structure.acts) {
        say(`\n${bold(a.title || a.id)}`);
        for (const ch of a.chapters) {
          say(`  ${ch.title || ch.id}`);
          for (const s of ch.scenes) {
            const sc = p.scenes.get(s)!;
            say(`    ${s.padEnd(5)} ${sc.card.title.padEnd(28)} ${dim(sc.card.pov.padEnd(8))} ${sc.card.status.padEnd(9)} ${sc.card.lock !== 'none' ? '🔒 ' : '   '}${badge[sync.get(s)!.state]}`);
          }
        }
      }
      const h = p.book.health;
      say(`\nContinuity issues: ${h.open_continuity_issues}   Voice warnings: ${h.voice_warnings}   Last reader run: ${h.last_reader_run ?? 'never'}`);
      store.close();
    },
  },

  spark: {
    help: 'spark ["seed idea"] [--genre G]   Idea → premise: diverge, keep/discard, expand to logline, synopsis, cast',
    async run() {
      const e = openEngine();
      const I = e.ideation;
      const seed = args[0] ?? (I.board.seed || (await ask('A seed: a line, an image, a what-if:\n>')));
      I.start(seed, (flags.genre as string) ?? I.board.genre);
      for (let round = 1; ; round++) {
        say(dim(`\nAsking ${round === 1 ? 'four' : 'four more'} different minds…`));
        const b = await I.diverge();
        const fresh = b.pile.filter((i) => i.status === 'new');
        if (b.cliches.length && round === 1) say(dim(`Clichés to steer away from: ${b.cliches.slice(0, 8).join('; ')}`));
        for (const i of fresh) {
          say(`\n${cyan(i.kind)} ${dim(`${Math.round(i.probability * 100)}% typical · ${i.persona}`)}${i.near_cliche ? yellow(`  near “${i.near_cliche}”`) : ''}\n  ${i.text}`);
          const a = (await ask('[k]eep, [d]iscard, [s]kip?', i.near_cliche ? 's' : 'k')).toLowerCase();
          if (a.startsWith('k')) I.mark(i.id, 'kept');
          else if (a.startsWith('d')) I.mark(i.id, 'discarded');
        }
        const own = await ask('\nAdd an idea of your own (blank to go on):');
        if (own) I.addOwn(own);
        if (yes || !(await confirm('Another round?', false))) break;
      }
      for (const step of ['logline', 'paragraph', 'synopsis'] as const) {
        say(dim(`\nDrafting ${step} options…`));
        const b = await I.expand(step);
        const options = b[`${step}_options`];
        options.forEach((o, i) => say(`\n${cyan(`[${i}]`)} ${o}`));
        const pick = Number(await ask(`Pick a ${step}:`, '0'));
        I.choose(step, options[pick] ?? options[0]);
      }
      say(dim('\nCasting…'));
      const b = await I.expand('cast');
      for (const c of b.cast) say(`  ${bold(c.name)} ${dim(c.role)}  wants ${c.want}; needs ${c.need}`);
      if (await confirm('Use this premise and cast?')) {
        await I.finish();
        say(green('✓ Premise written to intent.md.') + ` Next: ${cyan('quillgon intent')}`);
      }
    },
  },

  ledger: {
    help: 'ledger   Setups and payoffs: every clue, promise and question, and what is unpaid',
    run() {
      const p = loadProject(projectDir()).project;
      const order = sceneOrder(p);
      const os = [...p.obligations.values()].sort((a, b) => order.indexOf(a.setup_scene ?? '') - order.indexOf(b.setup_scene ?? ''));
      for (const o of os) say(`  ${(o.status === 'paid' ? green : o.status === 'dropped' ? dim : yellow)(o.status.padEnd(7))} ${dim(o.kind.padEnd(13))} ${(o.setup_scene ?? '—').padEnd(5)} → ${(o.payoff_scene ?? '—').padEnd(5)} ${o.description}`);
      if (!os.length) say(dim('  The ledger is empty. Cards add to it as they are planned.'));
      const issues = obligationIssues(p);
      for (const i of issues) say(`${i.severity === 'high' ? red('●') : yellow('●')} ${i.scene} ${i.message}`);
      if (issues.length) process.exitCode = 1;
    },
  },

  style: {
    help: 'style [check|learn|fit] [--scene s01]   Check prose against style.yaml; learn rules from your edits; fit the dials to your samples',
    run() {
      const store = GraphStore.open(projectDir());
      const p = store.project;
      const sub = args[0] ?? 'check';
      if (sub === 'fit') {
        const fp = fingerprint(p.style.samples);
        say(bold('Your samples') + dim(` (${fp.words} words)`));
        say(`  sentences ${fp.sentence_mean} ± ${fp.sentence_sd} words, dialogue ${Math.round(fp.dialogue_share * 100)}%, adverbs ${fp.adverbs_per_1000}/1k, em dashes ${fp.em_dashes_per_1000}/1k, ${fp.quotes} quotes, ${fp.spelling} spelling`);
        const next = suggestSheet(fp, p.style.sheet);
        say(`\n${bold('Suggested style.yaml')}\n${YAML.stringify(next)}`);
        if (flags.write) store.saveStyleSheet(next), say(green('✓ Written to style/style.yaml'));
        else say(dim('Pass --write to save it.'));
      } else if (sub === 'learn') {
        const edits = readEdits(store);
        const s = suggestRules(edits, p.style.sheet);
        say(dim(`${edits.length} hand edit(s) recorded.`));
        for (const x of s) say(`  ${cyan('+')} ${x.title} ${dim(`(${x.evidence})`)}`);
        if (!s.length) say(dim('  No repeated patterns yet.'));
      } else {
        let enforced = 0;
        for (const id of flags.scene ? [flags.scene as string] : sceneOrder(p)) {
          const prose = p.scenes.get(id)?.prose?.body;
          if (!prose) continue;
          const r = checkStyle(prose, p.style.sheet, { book: p.book, banned: p.style.banned });
          enforced += r.enforced;
          say(`${id.padEnd(5)} ${r.enforced ? red(`${r.enforced} enforced`) : green('clean')}  ${dim(`${r.guided} guided · ${r.stats.sentence_mean} words/sentence`)}`);
          if (flags.scene || flags.verbose) for (const v of r.violations.slice(0, 40)) say(`    ${v.kind === 'enforced' ? red('●') : yellow('○')} ${v.message}${v.text ? dim(`  “${v.text.slice(0, 50)}”`) : ''}`);
        }
        if (enforced) process.exitCode = 1;
      }
      store.close();
    },
  },

  critique: {
    help: 'critique [--scene s05]   Judge the plan before prose: structural tells, or how predictable one scene is',
    async run() {
      const e = openEngine();
      if (flags.scene) {
        const r = await e.predictability(flags.scene as string);
        say(`${bold(r.scene)} ${r.verdict === 'predictable' ? red(r.verdict) : r.verdict === 'expected' ? yellow(r.verdict) : green(r.verdict)} ${dim(`(${Math.round(r.score * 100)}% of the model's own guesses land on your turn)`)}`);
        for (const s of r.samples) say(`  ${s.similarity >= 0.3 ? yellow('≈') : dim('·')} ${s.text} ${dim(`p=${s.probability} sim=${s.similarity}`)}`);
        return;
      }
      const r = await e.critique();
      for (const f of [...r.mechanical, ...r.findings]) say(`${f.severity === 'high' ? red('●') : yellow('●')} ${bold(f.kind)} ${dim(f.where)}\n    ${f.evidence}\n    ${cyan('→')} ${f.suggestion}`);
      for (const s of r.strengths) say(green(`  + ${s}`));
      say(dim('\nWritten to reports/critique-latest.json'));
    },
  },

  intent: {
    help: 'intent   Interview: answer a few questions, approve the intent',
    async run() {
      const e = openEngine();
      const premise = (flags.premise as string) ?? (e.store.project.intent.premise || (await ask('Your premise, in a paragraph:\n>')));
      say(dim('Thinking about what to ask…'));
      const q = await e.pipeline.interview(premise);
      const answers: { question: string; answer: string }[] = [];
      for (const question of q.questions) answers.push({ question, answer: await ask(`\n${bold(question)}\n>`) });
      const r = q.intent ? q : await e.pipeline.interview(premise, answers);
      say(`\n${bold('Intent')}\n${YAML.stringify(r.intent)}`);
      if (await confirm('Approve this intent?')) {
        await e.pipeline.approveIntent(r.intent!);
        say(green('✓ Intent approved.') + ` Next: ${cyan('quillgon plan')}`);
      }
    },
  },

  plan: {
    help: 'plan [--pick N]   Plot points (pin, propose, accept) then three structure alternatives',
    async run() {
      const e = openEngine();
      const pl = e.pipeline;
      const p = e.store.project;
      if (['idea', 'intent', 'plot-points'].includes(p.book.stage)) {
        say(bold('Plot points'));
        while (!yes) {
          const d = await ask('Pin an event that must happen (blank to continue):');
          if (!d) break;
          const act = Number(await ask('  Which act?', '1'));
          const pp = pl.pinPlotPoint({ description: d, position: { act } });
          say(green(`  pinned ${pp.id}`));
        }
        say(dim('Proposing turning points…'));
        const { created, needs_decision } = await pl.proposePlotPoints();
        for (const id of created) {
          const pp = e.store.project.plotPoints.get(id)!;
          say(`\n${bold(pp.title || pp.id)} ${dim(`act ${pp.position.act ?? '?'}`)}\n${pp.description}`);
          const a = (await ask('[a]ccept, [r]eject, [e]dit?', 'a')).toLowerCase();
          if (a.startsWith('r')) pl.rejectPlotPoint(id);
          else if (a.startsWith('e')) pl.acceptPlotPoint(id, { description: await ask('  New description:', pp.description) });
          else pl.acceptPlotPoint(id);
        }
        for (const n of needs_decision) say(yellow(`  ? ${n}`));
        await pl.finishPlotPoints();
      }
      if (e.store.book.stage === 'structure') {
        say(bold('\nStructure') + dim(' — three alternatives'));
        let alts = await pl.proposeStructures();
        for (;;) {
          alts.alternatives.forEach((a, i) => {
            say(`\n${cyan(`[${i}]`)} ${bold(a.label)} ${dim(a.kind)}\n${a.rationale}`);
            for (const act of a.acts) say(`    ${act.title}: ${act.chapters.map((c) => c.title).join(' · ')}`);
          });
          const pick = (flags.pick as string) ?? (await ask('\nPick one (number), or [m]ore:', '0'));
          if (pick.startsWith('m')) {
            alts = await pl.proposeStructures({ more: true });
            continue;
          }
          const alt = await pl.pickStructure(Number(pick));
          say(green(`✓ Structure: ${alt.label}.`) + ` Next: ${cyan('quillgon cards all')}`);
          break;
        }
      }
    },
  },

  cards: {
    help: 'cards <chapter|all> [--default]   Two beat sequences per chapter; pick one',
    async run() {
      const e = openEngine();
      const pl = e.pipeline;
      const target = args[0] ?? 'all';
      if (flags.default) {
        const ids = await pl.defaultCards(progress);
        return say(green(`✓ ${ids.length} scene cards (first alternative for every remaining chapter)`));
      }
      const chapters = target === 'all' ? pl.chapters().filter((c) => !c.scenes.length) : pl.chapters().filter((c) => c.id === target);
      for (const ch of chapters) {
        say(`\n${bold(ch.title || ch.id)} ${dim(ch.summary)}`);
        const out = await pl.proposeCards(ch.id);
        out.alternatives.forEach((a, i) => {
          say(`\n${cyan(`[${i}]`)} ${bold(a.label)} ${dim(a.kind)} — ${a.rationale}`);
          for (const card of a.cards) say(`    ${card.id} ${bold(card.title)} ${dim(`(${card.pov} @ ${card.location})`)}\n      ${card.beats.join(' → ')}`);
        });
        const pick = (await ask('Pick (number), or [d]efault for all remaining:', '0')).toLowerCase();
        if (pick.startsWith('d')) {
          await pl.pickCards(ch.id, 0);
          await pl.defaultCards(progress);
          break;
        }
        await pl.pickCards(ch.id, Number(pick));
      }
      say(green('✓ Cards written.') + ` Next: ${cyan('quillgon write all')}`);
    },
  },

  write: {
    help: 'write <scene|chapter|all>   Write prose (writer → voice → banned → humaniser → extraction)',
    async run() {
      const e = openEngine();
      const t = args[0] ?? 'all';
      const pl = e.pipeline;
      const report = (r: Awaited<ReturnType<typeof pl.writeScene>>) => {
        say(`${green('✓')} ${r.scene} ${r.words} words${r.style?.voiceFlags.length ? `, ${r.style.voiceFlags.length} voice fixes` : ''}`);
        for (const c of r.extraction.contradictions) say(red(`   ⚑ ${c.field}: card says ${c.card_says}; prose says ${c.prose_says}`));
        for (const n of r.needs_decision) say(yellow(`   ? ${n}`));
      };
      if (e.store.project.scenes.has(t)) return report(await pl.writeScene(t, { progress }));
      const chapters = t === 'all' ? pl.chapters() : pl.chapters().filter((c) => c.id === t);
      if (!chapters.length) throw new Error(`no scene or chapter "${t}"`);
      for (const ch of chapters) for (const r of await pl.writeChapter(ch.id, { progress })) report(r);
    },
  },

  sync: {
    help: 'sync   Reconciliation state of every scene',
    run() {
      const store = GraphStore.open(projectDir(), { noIndex: true });
      for (const [id, s] of store.sync()) say(`${id.padEnd(6)} ${s.state === 'in_sync' ? green(s.state) : s.state === 'conflict' ? red(s.state) : yellow(s.state)}`);
    },
  },

  extract: {
    help: 'extract <scene>   Read an edited scene back into the graph ("your edit changed these facts")',
    async run() {
      const e = openEngine();
      const id = args[0];
      const r = await e.pipeline.reconcileProseEdit(id);
      if (r.presentationOnly) return say(green('✓ Wording only: nothing in the graph changed.'));
      say(bold('Your edit changed these facts:'));
      for (const f of r.extraction.diff.removed) say(red(`  - ${f.subject} ${f.predicate} ${f.object}`));
      for (const f of r.extraction.diff.added) say(green(`  + ${f.subject} ${f.predicate} ${f.object}`));
      if (!(await confirm('Update the card to match and ripple the change through the book?'))) return;
      const change = e.pipeline.acceptProseFacts(id);
      await rippleLoop(e, await e.startRipple(change));
    },
  },

  impact: {
    help: 'impact <entity>   Preview what a change would touch (no model calls)',
    async run() {
      const e = openEngine();
      const change = await editEntity(e, args[0], false);
      if (!change) return say(dim('No change.'));
      const r = analyseImpact(e.store.project, change, e.store.index);
      say(bold(r.description));
      showImpact(r.impacts, e.store.book.ripple.hop_limit);
      e.store.reload(); // discard
    },
  },

  change: {
    help: 'change <entity>   Edit in $EDITOR, review impact, ripple it through (scene:s04, state:mara@s04, thread:x, plot:x, character:x, structure)',
    async run() {
      const e = openEngine();
      const change = await editEntity(e, args[0], true);
      if (!change) return say(dim('No change.'));
      const r = analyseImpact(e.store.project, change, e.store.index);
      say(bold(r.description));
      showImpact(r.impacts, e.store.book.ripple.hop_limit);
      if (!r.impacts.length) return void (await e.store.commit(`Edit: ${r.description}`));
      if (!(await confirm('\nStart the ripple?'))) return void (await e.store.commit(`Edit: ${r.description}`));
      await rippleLoop(e, await e.startRipple(change));
    },
  },

  ripple: {
    help: 'ripple [revert|abandon|list]   Continue the ripple in progress',
    async run() {
      const e = openEngine();
      if (args[0] === 'list') {
        for (const r of Ripple.list(e.store)) say(`${r.id}  ${r.state.padEnd(10)} ${r.description}`);
        return;
      }
      const r = e.ripple(flags.id as string | undefined);
      if (!r) return say(dim('No ripple in progress.'));
      if (args[0] === 'revert') return void (await r.revert(), say(green('✓ Reverted.')));
      if (args[0] === 'abandon') return void (r.abandon(), say('Abandoned.'));
      await rippleLoop(e, r);
    },
  },

  read: {
    help: 'read [--act act-1] [--outline]   Simulated first reader: engagement, confusion, predictions, twist fairness',
    async run() {
      const e = openEngine();
      const r = await e.reader({ act: flags.act as string | undefined, mode: flags.outline ? 'outline' : 'prose', progress });
      say(`\n${bold('Engagement')}  mean ${r.mean_engagement}/5`);
      for (const x of r.engagement) say(`  ${x.scene.padEnd(5)} ${'█'.repeat(x.engagement * 2).padEnd(10)} ${dim(x.title)}`);
      say(`\n${bold('Predictions that landed early')}`);
      for (const p of r.predictions) say(`  ${yellow(p.guessed_in)} → revealed ${p.revealed_in} (${p.early_by} early): "${p.prediction}"`);
      if (!r.predictions.length) say(green('  None. No twist was called before its reveal.'));
      say(`\n${bold('Unresolved confusion')}`);
      for (const c of r.confusions.filter((c) => !c.resolved_in)) say(`  ${c.scene}: ${c.text}`);
      for (const b of r.boredom) say(red(`  Boredom run ${b.from} → ${b.to}`));
      if (r.twists?.length) say(`\n${bold('Twists')}`);
      for (const t of r.twists ?? []) say(`  ${t.verdict === 'good' ? green('✓') : t.verdict === 'unknown' ? dim('?') : yellow('●')} ${t.scene} ${t.what}: ${t.verdict}${t.fairness !== null ? dim(` (fair ${t.fairness}/5)`) : ''}${t.guessed ? dim(` guessed in ${t.guessed.guessed_in}`) : ''}`);
      say(dim(`\nWritten to reports/reader-${r.id}.md`));
    },
  },

  check: {
    help: 'check [--mechanical]   Continuity checks (mechanical, plus model on changed pairs)',
    async run() {
      if (flags.mechanical) {
        const p = loadProject(projectDir()).project;
        const issues = mechanicalContinuity(p);
        for (const i of issues) say(`${i.severity === 'high' ? red('●') : yellow('●')} ${i.scene} ${i.kind}: ${i.message}`);
        say(issues.length ? red(`${issues.length} issue(s)`) : green('✓ No mechanical continuity issues.'));
        if (issues.length) process.exitCode = 1;
        return;
      }
      const e = openEngine();
      const r = await e.continuity({ progress });
      for (const i of [...r.mechanical, ...r.model]) say(`${i.severity === 'high' ? red('●') : yellow('●')} ${i.scene} ${i.kind}: ${i.message}`);
      say(r.mechanical.length + r.model.length ? '' : green('✓ No continuity issues.'));
    },
  },

  voice: {
    help: 'voice   Repetition, overused openers, indistinguishable voices, banned patterns',
    run() {
      const e = openEngine();
      const r = e.voice();
      for (const x of r.repeated_phrases.slice(0, 15)) say(`  "${x.phrase}" ×${x.count} ${dim(x.scenes.join(', '))}`);
      for (const x of r.overused_openers) say(`  opener "${x.opener}…" ×${x.count}`);
      for (const x of r.similar_voices) say(yellow(`  ${x.a} and ${x.b} sound alike (${x.similarity})`));
      for (const x of r.banned) say(red(`  ${x.scene}:${x.line} ${x.label} "${x.match}"`));
      say(`${r.warnings} warning(s)`);
    },
  },

  estimate: {
    help: 'estimate   Price a full first draft before writing',
    run() {
      const e = openEngine();
      const r = e.estimate();
      for (const l of r.lines) say(`  ${l.stage.padEnd(40)} ${dim(l.model.padEnd(20))} ${String(l.calls).padStart(4)} calls  $${l.cost_usd.toFixed(2)}`);
      say(bold(`  Total ≈ $${r.total_usd.toFixed(2)}`) + dim(` for ${r.scenes_to_write} scenes (~${r.words_to_write.toLocaleString('en')} words)`));
    },
  },

  costs: {
    help: 'costs   What has been spent so far (reports/costs.jsonl)',
    run() {
      const store = GraphStore.open(projectDir(), { noIndex: true });
      const s = costSummary(store);
      for (const [a, v] of Object.entries(s.by_agent)) say(`  ${a.padEnd(24)} ${String(v.calls).padStart(4)} calls  $${v.cost_usd.toFixed(4)}`);
      say(bold(`  Total $${s.total_usd.toFixed(4)} over ${s.calls} calls`));
    },
  },

  export: {
    help: 'export [--format md|docx|epub]   Export the manuscript (docx/epub need Pandoc)',
    async run() {
      const { exportManuscript } = await import('@quillgon/server');
      const store = GraphStore.open(projectDir(), { noIndex: true });
      const r = exportManuscript(store, ((flags.format as string) ?? 'md') as 'md');
      say(green(`✓ ${r.file}`));
    },
  },

  log: {
    help: 'log   History (every accepted change is a commit)',
    async run() {
      const store = GraphStore.open(projectDir(), { noIndex: true });
      for (const c of await store.repo.log(Number(flags.n) || 30)) say(`${dim(c.hash.slice(0, 7))} ${c.date.slice(0, 16).replace('T', ' ')}  ${c.message}`);
    },
  },

  branch: {
    help: 'branch [name|switch <name>|merge <name>|delete <name>]   "What if" branches',
    async run() {
      const store = GraphStore.open(projectDir(), { noIndex: true });
      const [a, b] = args;
      if (!a) {
        const r = await store.repo.branches();
        for (const x of r.all) say(`${x === r.current ? green('* ') : '  '}${x}`);
      } else if (a === 'switch') await store.repo.switchBranch(b);
      else if (a === 'merge') say(await store.repo.merge(b));
      else if (a === 'delete') await store.repo.deleteBranch(b);
      else (await store.repo.createBranch(a), say(green(`✓ On new what-if "${a}"`)));
    },
  },

  serve: {
    help: 'serve [--port 4317]   Run the local API (and the UI if built)',
    async run() {
      const { NovelServer } = await import('@quillgon/server');
      const here = path.dirname(fileURLToPath(import.meta.url));
      const staticDir = path.resolve(here, '../../../apps/desktop/dist');
      const server = new NovelServer({ staticDir });
      const dir = (flags.dir as string) ?? args[0];
      if (dir) server.open(dir);
      const port = await server.listen(Number(flags.port) || 4317);
      say(`${green('●')} Quillgon on ${bold(`http://127.0.0.1:${port}`)}${dir ? dim(`  (${path.resolve(dir)})`) : ''}`);
    },
  },
};

// ------------------------------------------------------------------ $EDITOR change flow

async function editEntity(e: Engine, ref: string | undefined, persist: boolean): Promise<Change | null> {
  if (!ref) throw new Error('which entity? e.g. scene:s04, state:mara@s04, thread:ledger, plot:pp-drowning, character:mara, structure');
  const store = e.store;
  const p = store.project;
  const [kind, rest = ''] = ref.includes(':') ? ref.split(/:(.*)/s) : [ref, ''];
  const edit = (value: unknown): unknown => {
    const file = path.join(os.tmpdir(), `novel-${kind}-${rest.replace(/\W/g, '_')}.yaml`);
    fs.writeFileSync(file, YAML.stringify(value, { lineWidth: 0 }));
    const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
    const r = spawnSync(editor, [file], { stdio: 'inherit', shell: true });
    if (r.status !== 0) throw new Error(`${editor} exited with ${r.status}`);
    return YAML.parse(fs.readFileSync(file, 'utf8'));
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  switch (kind) {
    case 'scene': {
      const before = structuredClone(store.scene(rest).card);
      const after = SceneCard.parse({ ...(edit(before) as object), id: rest });
      if (same(before, after)) return null;
      store.saveCard(after);
      return { kind: 'card', scene: rest, before, after };
    }
    case 'state': {
      const [character, scene] = rest.split('@');
      const before = p.characters.get(character)?.state[scene] ?? StateSnapshot.parse({});
      const after = StateSnapshot.parse(edit(before));
      if (same(before, after)) return null;
      return persist ? e.editState(character, scene, after) : { kind: 'state', character, scene, before, after };
    }
    case 'thread': {
      const before = p.threads.get(rest) ?? null;
      const after = Thread.parse({ ...(edit(before ?? { id: rest, kind: 'arc' }) as object), id: rest });
      if (same(before, after)) return null;
      store.saveThread(after);
      return { kind: 'thread', before, after };
    }
    case 'plot': {
      const before = p.plotPoints.get(rest) ?? null;
      const after = PlotPoint.parse({ ...(edit(before ?? { id: rest, description: '' }) as object), id: rest });
      if (same(before, after)) return null;
      store.savePlotPoint(after);
      return { kind: 'plot', before, after };
    }
    case 'character': {
      const ch = p.characters.get(rest);
      if (!ch) throw new Error(`no character "${rest}"`);
      const v = edit({ bio: ch.bio, voice: ch.voice }) as { bio: unknown; voice: unknown };
      const bio = CharacterBio.parse({ ...(v.bio as object), id: rest });
      const voice = CharacterVoice.parse(v.voice);
      if (same(bio, ch.bio) && same(voice, ch.voice)) return null;
      const field = same(voice, ch.voice) ? 'bio' : 'voice';
      store.saveCharacter({ bio, voice });
      return { kind: 'character', character: rest, field };
    }
    case 'structure': {
      const before = sceneOrder(p);
      const st = Structure.parse(edit(p.structure));
      store.saveStructure(st);
      const after = sceneOrder(store.project);
      return same(before, after) ? null : { kind: 'reorder', before, after };
    }
  }
  throw new Error(`unknown entity kind "${kind}"`);
}

// ------------------------------------------------------------------ interactive ripple review

async function rippleLoop(e: Engine, r: Ripple) {
  while (r.data.state === 'reviewing') {
    const round = r.round;
    say(`\n${bold(`Round ${round.n} of at most ${r.data.roundCap}`)} — ${r.data.description}`);
    for (const it of round.items.filter((i) => i.status === 'conflict')) await resolveConflict(r, it);
    if (r.data.state !== 'reviewing') break;
    if (round.items.some((i) => i.status === 'pending')) {
      say(dim('Asking the reviser about each flagged scene…'));
      await r.propose(undefined, progress);
    }
    for (const it of round.items) {
      if (it.status === 'no_change') say(`${dim('○')} ${it.scene} ${it.title}: ${dim(`no change — ${it.card?.justification}`)}`);
      if (it.status === 'error') say(red(`✗ ${it.scene}: ${it.error}`));
      if (it.status !== 'proposed') continue;
      say(`\n${yellow('●')} ${bold(`${it.scene} ${it.title}`)} ${dim(`hop ${it.hop}`)}\n  ${it.reasons.join('\n  ')}\n  ${cyan(it.card!.justification)}`);
      printDiff(YAML.stringify(it.card!.before), YAML.stringify(it.card!.after));
      const a = (await ask('[a]ccept, [r]eject?', 'a')).toLowerCase();
      if (a.startsWith('r')) r.reject(it.scene);
      else r.accept(it.scene);
    }
    if (round.items.some((i) => i.prose.status === 'pending')) {
      say(dim('\nRevising prose of accepted scenes (minimum change)…'));
      await r.proposeProse(undefined, progress);
    }
    for (const it of round.items.filter((i) => i.prose.status === 'proposed')) {
      say(`\n${bold(`Prose: ${it.scene} ${it.title}`)} ${dim(it.prose.summary)}`);
      printDiff(it.prose.before, it.prose.after ?? '', true);
      if ((await ask('[a]ccept, [r]eject?', 'a')).toLowerCase().startsWith('r')) r.rejectProse(it.scene);
      else r.acceptProse(it.scene);
    }
    for (const it of round.items.filter((i) => i.prose.status === 'locked')) say(yellow(`  ${it.scene}: prose is locked; its card moved ahead of it.`));
    await r.apply(progress);
    say(green(`✓ Round ${round.n} committed ${dim(round.commit?.slice(0, 7) ?? '')}`));
  }
  if (r.data.state === 'capped') {
    say(yellow(`\nStopped at the cascade cap (${r.data.roundCap} rounds). Still inconsistent:`));
    showImpact(r.data.remaining, 3);
  } else if (r.data.state === 'done') say(green('\n✓ Ripple complete.'));
  const issues = mechanicalContinuity(e.store.project);
  say(issues.length ? yellow(`Continuity: ${issues.length} mechanical issue(s). Run \`quillgon check\`.`) : green('Continuity: no mechanical issues.'));
}

async function resolveConflict(r: Ripple, it: RippleItem) {
  say(`\n${red('■ Conflict')} ${bold(`${it.scene} ${it.title}`)} is locked (${it.conflict!.lock}).\n  ${it.reasons.join('\n  ')}`);
  const a = (await ask('[u]nlock and include, [k]eep the lock and record the inconsistency, or [r]evert the original change?', 'k')).toLowerCase();
  await r.resolveConflict(it.scene, a.startsWith('u') ? 'unlock' : a.startsWith('r') ? 'revert' : 'keep');
}

// ------------------------------------------------------------------ main

const command = commands[cmd];
if (!command) {
  console.error(red(`Unknown command "${cmd}".`));
  commands.help.run();
  process.exit(1);
}
try {
  await command.run();
} catch (e) {
  console.error(red(`✗ ${(e as Error).message}`));
  process.exitCode = 1;
}
