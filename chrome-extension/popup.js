const viewConnected    = document.getElementById('view-connected');
const viewNotConnected = document.getElementById('view-not-connected');
const infoCompany      = document.getElementById('info-company');
const infoGuild        = document.getElementById('info-guild');
const btnReset         = document.getElementById('btn-reset');

// ── Init ──────────────────────────────────────────────────────────────────────

chrome.storage.local.get(['gTag', 'companyName'], ({ gTag, companyName }) => {
  if (gTag) {
    showConnected(companyName || '—', gTag);
  } else {
    showNotConnected();
  }
});

// ── Views ─────────────────────────────────────────────────────────────────────

function showConnected(companyName, gTag) {
  viewConnected.style.display = '';
  viewNotConnected.style.display = 'none';
  infoCompany.textContent = companyName;
  infoGuild.textContent = gTag;
}

function showNotConnected() {
  viewConnected.style.display = 'none';
  viewNotConnected.style.display = '';
}

// ── Sign Out ──────────────────────────────────────────────────────────────────

btnReset.addEventListener('click', async () => {
  await chrome.storage.local.remove(['gTag', 'companyName']);
  showNotConnected();
});
