import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_AGENT_TIERS, type AgentSuite, type Book, type Intent } from '@quillgon/core';
import type { ModelAdapter } from './adapter/structured.js';
import * as A from './agents/index.js';
import { builtinPrompt, intentBlock, loadPrompt, type AgentDef } from './agents/define.js';

export interface SuiteContext {
  projectDir?: string;
  book: () => Book;
  intent: () => Intent;
}

/** The real agent suite: every call goes through the model adapter with validated output. */
export class ModelSuite implements AgentSuite {
  constructor(
    private adapter: ModelAdapter,
    private ctx: SuiteContext,
  ) {}

  private system(def: AgentDef<unknown, unknown>): string {
    const book = this.ctx.book();
    return [builtinPrompt(book.kind === 'novel' ? 'shared' : 'shared-life'), intentBlock(this.ctx.intent(), book), loadPrompt(def.name, this.ctx.projectDir)].join('\n\n---\n\n');
  }

  private async run<I, O>(def: AgentDef<I, O>, input: I, scene?: string): Promise<O> {
    const parsed = def.input.parse(input);
    const tier = this.ctx.book().agents[def.name] ?? DEFAULT_AGENT_TIERS[def.name];
    return this.adapter.complete({
      agent: `${def.name}.${def.task}`,
      tier,
      system: this.system(def as AgentDef<unknown, unknown>),
      messages: [{ role: 'user', content: def.render(parsed) }],
      schema: def.output,
      schemaName: `${def.name}.${def.task}`,
      maxTokens: def.maxTokens,
      scene,
    });
  }

  private humaniserSkill(): string {
    if (!this.ctx.projectDir) return '';
    const f = path.join(this.ctx.projectDir, 'style', 'humaniser.md');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  }

  interview: AgentSuite['interview'] = (i) => this.run(A.interviewer, i);
  plotPoints: AgentSuite['plotPoints'] = (i) => this.run(A.plannerPlotPoints, i);
  structures: AgentSuite['structures'] = (i) => this.run(A.plannerStructures, i);
  cards: AgentSuite['cards'] = (i) => this.run(A.plannerCards, i);
  write: AgentSuite['write'] = (i) => this.run(A.writer, i, i.card.id);
  voice: AgentSuite['voice'] = (i) => this.run(A.voice, i, i.scene);
  reviseLines: AgentSuite['reviseLines'] = (i) => this.run(A.reviseLines, i);
  humanise: AgentSuite['humanise'] = (i) => this.run(A.humaniser, { ...i, skill: i.skill || this.humaniserSkill() });
  extract: AgentSuite['extract'] = (i) => this.run(A.extractor, i, i.card.id);
  reviseCard: AgentSuite['reviseCard'] = (i) => this.run(A.reviseCard, i, i.card.id);
  reviseProse: AgentSuite['reviseProse'] = (i) => this.run(A.reviseProse, i, i.new_card.id);
  read: AgentSuite['read'] = (i) => this.run(A.reader, i, i.scene);
  continuity: AgentSuite['continuity'] = (i) => this.run(A.continuity, i, i.b.id);
  judge: AgentSuite['judge'] = (i) => this.run(A.judge, i);
  critique: AgentSuite['critique'] = (i) => this.run(A.critic, i);
  sampleTurns: AgentSuite['sampleTurns'] = (i) => this.run(A.sampler, i);
  diverge: AgentSuite['diverge'] = (i) => this.run(A.museDiverge, i);
  expand: AgentSuite['expand'] = (i) => this.run(A.museExpand, i);
  talk: AgentSuite['talk'] = (i) => this.run(A.museTalk, i);
  scribe: AgentSuite['scribe'] = (i) => this.run(A.scribe, i);
  ghostPlan: AgentSuite['ghostPlan'] = (i) => this.run(A.ghostPlan, i);
  ghostTurn: AgentSuite['ghostTurn'] = (i) => this.run(A.ghostTurn, i);
  ghostWrap: AgentSuite['ghostWrap'] = (i) => this.run(A.ghostWrap, i);
  ghostShape: AgentSuite['ghostShape'] = (i) => this.run(A.ghostShape, i);
  ghostDraft: AgentSuite['ghostDraft'] = (i) => this.run(A.ghostDraft, i);
  ghostRevise: AgentSuite['ghostRevise'] = (i) => this.run(A.ghostRevise, i);
  interviewee: AgentSuite['interviewee'] = (i) => this.run(A.interviewee, i);
}
