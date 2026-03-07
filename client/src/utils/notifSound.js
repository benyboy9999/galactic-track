export function playNotificationChime() {
  try {
    const enabled = localStorage.getItem('notifSoundEnabled');
    if (enabled === 'false') return;
    const volume = parseFloat(localStorage.getItem('notifVolume') ?? '0.4');

    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Two-tone chime: high note then slightly lower
    [[880, 0, 0.12], [1100, 0.1, 0.18]].forEach(([freq, startOffset, duration]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.start(t);
      osc.stop(t + duration);
    });
  } catch { /* ignore — AudioContext not available */ }
}
