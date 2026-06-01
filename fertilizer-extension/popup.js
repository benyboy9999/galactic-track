'use strict';

const toggle = document.getElementById('toggle');
const note   = document.getElementById('note');

chrome.storage.local.get(['gtFaOpen', 'gtExtApiKey'], ({ gtFaOpen, gtExtApiKey }) => {
  toggle.checked = !!gtFaOpen;

  if (!gtExtApiKey) {
    note.textContent = 'No API key — add it via the main GT extension ⚙ panel.';
    note.style.color = '#f87171';
  } else {
    note.textContent = gtFaOpen ? 'Panel visible on game pages.' : 'Panel hidden. Toggle to show.';
  }
});

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ gtFaOpen: toggle.checked });
  note.textContent = toggle.checked
    ? 'Panel enabled — refresh the game page.'
    : 'Panel disabled — refresh the game page.';
});
