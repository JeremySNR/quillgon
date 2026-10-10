// The content and navigation work without JavaScript. These are optional enhancements.
const tabs = [...document.querySelectorAll('[data-tab]')];
const panelGroup = document.querySelector('.workspace-panels');
if (panelGroup && tabs.length) {
  const activate = tab => {
    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.classList.toggle('active', selected);
      candidate.setAttribute('aria-pressed', String(selected));
      document.getElementById(candidate.dataset.tab).hidden = !selected;
    }
  };
  panelGroup.classList.add('enhanced');
  activate(tabs[0]);
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activate(tabs[next]);
      tabs[next].focus();
    });
  }
}

const examples = {
  reveal: ['Mara discovers the ledger one chapter earlier.', 'Move the moment she learns the truth.', 'Her questions may need to change.', 'Check the payoff still feels earned.', 'Changed', 'Review', 'Review', 'One change. Three connected moments. You choose what to keep.'],
  knowledge: ['Tom knows the ledger is forged before Mara does.', 'Record who knows what, and when.', 'Review what Tom chooses to reveal.', 'Revisit the meaning of his silence.', 'Changed', 'Review', 'Review', 'A new fact can change the meaning of a later conversation.'],
  locked: ['Keep the final reckoning exactly as written.', 'Inspect the earlier discovery.', 'Review the path into the ending.', 'This scene stays locked until you decide.', 'Review', 'Review', 'Locked', 'A locked scene surfaces a conflict. The decision stays with you.'],
};
const fields = ['change-text', 'scene-one', 'scene-two', 'scene-three', 'tag-one', 'tag-two', 'tag-three', 'demo-summary'];
for (const input of document.querySelectorAll('input[name="scenario"]')) {
  input.addEventListener('change', () => {
    const example = examples[input.value];
    if (example) fields.forEach((id, index) => { document.getElementById(id).textContent = example[index]; });
  });
}

const dialog = document.querySelector('.image-dialog');
if (dialog?.showModal) {
  const image = dialog.querySelector('img');
  const caption = dialog.querySelector('p');
  for (const link of document.querySelectorAll('[data-lightbox]')) {
    link.addEventListener('click', event => {
      event.preventDefault();
      image.src = link.href;
      image.alt = link.querySelector('img').alt;
      caption.textContent = image.alt;
      dialog.showModal();
    });
  }
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
}

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.parentElement.querySelector('code').textContent);
      button.textContent = 'Copied';
      button.setAttribute('aria-label', 'Installation commands copied');
      setTimeout(() => { button.textContent = 'Copy'; button.setAttribute('aria-label', 'Copy installation commands'); }, 2500);
    } catch {
      button.textContent = 'Select below';
      button.setAttribute('aria-label', 'Select and copy the commands below');
    }
  });
}
