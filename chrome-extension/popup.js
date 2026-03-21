const dot         = document.getElementById('dot');
const statusLabel = document.getElementById('status-label');
const infoLine    = document.getElementById('info-line');
const infoGuild   = document.getElementById('info-guild');
const infoCompany = document.getElementById('info-company');
const toggle      = document.getElementById('toggle');

// ── Init ──────────────────────────────────────────────────────────────────────

chrome.storage.local.get(['gTag', 'companyName', 'enabled'], (data) => {
  // Default enabled = true if never set
  const enabled = data.enabled !== false;
  render(enabled, data.gTag, data.companyName);
});

// ── Render ────────────────────────────────────────────────────────────────────

function render(enabled, gTag, companyName) {
  toggle.checked = enabled;

  if (enabled && gTag) {
    dot.className = 'dot on';
    statusLabel.className = 'status-label on';
    statusLabel.textContent = 'Connected';
    infoGuild.textContent = gTag;
    infoCompany.textContent = companyName || '—';
    infoLine.style.display = '';
  } else if (enabled) {
    dot.className = 'dot on';
    statusLabel.className = 'status-label on';
    statusLabel.textContent = 'Connected';
    infoLine.style.display = 'none';
  } else {
    dot.className = 'dot off';
    statusLabel.className = 'status-label off';
    statusLabel.textContent = 'Disconnected';
    infoLine.style.display = 'none';
  }
}

// ── Toggle ────────────────────────────────────────────────────────────────────

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.storage.local.get(['gTag', 'companyName'], (data) => {
    chrome.storage.local.set({ enabled });
    render(enabled, data.gTag, data.companyName);
  });
});
