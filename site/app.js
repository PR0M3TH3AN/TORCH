const routeButton = document.querySelector('#route-toggle');
const steps = [...document.querySelectorAll('.route-step')];
const readout = document.querySelector('#route-readout');
const routeMessages = [
  'Owner intent recorded.', 'Session Manager assigned terrain ownership.',
  'Terrain and QA coordinate directly.', 'Checks passed for commit 8f6c2e1.',
  'Authorized fast-forward reached canonical main.',
];
let routeTimer;

routeButton?.addEventListener('click', () => {
  clearInterval(routeTimer);
  steps.forEach((step) => step.classList.remove('is-active', 'is-complete'));
  routeButton.setAttribute('aria-pressed', 'true');
  routeButton.textContent = 'Routing…';
  let index = 0;
  const advance = () => {
    steps.forEach((step, stepIndex) => {
      step.classList.toggle('is-complete', stepIndex < index);
      step.classList.toggle('is-active', stepIndex === index);
    });
    readout.textContent = routeMessages[index];
    index += 1;
    if (index === steps.length) {
      clearInterval(routeTimer);
      routeButton.setAttribute('aria-pressed', 'false');
      routeButton.textContent = 'Run again';
    }
  };
  advance();
  routeTimer = setInterval(advance, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 850);
});

const commands = {
  both: [
    'torch bootstrap \\',
    '  --repo /path/to/project \\',
    '  --spec /path/to/product-spec.md \\',
    '  --output fleet-design-brief.json \\',
    '  --json',
  ].join('\n'),
  repo: [
    'torch bootstrap \\',
    '  --repo /path/to/project \\',
    '  --output fleet-design-brief.json \\',
    '  --json',
  ].join('\n'),
};
const command = document.querySelector('#start-command');
const commandTabs = [...document.querySelectorAll('[data-command]')];
function selectCommand(button) {
  commandTabs.forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab === button));
    tab.tabIndex = tab === button ? 0 : -1;
  });
  command.textContent = commands[button.dataset.command];
  command.setAttribute('aria-labelledby', button.id);
}
commandTabs.forEach((button, buttonIndex) => {
  button.addEventListener('click', () => selectCommand(button));
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const target = commandTabs[(buttonIndex + offset + commandTabs.length) % commandTabs.length];
    selectCommand(target);
    target.focus();
  });
});
document.querySelector('#copy-command')?.addEventListener('click', async (event) => {
  try {
    await navigator.clipboard.writeText(command.textContent);
    event.currentTarget.textContent = 'Copied';
  } catch {
    event.currentTarget.textContent = 'Copy unavailable';
  }
  setTimeout(() => { event.currentTarget.textContent = 'Copy command'; }, 1500);
});
