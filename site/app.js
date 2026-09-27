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
    'node bin/torch.mjs bootstrap \\',
    '  --repo /path/to/project \\',
    '  --spec /path/to/product-spec.md \\',
    '  --output fleet-design-brief.json \\',
    '  --json',
  ].join('\n'),
  repo: [
    'node bin/torch.mjs bootstrap \\',
    '  --repo /path/to/project \\',
    '  --output fleet-design-brief.json \\',
    '  --json',
  ].join('\n'),
};
const command = document.querySelector('#start-command');
document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-command]').forEach((tab) => tab.setAttribute('aria-selected', String(tab === button)));
  command.textContent = commands[button.dataset.command];
}));
document.querySelector('#copy-command')?.addEventListener('click', async (event) => {
  await navigator.clipboard.writeText(command.textContent);
  event.currentTarget.textContent = 'Copied';
  setTimeout(() => { event.currentTarget.textContent = 'Copy command'; }, 1500);
});
