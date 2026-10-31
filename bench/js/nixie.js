// nixie.js — a row of glowing nixie tubes (the orange gas-discharge digits of the 1950s).

export function createNixie(container, tubes = 4) {
  const cells = Array.from({ length: tubes }, () => {
    const tube = document.createElement('div');
    tube.className = 'tube';
    tube.innerHTML = '<span class="ghost">8</span><span class="digit"></span><span class="point" hidden></span>';
    container.appendChild(tube);
    return { digit: tube.querySelector('.digit'), point: tube.querySelector('.point') };
  });
  let shown = '';

  /** text like "012.5" (the '.' lights the decimal point of the tube before it) or "OVL". */
  function set(text) {
    if (text === shown) return;
    shown = text;
    const chars = [];
    for (const c of text) {
      if (c === '.' && chars.length) chars[chars.length - 1].point = true;
      else chars.push({ c, point: false });
    }
    cells.forEach((cell, i) => {
      const ch = chars[i] ?? { c: '', point: false };
      cell.digit.textContent = ch.c;
      cell.point.hidden = !ch.point;
    });
  }

  return { set, setWarning: (on) => container.classList.toggle('warning', on) };
}
