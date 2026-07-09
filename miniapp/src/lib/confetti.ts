// Self-contained canvas confetti burst for win / settle moments. No deps.
// Respects prefers-reduced-motion. Call `celebrate()` on a successful claim.
export function celebrate(durationMs = 1400): void {
  if (typeof document === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
  };
  resize();

  // sticker-book palette
  const colors = ['#ffd23f', '#2fb84f', '#e0392b', '#2f6fd0', '#ffffff'];
  const cx = canvas.width / 2;
  const N = 120;
  const bits = Array.from({ length: N }, (_, i) => {
    const ang = (i / N) * Math.PI * 2;
    const speed = (3 + (i % 6)) * dpr;
    return {
      x: cx,
      y: canvas.height * 0.34,
      vx: Math.cos(ang) * speed * (0.6 + Math.random() * 0.8),
      vy: Math.sin(ang) * speed * (0.6 + Math.random() * 0.8) - 4 * dpr,
      s: (4 + (i % 4) * 2) * dpr,
      col: colors[i % colors.length],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
    };
  });

  const start = performance.now();
  function frame(now: number) {
    const t = now - start;
    const life = Math.min(1, t / durationMs);
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    for (const b of bits) {
      b.vy += 0.18 * dpr; // gravity
      b.x += b.vx;
      b.y += b.vy;
      b.rot += b.vr;
      ctx!.save();
      ctx!.translate(b.x, b.y);
      ctx!.rotate(b.rot);
      ctx!.globalAlpha = 1 - life;
      ctx!.fillStyle = b.col;
      ctx!.fillRect(-b.s / 2, -b.s / 2, b.s, b.s * 1.6);
      ctx!.restore();
    }
    if (t < durationMs) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
