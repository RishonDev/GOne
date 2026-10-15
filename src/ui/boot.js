'use strict';
// ---- rasterize icons for the main process (window / notification / tray icons) ----
function svgToImage(svg) {
  return new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej;
    i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
async function rasterAll() {
  const out = {};
  for (const [id, svg] of [...APPS.map((a) => [a.id, iconSvg(a, 256)]), ['gone', hubIconSvg(256)]]) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    c.getContext('2d').drawImage(await svgToImage(svg), 0, 0, 256, 256);
    out[id] = c.toDataURL('image/png');
  }
  gone.sendIcons(out);
}
async function renderTray(total) {
  const N = 64, c = document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d');
  ctx.drawImage(await svgToImage(hubIconSvg(N)), 0, 0, N, N);
  if (total > 0) {
    const r = 22, x = N - r + 2, y = N - r + 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#EA4335'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '700 28px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(total > 99 ? '99' : String(total), x, y + 2);
  }
  gone.sendTrayIcon(c.toDataURL('image/png'));
}

(async function boot() {
  buildRail();
  const s = await gone.state();
  Object.assign(S, s);
  paintBadges(true); paintAccount();

  gone.onState((st) => {
    const wasIn = S.auth.signedIn;
    Object.assign(S, st);
    paintBadges(); paintAccount(); repaintView();
    if (wasIn && !st.auth.signedIn) go('account');
  });
  gone.onNavigate(navigate);
  gone.onRenderTray(renderTray);
  setInterval(repaintView, 30000);

  await go('home');
  rasterAll().then(() => renderTray(0));
})();
