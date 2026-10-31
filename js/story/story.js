// story.js — runs Story mode: chapter panel, navigation, and the prediction question.

import katex from 'katex';
import { CHAPTERS } from './chapters.js';

const $ = (id) => document.getElementById(id);

/** Render one equation (display style). */
export function renderTex(element, tex) {
  katex.render(tex, element, { displayMode: true, throwOnError: false });
}

/** Render text that contains $inline math$. */
export function renderMixed(element, text) {
  element.innerHTML = text
    .split(/(\$[^$]+\$)/)
    .map((part) =>
      part.startsWith('$')
        ? katex.renderToString(part.slice(1, -1), { throwOnError: false })
        : escapeHtml(part),
    )
    .join('');
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createStory(app) {
  const el = {
    panel: $('chapter'),
    number: $('chapter-number'),
    title: $('chapter-title'),
    text: $('chapter-text'),
    eq: $('chapter-eq'),
    action: $('chapter-action'),
    nav: $('story-nav'),
    prev: $('story-prev'),
    next: $('story-next'),
    dots: $('story-dots'),
    predict: $('predict'),
    question: $('predict-question'),
    options: $('predict-options'),
    feedback: $('predict-feedback'),
    go: $('predict-go'),
  };

  let index = -1;
  let predictionAnswered = false;

  // One dot per chapter; clicking a dot jumps there.
  const dots = CHAPTERS.map((chapter, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'dot';
    dot.setAttribute('aria-label', `Chapter ${i + 1}: ${chapter.title}`);
    dot.addEventListener('click', () => go(i));
    el.dots.appendChild(dot);
    return dot;
  });

  el.prev.addEventListener('click', () => prev());
  el.next.addEventListener('click', () => next());
  el.action.addEventListener('click', () => CHAPTERS[index]?.action?.run(app));

  function go(i) {
    if (i < 0 || i >= CHAPTERS.length) return;
    if (index >= 0) CHAPTERS[index].exit?.(app);
    index = i;
    const chapter = CHAPTERS[i];
    app.state.formationTime = Infinity; // finish Chapter 1's animation if it was still playing

    app.configure({
      shot: chapter.shot,
      layers: chapter.layers,
      control: chapter.control,
      vMax: chapter.vMax,
      breakdown: !!chapter.breakdown,
      graph: chapter.graph,
    });
    app.setChapterHint(chapter.hint ?? null);

    el.panel.hidden = false;
    el.nav.hidden = false;
    el.number.textContent = String(i + 1).padStart(2, '0');
    el.title.textContent = chapter.title;
    el.text.textContent = chapter.text;
    renderTex(el.eq, chapter.tex(app.junction));
    el.action.hidden = !chapter.action;
    if (chapter.action) el.action.textContent = chapter.action.label;
    replayEntrance(el.panel);

    dots.forEach((d, k) => d.setAttribute('aria-current', k === i ? 'step' : 'false'));
    el.prev.disabled = i === 0;
    el.next.textContent = i === CHAPTERS.length - 1 ? 'Open the lab' : 'Next';

    chapter.enter?.(app);

    if (chapter.prediction && !predictionAnswered) showPrediction(chapter);
    else {
      hidePrediction();
      chapter.afterPrediction?.(app);
    }
  }

  // ---------------------------------------------------------- prediction

  function showPrediction(chapter) {
    const p = chapter.prediction;
    app.setControlEnabled(false);
    el.text.hidden = el.eq.hidden = true;
    el.predict.hidden = false;
    replayEntrance(el.predict);
    renderMixed(el.question, p.question);
    el.feedback.textContent = '';
    el.go.hidden = true;
    el.options.replaceChildren(
      ...p.options.map((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'option';
        button.textContent = option.label;
        button.addEventListener('click', () => answer(chapter, option));
        return button;
      }),
    );
  }

  function answer(chapter, chosen) {
    const p = chapter.prediction;
    [...el.options.children].forEach((button, k) => {
      const option = p.options[k];
      button.disabled = true;
      button.classList.toggle('correct', option.correct);
      button.classList.toggle('chosen', option === chosen);
    });
    renderMixed(el.feedback, chosen.correct ? p.right : p.wrong);
    el.go.hidden = false;
    el.go.focus();
  }

  el.go.addEventListener('click', () => {
    predictionAnswered = true;
    hidePrediction();
    app.setControlEnabled(true);
    CHAPTERS[index].afterPrediction?.(app);
  });

  function hidePrediction() {
    el.predict.hidden = true;
    el.text.hidden = el.eq.hidden = false;
  }

  // -------------------------------------------------------------- public

  function next() {
    if (index === CHAPTERS.length - 1) app.setMode('lab');
    else go(index + 1);
  }
  function prev() {
    go(index - 1);
  }

  return {
    start: (i = 0) => go(i),
    stop() {
      if (index >= 0) CHAPTERS[index].exit?.(app);
      index = -1;
      el.panel.hidden = el.nav.hidden = el.predict.hidden = true;
    },
    next,
    prev,
    update(dt, reading) {
      if (index >= 0) CHAPTERS[index].update?.(app, dt, reading);
    },
    /** Parameters changed: re-render the equation with the new numbers. */
    refresh() {
      if (index >= 0) renderTex(el.eq, CHAPTERS[index].tex(app.junction));
    },
    current: () => index,
  };
}

/** Restart the CSS entrance animation of an element. */
function replayEntrance(element) {
  element.classList.remove('enter');
  void element.offsetWidth; // force a reflow so the animation restarts
  element.classList.add('enter');
}
