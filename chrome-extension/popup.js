const GT_API = 'https://api.g2.galactictycoons.com';

const viewSetup     = document.getElementById('view-setup');
const viewConnected = document.getElementById('view-connected');
const apiKeyInput   = document.getElementById('api-key-input');
const btnConnect    = document.getElementById('btn-connect');
const setupErr      = document.getElementById('setup-err');
const infoCompany   = document.getElementById('info-company');
const infoGuild     = document.getElementById('info-guild');
const btnReset      = document.getElementById('btn-reset');

// ── Init ──────────────────────────────────────────────────────────────────────

chrome.storage.local.get(['gTag', 'companyName'], ({ gTag, companyName }) => {
  if (gTag) {
    showConnected(companyName || '—', gTag);
  } else {
    showSetup();
  }
});

// ── Views ─────────────────────────────────────────────────────────────────────

function showSetup() {
  viewSetup.style.display = '';
  viewConnected.style.display = 'none';
  setupErr.textContent = '';
  apiKeyInput.value = '';
}

function showConnected(companyName, gTag) {
  viewSetup.style.display = 'none';
  viewConnected.style.display = '';
  infoCompany.textContent = companyName;
  infoGuild.textContent = gTag;
}

// ── Connect ───────────────────────────────────────────────────────────────────

btnConnect.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) return;

  setupErr.textContent = '';
  btnConnect.disabled = true;
  btnConnect.textContent = 'Connecting…';

  try {
    const r1 = await fetch(`${GT_API}/public/company?apikey=${encodeURIComponent(key)}`);
    if (!r1.ok) throw new Error(`GT API error ${r1.status} — check your key`);
    const company = await r1.json();

    const companyId   = company.id ?? company.cId ?? company.companyId;
    const companyName = company.name ?? company.companyName ?? company.cName ?? '';
    if (!companyId) throw new Error('Could not read company ID from GT API response');

    const r2 = await fetch(`${GT_API}/public/company/${companyId}/detail`);
    if (!r2.ok) throw new Error(`GT API error ${r2.status} on company detail`);
    const detail = await r2.json();

    const gTag = detail.gTag ?? detail.guild_tag ?? detail.guildTag ?? detail.tag ?? '';
    if (!gTag) throw new Error('No guild tag found — are you in a guild?');

    await chrome.storage.local.set({ gTag, companyName });
    showConnected(companyName, gTag);
  } catch (e) {
    setupErr.textContent = e.message;
  } finally {
    btnConnect.disabled = false;
    btnConnect.textContent = 'Connect';
  }
});

// ── Sign Out ──────────────────────────────────────────────────────────────────

btnReset.addEventListener('click', async () => {
  await chrome.storage.local.remove(['gTag', 'companyName']);
  showSetup();
});
