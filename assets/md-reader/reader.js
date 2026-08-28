/* ============================================================
   Читалка Markdown: логика
   Работает в паре с reader.css. Настройки страницы задаются
   объектом window.MD_READER до подключения этого файла.
   Ожидаются подключенными: marked, highlight.js.
   ============================================================ */

(function () {
  'use strict';

  // ---------- Настройки ----------
  const DEFAULTS = {
    // Имя файла Markdown. Пусто = подобрать автоматически, см. candidates()
    md: '',
    // Имена, которые пробуются по очереди, если md не задан и не подошли
    // ни ?md=, ни имя страницы, ни имя папки
    fallbacks: ['README.md', 'index.md', 'FEATURES.md'],
    // Надпись над названием документа. Пусто = не показывать
    eyebrow: '',
    // Баннер над названием. Пусто = взять первую картинку документа,
    // если это разрешено настройкой coverFromFirstImage
    cover: '',
    // Приписка к заголовку окна браузера, например ' — badrocktv'
    titleSuffix: '',
    // Отступ сверху при переходе к разделу
    scrollOffset: 96,
    // Скорость чтения для оценки времени, слов в минуту
    wordsPerMinute: 180,
    // Первую картинку документа выносить в шапку как обложку
    coverFromFirstImage: true,
    // Разрешить открывать файл с компьютера: кнопка в панели, перетаскивание
    // в окно и стартовый экран, если рядом со страницей документа нет.
    // Работает только на страницах, где есть разметка #fileInput и #intro
    localFile: false,
  };

  const CONFIG = Object.assign({}, DEFAULTS, window.MD_READER || {});

  const $ = (id) => document.getElementById(id);
  const el = {
    article: $('article'), boot: $('boot'),
    cover: $('cover'), coverImg: $('coverImg'),
    docHead: $('docHead'), docTitle: $('docTitle'), docFacts: $('docFacts'), eyebrow: $('eyebrow'),
    railList: $('railList'), railCount: $('railCount'), barTitle: $('barTitle'),
    moon: $('moon'), readPct: $('readPct'),
    find: $('find'), findCount: $('findCount'),
    up: $('up'), navToggle: $('navToggle'), scrim: $('scrim'),
    themeBtn: $('themeBtn'), iMoon: $('iMoon'), iSun: $('iSun'),
    zoom: $('zoom'), zoomImg: $('zoomImg'), toast: $('toast'),
    fileInput: $('fileInput'), openBtn: $('openBtn'),
    intro: $('intro'), introPick: $('introPick'), introWarn: $('introWarn'),
  };

  // ============================================================
  //  Тема
  // ============================================================
  const hlDark = $('hljs-dark'), hlLight = $('hljs-light');

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const light = theme === 'light';
    if (hlDark) hlDark.media = light ? 'not all' : 'all';
    if (hlLight) hlLight.media = light ? 'all' : 'not all';
    el.iMoon.style.display = light ? 'none' : 'block';
    el.iSun.style.display = light ? 'block' : 'none';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = light ? '#e6e1d4' : '#191c19';
    try { localStorage.setItem('md-theme', theme); } catch (e) {}
  }
  applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');

  el.themeBtn.addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });

  // ============================================================
  //  Мелкие помощники
  // ============================================================
  let toastTimer = null;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1900);
  }

  function slugify(s) {
    return s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
  }

  function plural(num, forms) {
    const n = Math.abs(num) % 100, tail = n % 10;
    if (n > 4 && n < 20) return forms[2];
    if (tail === 1) return forms[0];
    if (tail > 1 && tail < 5) return forms[1];
    return forms[2];
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  const SAFE_NAME = /^[\w.\-]+\.md$/i;

  // Какие файлы пробовать и в каком порядке
  function candidates() {
    const list = [];
    const param = new URLSearchParams(location.search).get('md');
    if (param && SAFE_NAME.test(param)) list.push(param);
    if (CONFIG.md) list.push(CONFIG.md);

    // Имя страницы: b259.html → b259.md
    const page = location.pathname.split('/').pop() || '';
    if (/\.html?$/i.test(page) && !/^index\.html?$/i.test(page)) {
      list.push(page.replace(/\.html?$/i, '.md'));
    }
    // Имя папки: /patchnotes/3.0/ → 3.0.md
    const parts = location.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    const dir = /\.html?$/i.test(last) ? parts[parts.length - 2] : last;
    if (dir) list.push(decodeURIComponent(dir) + '.md');

    CONFIG.fallbacks.forEach((name) => list.push(name));
    return [...new Set(list.filter(Boolean))];
  }

  // ============================================================
  //  Загрузка файла
  // ============================================================
  try {
    hljs.registerAliases(['c#', 'cs'], { languageName: 'csharp' });
    hljs.registerAliases(['html'], { languageName: 'xml' });
    hljs.registerAliases(['sh', 'shell'], { languageName: 'bash' });
  } catch (e) {
    // Подсветка не загрузилась — код останется без цвета, текст читается
  }
  marked.setOptions({ gfm: true, breaks: false });

  let mdFile = '';

  async function load() {
    const tried = [];
    for (const name of candidates()) {
      tried.push(name);
      try {
        const res = await fetch(name, { cache: 'no-cache' });
        if (!res.ok) continue;
        mdFile = name;
        render(await res.text(), res.headers.get('last-modified'));
        return;
      } catch (e) {
        // Сеть или запрет браузера — пробуем следующее имя
      }
    }
    // Страница-читалка без своего документа: предлагаем открыть файл с диска
    if (CONFIG.localFile && el.intro) showIntro(new URLSearchParams(location.search).get('md'));
    else fail(tried);
  }

  // Стартовый экран вместо документа
  function showIntro(asked) {
    el.boot.hidden = true;
    el.intro.hidden = false;
    el.intro.classList.add('reveal');
    if (asked && SAFE_NAME.test(asked) && el.introWarn) {
      el.introWarn.textContent = 'Файла ' + asked + ' нет рядом со страницей. Откройте документ с компьютера.';
      el.introWarn.hidden = false;
    }
    el.railList.innerHTML = '<li><span class="rail-empty">Файл не выбран</span></li>';
    el.railCount.textContent = '—';
  }

  function fail(tried) {
    el.boot.innerHTML =
      '<div class="fail"><h2>Документ не найден</h2>' +
      '<p>Ни один файл не открылся. Пробовали: ' +
      tried.map((n) => '<code>' + escapeHtml(n) + '</code>').join(', ') + '.</p>' +
      '<p>Положите нужный файл рядом с этой страницей или укажите его в адресе: ' +
      '<code>?md=имя-файла.md</code>. Если страница открыта прямо с диска, браузер ' +
      'запрещает читать соседние файлы — откройте ее через локальный веб-сервер.</p></div>';
    el.railList.innerHTML = '<li><span class="rail-empty">Нет данных</span></li>';
  }

  // ============================================================
  //  Заголовок страницы из front matter
  // ============================================================
  // Необязательный блок в начале md:
  //   ---
  //   title: Название документа
  //   description: Короткое описание
  //   eyebrow: Надпись над названием
  //   cover: banner.png
  //   ---
  function readFrontMatter(md) {
    const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
    if (!match) return { meta: {}, body: md };
    const meta = {};
    match[1].split(/\r?\n/).forEach((line) => {
      const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
      if (pair) meta[pair[1].toLowerCase()] = pair[2].replace(/^["']|["']$/g, '').trim();
    });
    return { meta, body: md.slice(match[0].length) };
  }

  function setPageMeta(title, description) {
    if (title) document.title = title + (CONFIG.titleSuffix || '');
    if (!description) return;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = description;
  }

  // ============================================================
  //  Отрисовка
  // ============================================================
  let heads = [], links = [], linkById = new Map();

  function render(raw, lastModified) {
    const { meta, body } = readFrontMatter(raw);
    resetView();
    el.article.innerHTML = marked.parse(body);
    applyLocalImages();
    markMissingImages();

    buildHead(body, meta, lastModified);
    dressCode();
    dressTables();
    dressLinks();
    dressQuotes();
    dressImages();
    buildRail();

    el.boot.hidden = true;
    if (el.intro) el.intro.hidden = true;
    el.article.hidden = false;
    el.docHead.hidden = false;
    el.docHead.classList.add('reveal');
    el.article.classList.add('reveal');
    el.article.style.animationDelay = '.08s';

    initRail();
    initFind();
    updateRead();
    jumpToHash();
  }

  // Документ может смениться на другой: убираем следы прошлого
  function resetView() {
    el.find.value = '';
    resetFind(true);
    closeNav();
    activeId = null;
    holdUntil = 0;
    el.cover.hidden = true;
    el.coverImg.removeAttribute('src');
    el.docHead.classList.remove('reveal');
    el.article.classList.remove('reveal');
    el.article.style.animationDelay = '';
    window.scrollTo({ top: 0, behavior: 'auto' });
    void el.article.offsetWidth; // без пересчета верстки анимация не повторится
  }

  // Шапка: надпись, название, строка данных, обложка
  function buildHead(md, meta, lastModified) {
    const h1 = el.article.querySelector('h1');
    const title = meta.title || (h1 ? h1.textContent.trim() : mdFile.replace(/\.md$/i, ''));
    if (h1) h1.remove();

    const eyebrow = meta.eyebrow || CONFIG.eyebrow;
    el.eyebrow.textContent = eyebrow;
    el.eyebrow.hidden = !eyebrow;
    el.docTitle.textContent = title;
    el.barTitle.textContent = title;
    setPageMeta(title, meta.description);

    // Баннер: сначала заданный явно, иначе первая картинка документа.
    // У документа с диска берется только та картинка, которую принесли с ним
    const cover = meta.cover || CONFIG.cover;
    const coverSrc = cover ? (localSrc(cover) || (localDoc ? '' : cover)) : '';
    if (coverSrc) {
      el.coverImg.src = coverSrc;
      el.coverImg.alt = title;
      el.cover.hidden = false;
    } else if (!cover && CONFIG.coverFromFirstImage) {
      const img = el.article.querySelector('img');
      const firstH2 = el.article.querySelector('h2');
      const beforeFirstSection = img && (!firstH2 ||
        (img.compareDocumentPosition(firstH2) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (img && beforeFirstSection && !img.closest('table')) {
        el.coverImg.src = img.getAttribute('src');
        el.coverImg.alt = img.getAttribute('alt') || title;
        el.cover.hidden = false;
        const box = img.parentElement;
        img.remove();
        if (box && box !== el.article && !box.textContent.trim() && !box.querySelector('img')) box.remove();
      }
    }

    const words = md.trim().split(/\s+/).length;
    const minutes = Math.max(1, Math.round(words / CONFIG.wordsPerMinute));
    const sections = el.article.querySelectorAll('h2').length;

    const facts = [];
    if (sections) facts.push(sections + ' ' + plural(sections, ['раздел', 'раздела', 'разделов']));
    facts.push('~' + minutes + ' ' + plural(minutes, ['минута', 'минуты', 'минут']) + ' чтения');
    if (lastModified) {
      const date = new Date(lastModified);
      if (!isNaN(date)) {
        facts.push('обновлено ' + date.toLocaleDateString('ru-RU', {
          day: 'numeric', month: 'long', year: 'numeric',
        }));
      }
    }
    facts.push(mdFile);
    el.docFacts.innerHTML = facts.map(escapeHtml).join('<i>/</i>');
  }

  // Блоки кода: язык, подсветка, копирование
  function dressCode() {
    const alias = { 'c#': 'csharp', 'cs': 'csharp', 'sh': 'bash', 'shell': 'bash', 'html': 'xml' };
    el.article.querySelectorAll('pre > code').forEach((code) => {
      const pre = code.parentElement;
      const cls = [...code.classList].find((c) => c.startsWith('language-'));
      let lang = cls ? cls.slice(9) : '';
      const norm = alias[lang.toLowerCase()] || lang;
      if (norm && norm !== lang) {
        code.classList.remove('language-' + lang);
        code.classList.add('language-' + norm);
        lang = norm;
      }
      if (lang) pre.setAttribute('data-lang', lang);
      try { hljs.highlightElement(code); } catch (e) {}

      const btn = document.createElement('button');
      btn.className = 'copy';
      btn.type = 'button';
      btn.textContent = 'Копировать';
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(code.innerText).then(() => {
          btn.textContent = 'Скопировано';
          btn.classList.add('done');
          setTimeout(() => { btn.textContent = 'Копировать'; btn.classList.remove('done'); }, 1600);
        }).catch(() => toast('Браузер не дал доступ к буферу'));
      });
      pre.appendChild(btn);
    });
  }

  // Таблицы прокручиваются по горизонтали внутри рамки
  function dressTables() {
    el.article.querySelectorAll('table').forEach((table) => {
      if (table.parentElement.classList.contains('tbl')) return;
      const box = document.createElement('div');
      box.className = 'tbl';
      table.replaceWith(box);
      box.appendChild(table);
    });
  }

  // Ссылки на другие сайты открываются в новой вкладке
  function dressLinks() {
    el.article.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href) && a.hostname !== location.hostname) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.classList.add('out');
      }
    });
  }

  // Цитаты со словами-маркерами становятся выносками
  function dressQuotes() {
    el.article.querySelectorAll('blockquote').forEach((bq) => {
      const text = bq.textContent.trim().toLowerCase();
      if (/^(внимание|важно|осторожно|warning)/.test(text)) bq.classList.add('warn');
      else if (/^(примечание|заметка|подсказка|note)/.test(text)) bq.classList.add('note');
    });
  }

  // Картинки открываются на весь экран
  function dressImages() {
    el.article.querySelectorAll('img').forEach((img) => {
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('click', () => openZoom(img.currentSrc || img.src, img.alt));
    });
  }

  // Картинки, перетащенные вместе с документом, подставляются по имени файла:
  // относительные пути локального документа браузеру недоступны
  let localImages = new Map();
  // Документ открыт с диска, а не взят рядом со страницей
  let localDoc = false;

  function localSrc(src) {
    if (!localImages.size || !src || /^(https?:|data:|blob:)/i.test(src)) return '';
    const name = decodeURIComponent(src.split(/[?#]/)[0].split('/').pop() || '');
    return localImages.get(name.toLowerCase()) || '';
  }

  function applyLocalImages() {
    if (!localImages.size) return;
    el.article.querySelectorAll('img[src]').forEach((img) => {
      const url = localSrc(img.getAttribute('src'));
      if (url) img.src = url;
    });
  }

  // У документа с диска путь к картинке ведет в никуда: вместо битой ссылки
  // показываем имя нужного файла, чтобы его можно было принести следом
  function markMissingImages() {
    if (!localDoc) return;
    el.article.querySelectorAll('img[src]').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (/^(https?:|data:|blob:)/i.test(src)) return;

      const name = decodeURIComponent(src.split(/[?#]/)[0].split('/').pop() || src);
      const alt = (img.getAttribute('alt') || '').trim();

      const box = document.createElement('div');
      box.className = 'img-gap';
      box.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M4 5.5h16v13H4z"/><path d="M4 15l4.5-4.5L14 16"/><circle cx="15.5" cy="9.5" r="1.4"/>' +
        '</svg><div class="img-gap-body"><span class="img-gap-name">' + escapeHtml(name) + '</span>' +
        (alt ? '<span class="img-gap-alt">' + escapeHtml(alt) + '</span>' : '') +
        '<span class="img-gap-note">Картинка не открыта вместе с документом</span></div>';
      img.replaceWith(box);
    });
  }

  // ============================================================
  //  Оглавление
  // ============================================================
  function buildRail() {
    el.railList.innerHTML = '';
    heads = [...el.article.querySelectorAll('h2, h3')];
    const used = new Set();

    heads.forEach((h) => {
      const base = h.id || slugify(h.textContent) || 'razdel';
      let id = base, n = 2;
      while (used.has(id)) id = base + '-' + (n++);
      used.add(id);
      h.id = id;

      const anchor = document.createElement('a');
      anchor.className = 'anchor';
      anchor.href = '#' + id;
      anchor.textContent = '#';
      anchor.setAttribute('aria-label', 'Скопировать ссылку на раздел');
      anchor.addEventListener('click', (e) => {
        e.preventDefault();
        history.replaceState(null, '', '#' + id);
        const url = location.origin + location.pathname + location.search + '#' + id;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(() => toast('Ссылка на раздел скопирована')).catch(() => {});
        }
      });
      h.appendChild(anchor);

      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#' + id;
      a.textContent = h.textContent.replace(/#$/, '').trim();
      a.className = h.tagName === 'H3' ? 'sub' : '';
      a.dataset.target = id;
      li.appendChild(a);
      el.railList.appendChild(li);
    });

    if (!heads.length) el.railList.innerHTML = '<li><span class="rail-empty">Разделов нет</span></li>';

    links = [...el.railList.querySelectorAll('a')];
    linkById = new Map(links.map((a) => [a.dataset.target, a]));
    el.railCount.textContent = heads.length || '—';
  }

  // ============================================================
  //  Активный раздел и прочитанное
  // ============================================================
  let holdUntil = 0, activeId = null;

  function setActive(id, keepInView) {
    if (activeId === id) return;
    activeId = id;
    links.forEach((a) => { a.classList.remove('on'); a.removeAttribute('aria-current'); });
    const a = linkById.get(id);
    if (!a) return;
    a.classList.add('on');
    a.setAttribute('aria-current', 'true');
    if (keepInView) a.scrollIntoView({ block: 'nearest' });
  }

  function updateActive() {
    if (!heads.length || performance.now() < holdUntil) return;
    const line = window.scrollY + CONFIG.scrollOffset;
    let id = heads[0].id;
    for (const h of heads) {
      if (h.getBoundingClientRect().top + window.scrollY <= line) id = h.id;
      else break;
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      id = heads[heads.length - 1].id;
    }
    setActive(id, true);
  }

  // Луна восходит по мере чтения
  function updateRead() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 40 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
    const pct = Math.round(ratio * 100);
    el.moon.style.setProperty('--read', pct + '%');
    el.moon.classList.toggle('full', pct >= 99);
    el.moon.setAttribute('aria-label', 'Прочитано ' + pct + ' процентов');
    el.readPct.textContent = pct + '%';
    el.up.classList.toggle('show', window.scrollY > 560);
  }

  function scrollToElement(target, extraOffset) {
    const top = target.getBoundingClientRect().top + window.scrollY
      - CONFIG.scrollOffset - (extraOffset || 0);
    window.scrollTo({ top, behavior: 'smooth' });
  }

  let queued = false;
  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { updateActive(); updateRead(); queued = false; });
  }

  let scrollBound = false;
  function initRail() {
    links.forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.getElementById(a.dataset.target);
        if (!target) return;
        holdUntil = performance.now() + 900;
        setActive(a.dataset.target);
        scrollToElement(target);
        history.replaceState(null, '', '#' + a.dataset.target);
        closeNav();
      });
    });

    // Ссылки создаются заново для каждого документа, слушатели окна — один раз
    if (!scrollBound) {
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      scrollBound = true;
    }
    updateActive();
  }

  function jumpToHash() {
    if (!location.hash) return;
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!target) return;
    window.scrollTo({
      top: target.getBoundingClientRect().top + window.scrollY - CONFIG.scrollOffset,
      behavior: 'auto',
    });
    setActive(target.id, true);
  }

  // ============================================================
  //  Поиск по тексту
  // ============================================================
  let hits = [], hitIndex = -1, findTimer = null;

  function resetFind(showHint) {
    el.article.querySelectorAll('mark.hit').forEach((m) => {
      m.replaceWith(document.createTextNode(m.textContent));
    });
    el.article.normalize();
    links.forEach((a) => a.classList.remove('found'));
    hits = []; hitIndex = -1;
    if (showHint) {
      el.findCount.innerHTML = '<kbd>/</kbd>';
      el.findCount.classList.remove('empty');
    }
  }

  function runFind(raw) {
    resetFind(false);
    const query = raw.trim();
    if (query.length < 2) { resetFind(true); return; }

    const needle = query.toLowerCase();
    const walker = document.createTreeWalker(el.article, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest('pre') || parent.classList.contains('anchor')) {
          return NodeFilter.FILTER_REJECT;
        }
        return node.nodeValue.toLowerCase().includes(needle)
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach((node) => {
      const text = node.nodeValue;
      const lower = text.toLowerCase();
      const frag = document.createDocumentFragment();
      let from = 0, at;
      while ((at = lower.indexOf(needle, from)) !== -1) {
        if (at > from) frag.appendChild(document.createTextNode(text.slice(from, at)));
        const mark = document.createElement('mark');
        mark.className = 'hit';
        mark.textContent = text.slice(at, at + needle.length);
        frag.appendChild(mark);
        hits.push(mark);
        from = at + needle.length;
      }
      if (from < text.length) frag.appendChild(document.createTextNode(text.slice(from)));
      node.replaceWith(frag);
    });

    links.forEach((a) => {
      if (a.textContent.toLowerCase().includes(needle)) a.classList.add('found');
    });

    if (!hits.length) {
      el.findCount.textContent = 'нет';
      el.findCount.classList.add('empty');
      return;
    }
    el.findCount.classList.remove('empty');
    gotoHit(0);
  }

  function gotoHit(index) {
    if (!hits.length) return;
    if (hits[hitIndex]) hits[hitIndex].classList.remove('now');
    hitIndex = (index + hits.length) % hits.length;
    hits[hitIndex].classList.add('now');
    scrollToElement(hits[hitIndex], 40);
    el.findCount.textContent = (hitIndex + 1) + '/' + hits.length;
  }

  let findBound = false;
  function initFind() {
    if (findBound) return;
    findBound = true;
    el.find.addEventListener('input', () => {
      clearTimeout(findTimer);
      findTimer = setTimeout(() => runFind(el.find.value), 180);
    });
    el.find.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (hits.length) gotoHit(hitIndex + (e.shiftKey ? -1 : 1));
        else runFind(el.find.value);
      } else if (e.key === 'Escape') {
        el.find.value = '';
        resetFind(true);
        el.find.blur();
      }
    });
  }

  // ============================================================
  //  Разделы на телефоне, просмотр картинок, клавиатура
  // ============================================================
  function openNav() {
    document.body.classList.add('nav-open');
    el.navToggle.setAttribute('aria-expanded', 'true');
  }
  function closeNav() {
    document.body.classList.remove('nav-open');
    el.navToggle.setAttribute('aria-expanded', 'false');
  }
  el.navToggle.addEventListener('click', () => {
    if (document.body.classList.contains('nav-open')) closeNav();
    else openNav();
  });
  el.scrim.addEventListener('click', closeNav);

  function openZoom(src, alt) {
    el.zoomImg.src = src;
    el.zoomImg.alt = alt || '';
    el.zoom.classList.add('open');
  }
  function closeZoom() {
    el.zoom.classList.remove('open');
    el.zoomImg.removeAttribute('src');
  }
  el.zoom.addEventListener('click', closeZoom);
  el.cover.addEventListener('click', () => {
    if (el.coverImg.src) openZoom(el.coverImg.src, el.coverImg.alt);
  });

  el.up.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (el.zoom.classList.contains('open')) { closeZoom(); return; }
      if (document.body.classList.contains('nav-open')) { closeNav(); return; }
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      el.find.focus();
      el.find.select();
    }
  });

  // ============================================================
  //  Свой файл с компьютера
  // ============================================================
  const MD_EXT = /\.(md|markdown|mdown|txt)$/i;
  let blobUrls = [];

  function openPicker() {
    if (el.fileInput) el.fileInput.click();
  }

  // Из набора берется первый документ, остальные картинки идут к нему в комплект
  async function openLocal(fileList) {
    const files = [...fileList];
    const file = files.find((f) => MD_EXT.test(f.name));
    if (!file) {
      toast('Нужен файл .md, .markdown или .txt');
      return;
    }

    let text;
    try {
      text = await file.text();
    } catch (e) {
      toast('Файл не прочитался');
      return;
    }

    blobUrls.forEach(URL.revokeObjectURL);
    blobUrls = [];
    localImages = new Map();
    files.forEach((f) => {
      if (f === file || !/^image\//i.test(f.type)) return;
      const url = URL.createObjectURL(f);
      blobUrls.push(url);
      localImages.set(f.name.toLowerCase(), url);
    });

    // Ссылка на раздел прошлого документа к новому не относится
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);

    localDoc = true;
    mdFile = file.name;
    render(text, file.lastModified || '');
    toast('Открыт ' + file.name);
  }

  function initLocalFile() {
    if (!CONFIG.localFile || !el.fileInput) return;

    if (el.openBtn) {
      el.openBtn.hidden = false;
      el.openBtn.addEventListener('click', openPicker);
    }
    if (el.introPick) el.introPick.addEventListener('click', openPicker);

    el.fileInput.addEventListener('change', () => {
      if (el.fileInput.files.length) openLocal(el.fileInput.files);
      el.fileInput.value = ''; // иначе повторный выбор того же файла не сработает
    });

    // Курсор с файлом проходит через вложенные элементы, поэтому вход и выход
    // считаются, а не переключаются: иначе подсветка зоны мигает
    let depth = 0;
    const withFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const stopDrag = () => {
      depth = 0;
      document.body.classList.remove('dragging');
    };

    document.addEventListener('dragenter', (e) => {
      if (!withFiles(e)) return;
      depth++;
      document.body.classList.add('dragging');
    });
    document.addEventListener('dragover', (e) => {
      if (withFiles(e)) e.preventDefault();
    });
    document.addEventListener('dragleave', (e) => {
      if (withFiles(e) && --depth <= 0) stopDrag();
    });
    document.addEventListener('drop', (e) => {
      if (!withFiles(e)) return;
      e.preventDefault();
      stopDrag();
      openLocal(e.dataTransfer.files);
    });
  }

  initLocalFile();
  load();
})();
