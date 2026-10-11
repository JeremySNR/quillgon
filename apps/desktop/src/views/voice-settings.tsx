import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Cloud, HardDrive, Mic } from 'lucide-react';
import { put } from '../lib/api';
import { useApp } from '../lib/app';
import type { Book } from '../lib/types';
import { Badge, Button, Field, ListEditor, Segmented } from '../components/ui';
import { fieldTarget, MicButton, useDictation, type DictateResponse } from '../components/dictate';

type Voice = Book['voice'];

const LEVELS: { value: Voice['cleanup']; label: string; hint: string }[] = [
  { value: 'verbatim', label: 'Verbatim', hint: 'Exactly what you said, with spacing and capitals fixed.' },
  { value: 'light', label: 'Light', hint: 'Fillers, stutters and "no wait" corrections removed. Your words otherwise.' },
  { value: 'polished', label: 'Polished', hint: 'Loose sentences tightened as well. Never adds a fact or a name.' },
];

/** Settings → Voice: which recogniser hears you, how much it tidies, and the words it must spell right. */
export function VoiceSettings() {
  const { project: p, toast, refresh, markSaved } = useApp();
  const saved = p!.book.voice;
  const [v, setV] = useState<Voice>(saved);
  useEffect(() => setV(saved), [saved]);
  const status = p!.dictation;
  const people = useMemo(() => p!.characters.flatMap((c) => [c.bio.name, ...c.bio.aliases]).length + p!.locations.length, [p]);
  const save = async () => {
    try {
      await put('/book', { book: { voice: v } });
      markSaved();
      toast({ kind: 'success', message: 'Voice settings saved' });
      refresh();
    } catch (e) {
      toast({ kind: 'error', message: 'Not saved', detail: (e as Error).message });
    }
  };
  return (
    <div className="stack lg">
      <div className="card stack">
        <div className="card-head">
          <Mic size={16} />
          <h3 className="grow">Speech recogniser</h3>
          {status.ready ? <Badge kind="success">Ready</Badge> : <Badge kind="warning">Not set up</Badge>}
        </div>
        {status.ready ? (
          <p className="row">
            {status.local ? <HardDrive size={15} /> : <Cloud size={15} />}
            <span>
              {status.provider === 'offline'
                ? 'Offline placeholder: recordings are not really transcribed. Choose a recogniser to dictate for real.'
                : status.local
                  ? `whisper.cpp on this computer (${status.model}). Your voice never leaves it.`
                  : `OpenAI ${status.model}. Audio is sent to OpenAI to be transcribed.`}
            </span>
          </p>
        ) : (
          <p className="muted">{status.reason}</p>
        )}
        <div className="grid-3">
          <Field label="Recogniser">
            <select className="select" value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value as Voice['provider'] })}>
              <option value="auto">Automatic (this computer first)</option>
              <option value="local">whisper.cpp on this computer</option>
              <option value="openai">OpenAI</option>
              <option value="offline">Offline placeholder</option>
            </select>
          </Field>
          <Field label="Model" hint="Empty for the default (gpt-4o-mini-transcribe).">
            <input className="input" value={v.model} placeholder="gpt-4o-mini-transcribe" onChange={(e) => setV({ ...v, model: e.target.value })} />
          </Field>
          <Field label="Language" hint="Two letters, e.g. en. Empty to detect.">
            <input className="input" value={v.language} maxLength={5} onChange={(e) => setV({ ...v, language: e.target.value.trim() })} />
          </Field>
        </div>
        <details className="muted">
          <summary>Run it on this computer with whisper.cpp</summary>
          <p>
            Build <span className="mono">whisper-cli</span> from github.com/ggml-org/whisper.cpp and download a model such as <span className="mono">ggml-large-v3-turbo-q5_0.bin</span>. Then start Quillgon with{' '}
            <span className="mono">QUILLGON_WHISPER_CMD=/path/to/whisper-cli</span> and <span className="mono">QUILLGON_WHISPER_MODEL=/path/to/model.bin</span> set. Automatic then uses it before any cloud service.
          </p>
        </details>
      </div>

      <div className="card stack">
        <div className="card-head">
          <h3 className="grow">Tidying up</h3>
        </div>
        <Segmented value={v.cleanup} options={LEVELS.map((l) => ({ value: l.value, label: l.label }))} onChange={(cleanup) => setV({ ...v, cleanup })} />
        <p className="muted">{LEVELS.find((l) => l.value === v.cleanup)?.hint} If a tidy-up ever adds a name you did not say, or rewrites too much, your words go in as said instead and you are told why.</p>
      </div>

      <div className="card stack">
        <div className="card-head">
          <h3 className="grow">Words to spell right</h3>
          <span className="faint">plus {people} names from your book</span>
        </div>
        <p className="muted">Everyone in the book and every place is already on the list. Add family names, nicknames and words a recogniser would get wrong.</p>
        <ListEditor items={v.dictionary} onChange={(dictionary) => setV({ ...v, dictionary: dictionary.map((d) => d.trim()).filter((d, i, a) => d || i === a.length - 1) })} placeholder="Siobhan, Harehills, the felling…" numbered={false} />
      </div>

      <div>
        <Button variant="primary" icon={<Check />} onClick={save}>
          Save
        </Button>
      </div>

      <TryIt />
    </div>
  );
}

function TryIt() {
  const [text, setText] = useState('');
  const [last, setLast] = useState<DictateResponse | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const dictation = useDictation({ target: useMemo(() => fieldTarget(() => ref.current, () => textRef.current, setText), []), onText: setLast });
  return (
    <div className="card stack">
      <div className="card-head">
        <h3 className="grow">Try it</h3>
        <MicButton dictation={dictation} />
      </div>
      <textarea ref={ref} className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="Dictation test" placeholder="Press Dictate, say a sentence with a name in it, then stop." />
      {last && (
        <p className="muted">
          Heard: “{last.raw}” · {last.seconds.toFixed(1)} s · {last.level}
          {last.flags.length ? ` · tidy-up refused: ${last.flags.join('; ')}` : ''}
        </p>
      )}
    </div>
  );
}
