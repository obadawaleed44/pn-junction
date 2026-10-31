// qr.js — draws a QR code for a URL onto a canvas, using the small qrcode-generator
// library (loaded by a <script> tag as the global `qrcode`).

export async function drawQR(canvas, text, { dark = '#05060d', light = '#ffffff' } = {}) {
  for (let i = 0; i < 50 && !window.qrcode; i++) await new Promise((r) => setTimeout(r, 100));
  const ctx = canvas.getContext('2d');
  if (!window.qrcode) {
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return false;
  }
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  const cell = Math.floor(canvas.width / (n + quiet * 2));
  const offset = Math.floor((canvas.width - cell * n) / 2);
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = dark;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
  }
  return true;
}
