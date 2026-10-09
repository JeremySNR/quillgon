/**
 * Builds fixtures/novella from the data below and the prose in scripts/fixture-prose.
 * Everything goes through GraphStore, so the fixture is validated as it is written,
 * and every scene ends up in_sync (hashes stamped, facts extracted).
 *
 *   pnpm tsx scripts/build-fixture.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GraphStore, type SceneCard, type StateSnapshot } from '@novel/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', 'fixtures', 'novella');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'book.yaml'), 'title: The Tidekeeper\'s Ledger\n');

const store = GraphStore.open(out, { memoryIndex: true });

store.saveBook({
  title: "The Tidekeeper's Ledger",
  genre: 'literary mystery',
  target_words: 12000,
  pov_mode: 'third-limited',
  tense: 'past',
  stage: 'complete',
  models: {},
  agents: {},
});

store.saveIntent({
  premise:
    "Cornwall, 1926. Mara Penrose comes home to bury her father, the harbourmaster, who drowned on a flat-calm night. His tide ledger records a storm that never came. She sets out to learn who wrote it, and finds the answer is closer and sadder than murder.",
  themes: ['what we owe the dead', 'debt as a kind of silence', 'honest records and dishonest kindness'],
  tone: 'Quiet, salt-worn, restrained. Feeling carried in objects and weather, never announced.',
  hard_rules: [
    'No villain monologues. Nobody explains themselves at length.',
    'The sea is never personified as malicious.',
    'Nobody in the village uses modern idiom.',
    'The ledger is never torn or destroyed.',
  ],
  ending_type: 'Bittersweet: truth told, nothing undone, a family partly mended.',
  approved: true,
  notes: 'The twist (Jory forged the entry to hide his own part) must not be guessable before scene 10.',
});

fs.mkdirSync(path.join(out, 'style'), { recursive: true });
store.saveStyle({
  samples: `# Voice samples

Short declaratives, then one long sentence that carries the feeling. Weather and objects do the emotional work.

> The water below them made small sounds against the wall, nothing more.

> She found she was crying, and that she did not mind.

Dialogue in single quotes. Cornish rhythms for Tom ("Aye", "boy", "girl"), never phonetic spelling.
`,
  banned: `# Banned patterns

Words and constructions the writer must never use. One per list item.
Plain phrases match whole words, case-insensitive. /regex/ for patterns. "(max N per scene)" sets an allowance.

- delve
- tapestry
- palpable
- "a testament to"
- "couldn't help but"
- "shivers down"
- "let out a breath"
- negation-pivot: /\\bnot (?:just|only|merely) [\\w\\s]+?, but\\b/i
- em-dash: /—/ (max 2 per scene)
`,
});

store.saveTimeline({
  events: [
    { id: 'e-boat-adrift', when: '1926-03-03T22:30', description: "Jory's boat, the Kittiwake, slips her mooring and drifts out on the ebb.", scenes: ['s07', 's09', 's10'] },
    { id: 'e-walter-drowns', when: '1926-03-03T23:30', description: 'Walter rows out alone after the Kittiwake and drowns off the Mewstone.', scenes: ['s01', 's02', 's10'] },
    { id: 'e-ledger-forged', when: '1926-03-04T05:00', description: 'Jory writes a storm into the ledger in blue-black ink.', scenes: ['s10'] },
    { id: 'e-jory-tells-eliza', when: '1926-03-06T10:00', description: 'Jory asks Eliza for money and tells her everything.', scenes: ['s11'] },
    { id: 'e-mara-returns', when: '1926-03-12T17:00', description: 'Mara arrives in Porthwenna on the evening bus.', scenes: ['s01'] },
    { id: 'e-funeral', when: '1926-03-13T10:00', description: "Walter's funeral at the chapel.", scenes: ['s01'] },
    { id: 'e-letter-to-truro', when: '1926-03-17T12:00', description: "Mara's finished letter is signed by the witnesses.", scenes: ['s11', 's12'] },
  ],
});

fs.writeFileSync(
  path.join(out, 'locations.yaml'),
  `locations:
  - id: harbour
    name: Harbour wall
    description: The curved granite wall enclosing the cove; Jory's place to drink.
    near: [quay, harbour-office, ship-inn]
  - id: harbour-office
    name: Harbour office
    description: One room on the quay. Paraffin, wet rope, the ledger on the desk.
    near: [quay, harbour]
  - id: quay
    name: The quay
    description: Fish boxes, nets, the slip, a view of the Mewstone.
    near: [harbour, harbour-office, cannery, ship-inn]
  - id: cannery
    name: Trevaskis cannery
    description: Pilchard works with a new brick wing; Eliza's office overlooks the floor.
    near: [quay]
  - id: cottage
    name: The Penrose cottage
    description: The harbourmaster's house above the cove.
    near: [quay]
  - id: ship-inn
    name: The Ship
    description: The village pub at the end of the quay.
    near: [quay, harbour]
`,
);

fs.writeFileSync(
  path.join(out, 'facts.yaml'),
  `facts:
  - id: walter-drowned
    statement: Walter Penrose drowned on the night of 3 March 1926.
  - id: ledger-storm-entry
    statement: The ledger records a force-8 storm on the night of 3 March.
  - id: no-storm-that-night
    statement: The night of 3 March was flat calm.
  - id: eliza-holds-debts
    statement: Eliza Trevaskis holds the debts of most of the village's boats.
  - id: ink-mismatch
    statement: The storm entry is in blue-black shop ink and an uncrossed hand, not Walter's.
  - id: walter-letter
    statement: Walter drafted a letter to the county exposing the cannery's short weights.
  - id: jory-boat-lost
    statement: Jory's boat, the Kittiwake, drifted out that night and Walter went after it.
  - id: jory-forged-ledger
    statement: Jory wrote the storm into the ledger to hide his part in Walter's death.
  - id: eliza-knew
    statement: Eliza knew about the forgery and used it to silence Jory.
`,
);

const characters = [
  {
    bio: {
      id: 'mara',
      name: 'Mara Penrose',
      role: 'protagonist',
      goals: ['bury her father', 'learn who wrote the storm into the ledger'],
      aliases: ['Miss Mara'],
      background:
        "Thirty-four. Left Porthwenna at nineteen for a clerk's post in London and stayed. Precise, impatient, quietly proud. As a girl she ruled the ledger's columns for her father on Sunday evenings.",
    },
    voice: {
      speech_patterns: ['short direct questions', 'states facts plainly, then waits', 'calls her father "Dad" only with Jory'],
      sample_lines: ["Tell me how it happened.", "He wasn't confused for thirty-one years.", 'Someone has to keep the book.'],
      avoid: ['dialect', 'exclamations', 'long speeches'],
      notes: 'London has sanded the accent off her. Under pressure she gets quieter, not louder.',
    },
  },
  {
    bio: {
      id: 'jory',
      name: 'Jory Penrose',
      role: 'brother; the secret',
      goals: ['keep what happened that night hidden', 'be forgiven without asking'],
      background: "Twenty-six. Stayed when Mara left. Drinks at the Ship. Owns the Kittiwake, which Walter built for him. Was learning the ledger.",
    },
    voice: {
      speech_patterns: ['deflects with sarcasm', 'fragments', 'answers questions with questions'],
      sample_lines: ['You came, then.', 'Was he.', "I'm not asking you to forgive it."],
      avoid: ['eloquence', 'self-pity stated outright'],
      notes: 'His voice goes flat, not loud, when he is telling the truth.',
    },
  },
  {
    bio: {
      id: 'tom',
      name: 'Tom Kessell',
      role: "Walter's deckhand",
      goals: ["protect Walter's children", 'stop being a coward'],
      background: 'Sixties. Twenty years on Walter\'s boat. Bad chest; sleeps badly. Saw the Kittiwake adrift from his window.',
    },
    voice: {
      speech_patterns: ['slow, few words', '"Aye", "boy", "girl"', 'sea and weather comparisons'],
      sample_lines: ['There was no weather that night.', 'Jory says a lot of things, these days.', "Because I'm a coward. Take your pick."],
      avoid: ['abstraction', 'phonetic dialect spelling'],
      notes: 'Never finishes a hard sentence on the first try. Works with his hands while he talks.',
    },
  },
  {
    bio: {
      id: 'eliza',
      name: 'Eliza Trevaskis',
      role: 'cannery owner; creditor to the village',
      goals: ['keep the cannery profitable', 'keep the village in her debt'],
      background: 'Fifties. Built the cannery from her late husband\'s fish cellar. Lends to the boats, buys their catch, short-weighs it.',
    },
    voice: {
      speech_patterns: ['polished, balanced sentences', 'uses "Mara" often', 'frames threats as kindness'],
      sample_lines: ['Everybody owes somebody, Mara.', 'It would be kinder.', "I keep things. Debts, mostly."],
      avoid: ['raised voice', 'denial when cornered'],
      notes: 'Never lies outright once caught; switches to frankness as a tactic.',
    },
  },
];

const states: Record<string, Record<string, Partial<StateSnapshot>>> = {
  mara: {
    s01: { knows: ['walter-drowned'], wants: 'to bury her father and leave', feels: { jory: 'resentful' }, location: 'harbour' },
    s02: { knows: ['walter-drowned', 'ledger-storm-entry'], wants: 'to understand the ledger', feels: { jory: 'resentful' }, location: 'harbour-office' },
    s03: { knows: ['walter-drowned', 'ledger-storm-entry', 'no-storm-that-night'], wants: 'to know why he wrote a storm', feels: { jory: 'resentful', tom: 'trusting' }, location: 'quay' },
    s04: { knows: ['walter-drowned', 'ledger-storm-entry', 'no-storm-that-night', 'eliza-holds-debts'], wants: 'to know why he wrote a storm', feels: { jory: 'resentful', tom: 'trusting', eliza: 'wary' }, location: 'cannery' },
    s05: { knows: ['walter-drowned', 'ledger-storm-entry', 'no-storm-that-night', 'eliza-holds-debts', 'ink-mismatch'], wants: 'to find who wrote the entry', feels: { jory: 'suspicious', tom: 'trusting', eliza: 'wary' }, location: 'harbour-office' },
    s06: { knows: ['walter-drowned', 'ledger-storm-entry', 'no-storm-that-night', 'eliza-holds-debts', 'ink-mismatch', 'walter-letter'], wants: 'to confront Eliza', feels: { jory: 'suspicious', tom: 'trusting', eliza: 'suspicious' }, location: 'cottage' },
    s08: { knows: ['walter-drowned', 'ledger-storm-entry', 'no-storm-that-night', 'eliza-holds-debts', 'ink-mismatch', 'walter-letter'], wants: 'to find who wrote the entry', feels: { jory: 'suspicious', tom: 'trusting', eliza: 'hostile' }, location: 'cannery' },
    s09: { knows: ['walter-drowned', 'ledger-storm-entry', 'no-storm-that-night', 'eliza-holds-debts', 'ink-mismatch', 'walter-letter', 'jory-boat-lost'], wants: 'to hear it from Jory', feels: { jory: 'grieving', tom: 'hurt', eliza: 'hostile' }, location: 'quay' },
    s10: { knows: ['walter-drowned', 'ledger-storm-entry', 'no-storm-that-night', 'eliza-holds-debts', 'ink-mismatch', 'walter-letter', 'jory-boat-lost', 'jory-forged-ledger'], wants: 'to set the record right', feels: { jory: 'grieving', tom: 'hurt', eliza: 'hostile' }, location: 'harbour-office' },
    s11: { knows: ['walter-drowned', 'ledger-storm-entry', 'no-storm-that-night', 'eliza-holds-debts', 'ink-mismatch', 'walter-letter', 'jory-boat-lost', 'jory-forged-ledger', 'eliza-knew'], wants: 'to finish the letter', feels: { jory: 'grieving', tom: 'trusting', eliza: 'cold' }, location: 'cannery' },
    s12: { knows: ['walter-drowned', 'ledger-storm-entry', 'no-storm-that-night', 'eliza-holds-debts', 'ink-mismatch', 'walter-letter', 'jory-boat-lost', 'jory-forged-ledger', 'eliza-knew'], wants: 'to keep the book', feels: { jory: 'forgiving', tom: 'trusting', eliza: 'cold' }, location: 'harbour' },
  },
  jory: {
    s01: { knows: ['walter-drowned', 'jory-boat-lost', 'jory-forged-ledger', 'eliza-knew'], wants: 'to keep his secret', feels: { mara: 'defensive' }, location: 'harbour' },
    s05: { knows: ['walter-drowned', 'jory-boat-lost', 'jory-forged-ledger', 'eliza-knew', 'ink-mismatch'], wants: 'to keep his secret', feels: { mara: 'afraid' }, location: 'harbour-office' },
    s07: { knows: ['walter-drowned', 'jory-boat-lost', 'jory-forged-ledger', 'eliza-knew', 'ink-mismatch'], wants: 'to keep his secret', feels: { mara: 'afraid', tom: 'cornered' }, location: 'ship-inn' },
    s10: { knows: ['walter-drowned', 'jory-boat-lost', 'jory-forged-ledger', 'eliza-knew', 'ink-mismatch'], wants: 'to be forgiven', feels: { mara: 'ashamed', tom: 'cornered' }, location: 'harbour-office' },
    s12: { knows: ['walter-drowned', 'jory-boat-lost', 'jory-forged-ledger', 'eliza-knew', 'ink-mismatch', 'walter-letter'], wants: 'to correct the ledger', feels: { mara: 'hopeful', tom: 'grateful' }, location: 'harbour' },
  },
  tom: {
    s03: { knows: ['walter-drowned', 'no-storm-that-night', 'jory-boat-lost', 'ledger-storm-entry'], wants: "to protect Walter's children", feels: { mara: 'protective', jory: 'worried' }, location: 'quay' },
    s06: { knows: ['walter-drowned', 'no-storm-that-night', 'jory-boat-lost', 'ledger-storm-entry', 'walter-letter'], wants: "to protect Walter's children", feels: { mara: 'protective', jory: 'worried', eliza: 'angry' }, location: 'cottage' },
    s07: { knows: ['walter-drowned', 'no-storm-that-night', 'jory-boat-lost', 'ledger-storm-entry', 'walter-letter'], wants: 'to make Jory tell her', feels: { mara: 'protective', jory: 'angry', eliza: 'angry' }, location: 'ship-inn' },
    s09: { knows: ['walter-drowned', 'no-storm-that-night', 'jory-boat-lost', 'ledger-storm-entry', 'walter-letter'], wants: 'to stop being a coward', feels: { mara: 'ashamed', jory: 'angry', eliza: 'angry' }, location: 'quay' },
    s11: { knows: ['walter-drowned', 'no-storm-that-night', 'jory-boat-lost', 'ledger-storm-entry', 'walter-letter', 'jory-forged-ledger', 'eliza-knew'], wants: 'to see it put right', feels: { mara: 'proud', jory: 'pitying', eliza: 'contempt' }, location: 'cannery' },
  },
  eliza: {
    s04: { knows: ['walter-drowned', 'eliza-holds-debts', 'jory-boat-lost', 'jory-forged-ledger', 'eliza-knew', 'no-storm-that-night', 'ledger-storm-entry'], wants: 'to send Mara back to London', feels: { mara: 'wary' }, location: 'cannery' },
    s08: { knows: ['walter-drowned', 'eliza-holds-debts', 'jory-boat-lost', 'jory-forged-ledger', 'eliza-knew', 'no-storm-that-night', 'ledger-storm-entry', 'walter-letter'], wants: 'to buy the harbour house and the silence with it', feels: { mara: 'threatened' }, location: 'cannery' },
    s11: { knows: ['walter-drowned', 'eliza-holds-debts', 'jory-boat-lost', 'jory-forged-ledger', 'eliza-knew', 'no-storm-that-night', 'ledger-storm-entry', 'walter-letter'], wants: 'to limit the damage', feels: { mara: 'respect', tom: 'indifferent' }, location: 'cannery' },
  },
};

for (const c of characters) store.saveCharacter({ ...c, state: states[c.bio.id] });

const threads = [
  {
    id: 'ledger',
    title: 'Who wrote the storm?',
    kind: 'mystery',
    description: 'The ledger records a storm on a calm night. Someone other than Walter wrote it.',
    setup_scene: 's02',
    payoff_scene: 's10',
    status: 'paid-off',
    beats: [
      { scene: 's03', note: 'Tom: there was no weather' },
      { scene: 's05', note: 'The ink and the uncrossed sevens' },
      { scene: 's07', note: 'Tom confronts Jory (reader sees, Mara does not)' },
      { scene: 's09', note: 'Tom tells Mara about the Kittiwake' },
    ],
  },
  {
    id: 'cannery-debt',
    title: 'Short weights',
    kind: 'setup-payoff',
    description: "Eliza holds the village's debts and short-weighs its catch. Walter was about to report her.",
    setup_scene: 's04',
    payoff_scene: 's11',
    status: 'paid-off',
    beats: [
      { scene: 's06', note: 'The unsent letter' },
      { scene: 's08', note: "Eliza's offer; 'ask your brother'" },
    ],
  },
  {
    id: 'mara-jory',
    title: 'Mara and Jory',
    kind: 'relationship',
    description: 'Estranged siblings; one left, one stayed. Ends in partial repair.',
    setup_scene: 's01',
    payoff_scene: 's12',
    status: 'paid-off',
    beats: [
      { scene: 's05', note: 'He walks out on her' },
      { scene: 's10', note: 'Confession and forgiveness' },
    ],
  },
];
for (const t of threads) store.saveThread(t);

store.savePlotPoint({
  id: 'pp-drowning',
  title: 'The calm-night drowning',
  description: 'Walter Penrose drowns on a flat-calm night; his tide ledger records a storm.',
  position: { act: 1 },
  involves: ['mara', 'jory'],
  threads: ['ledger'],
  locked: true,
});
store.savePlotPoint({
  id: 'pp-confession',
  title: "Jory's confession",
  description: "Jory confesses he wrote the storm into the ledger to hide that Walter died going after Jory's drifting boat.",
  position: { act: 3, after: 'pp-drowning' },
  involves: ['jory', 'mara'],
  threads: ['ledger', 'mara-jory'],
  locked: true,
});

type CardIn = Partial<SceneCard> & Pick<SceneCard, 'id' | 'title' | 'pov' | 'location'>;
const cards: CardIn[] = [
  {
    id: 's01', title: 'Funeral Eve', pov: 'mara', location: 'harbour', time: '1926-03-12 evening',
    purpose: 'Bring Mara home; establish the estrangement and the calm-night contradiction.',
    beats: ['Mara walks down into Porthwenna; the sea is flat', 'Jory drinking on the harbour wall', "Jory needles her about her letters", 'Mara: the telegram said it was calm; Jory goes still', 'He leaves the bottle on the wall'],
    characters: ['mara', 'jory'], threads_touched: ['mara-jory'], plot_points: ['pp-drowning'], reveals: ['walter-drowned'],
    mentions: [{ character: 'jory', fact: 'walter-drowned' }, { character: 'mara', fact: 'walter-drowned' }],
    deltas: [{ character: 'mara', learns: [], forgets: [], location: 'harbour' }],
    outcome: 'Mara is home, unwelcome, and already doubting the story.', status: 'approved',
  },
  {
    id: 's02', title: 'The Tide Ledger', pov: 'mara', location: 'harbour-office', time: '1926-03-12 night',
    purpose: 'Set up the mystery: the ledger records a storm.',
    beats: ["The office as he left it", "Mara sits in his chair; memory of ruling the columns", 'The entry for 3 March: force 8, heavy sea', 'Contradiction with the telegram and the coroner'],
    characters: ['mara'], threads_touched: ['ledger'], plot_points: ['pp-drowning'], reveals: ['ledger-storm-entry'],
    deltas: [{ character: 'mara', learns: ['ledger-storm-entry'], forgets: [], location: 'harbour-office' }],
    outcome: 'Mara knows the ledger and the weather disagree.', status: 'approved',
  },
  {
    id: 's03', title: 'No Weather', pov: 'mara', location: 'quay', time: '1926-03-13 morning',
    purpose: 'Confirm the night was calm; plant that Tom is holding something back.',
    beats: ['Tom mending nets', 'Mara tells him what the ledger says', "Tom: there was no weather; Walter wouldn't lie in the book", "'Talk to your brother'", 'Tom refuses to say more'],
    characters: ['mara', 'tom'], threads_touched: ['ledger'], reveals: ['no-storm-that-night'],
    mentions: [{ character: 'mara', fact: 'ledger-storm-entry' }, { character: 'tom', fact: 'no-storm-that-night' }],
    deltas: [{ character: 'mara', learns: ['no-storm-that-night'], forgets: [], location: 'quay' }, { character: 'tom', learns: ['ledger-storm-entry'], forgets: [] }],
    outcome: 'Mara is sure the entry is false and that Tom knows more.', status: 'approved',
  },
  {
    id: 's04', title: 'Short Weight', pov: 'mara', location: 'cannery', time: '1926-03-13 afternoon',
    purpose: "Introduce Eliza and her hold on the village; misdirect suspicion toward her.",
    beats: ['The grown cannery', "Eliza's sympathy and offer of help", 'Eliza: I hold the paper on most of the boats', 'Mara raises the calm night; something moves behind Eliza\'s eyes', "Eliza's warning: go home, it would be kinder"],
    characters: ['mara', 'eliza'], threads_touched: ['cannery-debt'], reveals: ['eliza-holds-debts'],
    mentions: [{ character: 'mara', fact: 'no-storm-that-night' }, { character: 'eliza', fact: 'eliza-holds-debts' }],
    deltas: [{ character: 'mara', learns: ['eliza-holds-debts'], forgets: [], location: 'cannery' }, { character: 'eliza', learns: ['no-storm-that-night', 'ledger-storm-entry'], forgets: [] }],
    outcome: 'Eliza becomes the obvious suspect.', status: 'approved',
  },
  {
    id: 's05', title: 'Two Inks', pov: 'mara', location: 'harbour-office', time: '1926-03-14 morning',
    purpose: "Physical evidence of forgery; Jory's reaction reads as grief, not guilt.",
    beats: ['Jory already in the office', 'Mara shows the iron-gall ink vs blue-black shop ink', 'The uncrossed sevens', "Jory cracks: 'like it's a puzzle in the Sunday paper'", 'He walks out'],
    characters: ['mara', 'jory'], threads_touched: ['ledger', 'mara-jory'], reveals: ['ink-mismatch'],
    mentions: [{ character: 'mara', fact: 'ledger-storm-entry' }, { character: 'mara', fact: 'no-storm-that-night' }, { character: 'jory', fact: 'walter-drowned' }],
    deltas: [{ character: 'mara', learns: ['ink-mismatch'], forgets: [], location: 'harbour-office' }, { character: 'jory', learns: ['ink-mismatch'], forgets: [] }],
    outcome: 'Mara knows someone else wrote the entry. The rift with Jory widens.', status: 'approved',
  },
  {
    id: 's06', title: 'The Unsent Letter', pov: 'mara', location: 'cottage', time: '1926-03-14 afternoon',
    purpose: "Give Eliza a motive; deepen misdirection.",
    beats: ["Tom brings Walter's things", 'The letter to the County Fisheries Committee under the tin lining', 'Short weights, column by column', "Tom: he was taking it to Truro the week after", "Mara: she must have known"],
    characters: ['mara', 'tom'], threads_touched: ['cannery-debt'], reveals: ['walter-letter'],
    mentions: [{ character: 'mara', fact: 'eliza-holds-debts' }, { character: 'tom', fact: 'walter-drowned' }],
    deltas: [{ character: 'mara', learns: ['walter-letter'], forgets: [], location: 'cottage' }, { character: 'tom', learns: ['walter-letter'], forgets: [] }],
    outcome: 'Eliza had a motive. Mara now suspects her.', status: 'approved',
  },
  {
    id: 's07', title: 'Adrift', pov: 'tom', location: 'ship-inn', time: '1926-03-15 evening',
    purpose: "Tom confronts Jory about the Kittiwake. The reader learns Walter went after Jory's boat, but not about the ledger.",
    beats: ['Jory at the dark end of the bar', 'Tom saw a boat adrift at two', 'The Kittiwake slipped her mooring', 'Walter went after her alone', "'You tell her, Jory. Or I will.'"],
    characters: ['tom', 'jory'], threads_touched: ['ledger', 'mara-jory'],
    mentions: [{ character: 'tom', fact: 'jory-boat-lost' }, { character: 'jory', fact: 'jory-boat-lost' }],
    deltas: [{ character: 'tom', learns: [], forgets: [], location: 'ship-inn' }],
    outcome: "Jory is cornered. The reader knows about the boat; Mara doesn't.", status: 'approved',
  },
  {
    id: 's08', title: 'The Offer', pov: 'mara', location: 'cannery', time: '1926-03-15 afternoon',
    purpose: "Mara confronts Eliza with the letter; Eliza turns suspicion toward Jory.",
    beats: ['Eliza offers to buy the harbour house', 'Everybody owes somebody', 'Mara lays the letter on the desk', 'Eliza drops the smile: the weights pay for the carrying', "'Ask your brother where he was that night.'"],
    characters: ['mara', 'eliza'], threads_touched: ['cannery-debt'],
    mentions: [{ character: 'mara', fact: 'walter-letter' }, { character: 'eliza', fact: 'eliza-holds-debts' }],
    deltas: [{ character: 'eliza', learns: ['walter-letter'], forgets: [] }],
    outcome: 'Eliza admits the weights but denies the drowning, and points at Jory.', status: 'approved',
  },
  {
    id: 's09', title: 'What Tom Saw', pov: 'mara', location: 'quay', time: '1926-03-16 dawn',
    purpose: 'Tom tells Mara about the Kittiwake.',
    beats: ['Low tide, boats on their sides', 'Mara: someone who knew how he set out a page', 'Tom: the Kittiwake slipped her mooring; Walter went after her', 'There was no storm; there didn\'t need to be', "Tom's confession of cowardice"],
    characters: ['mara', 'tom'], threads_touched: ['ledger'], reveals: ['jory-boat-lost'],
    mentions: [{ character: 'mara', fact: 'ink-mismatch' }, { character: 'tom', fact: 'jory-boat-lost' }],
    deltas: [{ character: 'mara', learns: ['jory-boat-lost'], forgets: [], location: 'quay' }],
    outcome: 'Mara knows how her father died. She has not yet put Jory and the ink together aloud.', status: 'approved',
  },
  {
    id: 's10', title: 'Confession', pov: 'mara', location: 'harbour-office', time: '1926-03-16 night',
    purpose: 'Twist: Jory forged the entry to hide that Walter died going after his boat.',
    beats: ["Jory in their father's chair", 'He did not make her fast; he did not get up when Walter called', 'At five he wrote the storm in', "'I just wanted there to be a reason that wasn't me.'", "Mara: he'd have gone out for you every time"],
    characters: ['mara', 'jory'], threads_touched: ['ledger', 'mara-jory'], plot_points: ['pp-confession'], reveals: ['jory-forged-ledger'],
    mentions: [{ character: 'mara', fact: 'jory-boat-lost' }, { character: 'mara', fact: 'ink-mismatch' }, { character: 'jory', fact: 'jory-forged-ledger' }],
    deltas: [{ character: 'mara', learns: ['jory-forged-ledger'], forgets: [], location: 'harbour-office' }],
    outcome: 'The truth, and the beginning of forgiveness.', status: 'locked', lock: 'both',
  },
  {
    id: 's11', title: 'Ledger Balanced', pov: 'mara', location: 'cannery', time: '1926-03-17 morning',
    purpose: "Pay off the cannery thread: Eliza knew and used it.",
    beats: ['Mara and Tom go to the cannery', 'Eliza knew the morning after; Jory came to her for money', 'She used it to keep him quiet about the letter', 'Mara will send the letter, signed by witnesses', 'She offers Eliza the chance to pay the boats back'],
    characters: ['mara', 'eliza', 'tom'], threads_touched: ['cannery-debt', 'ledger'], reveals: ['eliza-knew'],
    mentions: [{ character: 'mara', fact: 'walter-letter' }, { character: 'mara', fact: 'eliza-holds-debts' }, { character: 'mara', fact: 'jory-forged-ledger' }, { character: 'eliza', fact: 'jory-forged-ledger' }],
    deltas: [{ character: 'mara', learns: ['eliza-knew'], forgets: [], location: 'cannery' }, { character: 'tom', learns: ['jory-forged-ledger', 'eliza-knew'], forgets: [] }],
    outcome: 'Eliza is given the choice Walter would have given her.', status: 'approved',
  },
  {
    id: 's12', title: 'Slack Water', pov: 'mara', location: 'harbour', time: '1926-03-18 dawn',
    purpose: 'Close the relationship thread: Jory will correct the ledger in Walter\'s ink.',
    beats: ['Jory on the wall, no bottle', 'Slack water: the only time the sea tells the truth', 'Jory signed the letter', 'Mara will correct the ledger, not tear it', "Jory: I'll use his ink", 'Mara stays, for a while'],
    characters: ['mara', 'jory'], threads_touched: ['mara-jory'],
    mentions: [{ character: 'mara', fact: 'jory-forged-ledger' }, { character: 'jory', fact: 'walter-drowned' }],
    deltas: [{ character: 'jory', learns: ['walter-letter'], forgets: [], location: 'harbour' }],
    outcome: 'Truth recorded; a family partly mended.', status: 'approved',
  },
];

for (const c of cards) store.saveCard(c);

store.saveStructure({
  acts: [
    { id: 'act-1', title: 'Return', chapters: [
      { id: 'ch-1', title: 'The Calm Night', scenes: ['s01', 's02'] },
      { id: 'ch-2', title: 'Weights and Measures', scenes: ['s03', 's04'] },
    ] },
    { id: 'act-2', title: 'Undertow', chapters: [
      { id: 'ch-3', title: 'Two Inks', scenes: ['s05', 's06'] },
      { id: 'ch-4', title: 'Adrift', scenes: ['s07', 's08'] },
    ] },
    { id: 'act-3', title: 'Slack Water', chapters: [
      { id: 'ch-5', title: 'What Tom Saw', scenes: ['s09', 's10'] },
      { id: 'ch-6', title: 'Ledger Balanced', scenes: ['s11', 's12'] },
    ] },
  ],
});

// Prose, stamped as generated from the card, then "extracted": facts mirror what the prose says.
for (const c of cards) {
  const body = fs.readFileSync(path.join(here, 'fixture-prose', `${c.id}.md`), 'utf8');
  store.saveProse(c.id, body, 'generated', { status: c.status === 'locked' ? 'locked' : 'approved' });
  const card = store.scene(c.id).card;
  const facts = [
    ...card.mentions.map((m) => ({ subject: m.character, predicate: 'mentions' as const, object: m.fact, confidence: 0.9 })),
    ...card.deltas.flatMap((d) => d.learns.map((f) => ({ subject: d.character, predicate: 'knows' as const, object: f, confidence: 0.9 }))),
    ...card.characters.map((ch) => ({ subject: ch, predicate: 'located_at' as const, object: card.location, confidence: 0.95 })),
  ];
  store.markExtracted(c.id, { facts });
}

const errors = store.errors();
if (errors.length) {
  console.error(errors);
  process.exit(1);
}
const words = [...store.project.scenes.values()].reduce((n, s) => n + (s.prose?.meta.word_count ?? 0), 0);
console.log(`fixture written to ${out}: ${store.project.scenes.size} scenes, ${words} words, ${store.issues.length} warnings`);
for (const w of store.issues) console.log(' ', w.severity, w.file, w.path, w.message);
store.close();
