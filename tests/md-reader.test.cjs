'use strict';

// Чистые части настоящего reader.js проверяются без браузерных зависимостей.
// Полная отрисовка и работа файлов дополнительно проверяются в Chrome.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const readerFile = path.join(__dirname, '../assets/md-reader/reader.js');
const source = fs.readFileSync(readerFile, 'utf8');
const section = (start, end) => {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Не найден участок ${start}`);
    return source.slice(from, to);
};
const helpers = () => section('function plural(', 'const SAFE_NAME');
const publishedAt = '2026-10-23T16:06:30.000Z';
const updatedAt = '2026-10-23T17:06:30.000Z';

function headContext() {
    const el = { article: { querySelector: () => null, querySelectorAll: () => [] }, eyebrow: {}, docTitle: {}, barTitle: {}, docFacts: {} };
    const context = vm.createContext({ el, mdFile: 'document.md', CONFIG: { eyebrow: '', cover: '', coverFromFirstImage: false, wordsPerMinute: 180 },
        localDoc: false, localSrc: () => '', setPageMeta: () => {} });
    vm.runInContext(helpers() + section('function buildHead(', '// Блоки кода:'), context);
    return context;
}

test('даты: ISO-время переводится в пояс клиента, календарная дата не сдвигается', () => {
    const code = `const vm=require('node:vm');const context=vm.createContext({});vm.runInContext(process.argv[1],context);
        console.log(JSON.stringify({timestamp:context.formatDocumentDate(process.argv[2]),calendar:context.formatDocumentDate('2026-10-23'),
        markup:context.dateMarkup(process.argv[2])}));`;
    const values = {};
    for (const zone of ['Europe/Moscow', 'Asia/Irkutsk']) {
        const child = spawnSync(process.execPath, ['-e', code, helpers(), publishedAt], { encoding: 'utf8', env: { ...process.env, TZ: zone }, timeout: 10000 });
        assert.equal(child.status, 0, child.stderr);
        values[zone] = JSON.parse(child.stdout);
        assert.ok(values[zone].markup.includes(`datetime="${publishedAt}"`));
    }
    assert.match(values['Europe/Moscow'].timestamp, /23 октября.*19:06/);
    assert.match(values['Asia/Irkutsk'].timestamp, /24 октября.*00:06/);
    assert.equal(values['Europe/Moscow'].calendar, values['Asia/Irkutsk'].calendar);
    assert.match(values['Asia/Irkutsk'].calendar, /23 октября/);
});

test('даты: пустые/некорректные значения не дают Invalid Date или разметку', () => {
    const context = vm.createContext({});
    vm.runInContext(helpers(), context);
    for (const value of ['', 'invalid', '2026-02-30', '<img src=x>', null, undefined]) {
        assert.equal(context.formatDocumentDate(value), '');
        assert.equal(context.dateMarkup(value), '');
    }
});

test('Steam-метаданные: posttime/updatetime имеют приоритет над Last-Modified сайта', () => {
    const context = headContext();
    context.buildHead('Тело документа.', { title: 'Новость', source_url: 'https://store.steampowered.com/news/app/251570/view/42',
        published_at: publishedAt, updated_at: updatedAt }, 'Mon, 26 Oct 2037 12:00:00 GMT');
    assert.ok(context.el.docFacts.innerHTML.includes(`datetime="${publishedAt}"`));
    assert.ok(context.el.docFacts.innerHTML.includes(`datetime="${updatedAt}"`));
    assert.ok(!context.el.docFacts.innerHTML.includes('2037'));
});

test('Steam-метаданные: отсутствующая дата не подменяется временем деплоя', () => {
    const context = headContext();
    context.buildHead('Тело документа.', { title: 'Новость', source_url: 'https://store.steampowered.com/news/app/251570/view/42' }, 'Mon, 26 Oct 2037 12:00:00 GMT');
    assert.ok(!context.el.docFacts.innerHTML.includes('<time'));
    assert.ok(!context.el.docFacts.innerHTML.includes('2037'));
});

test('обычный документ: собственные date/lastModified сохраняются, равные Steam-даты не дублируются', () => {
    const context = headContext();
    context.buildHead('Тело.', { date: '2026-10-23' }, 'Mon, 26 Oct 2037 12:00:00 GMT');
    assert.ok(context.el.docFacts.innerHTML.includes('datetime="2026-10-23"'));
    assert.ok(!context.el.docFacts.innerHTML.includes('2037'));
    context.buildHead('Тело.', {}, Date.parse(publishedAt));
    assert.ok(context.el.docFacts.innerHTML.includes(`datetime="${publishedAt}"`));
    context.buildHead('Тело.', { published_at: publishedAt, updated_at: publishedAt }, 'Mon, 26 Oct 2037 12:00:00 GMT');
    assert.equal((context.el.docFacts.innerHTML.match(/<time /g) || []).length, 1);
});

test('элементы time: видимый текст локализуется, исходный datetime остается', () => {
    const time = { value: publishedAt, textContent: publishedAt, getAttribute() { return this.value; } };
    const invalid = { value: 'invalid', textContent: 'Сохраненный текст', getAttribute() { return this.value; } };
    const context = vm.createContext({ document: { querySelectorAll: () => [time, invalid] } });
    vm.runInContext(helpers(), context);
    context.localizeTimes();
    assert.equal(time.value, publishedAt);
    assert.notEqual(time.textContent, publishedAt);
    assert.equal(invalid.textContent, 'Сохраненный текст');
});

test('оглавление: скрываются rail и кнопка, каркас возвращается при новом документе', () => {
    const classes = new Set();
    const el = { rail: {}, navToggle: { expanded: 'true' }, shell: { classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); } } } };
    const context = vm.createContext({ el, closeNav: () => { el.navToggle.expanded = 'false'; } });
    vm.runInContext(section('function setRailVisible(', 'function buildRail('), context);
    context.setRailVisible(false);
    assert.equal(el.rail.hidden, true);
    assert.equal(el.navToggle.hidden, true);
    assert.equal(el.navToggle.expanded, 'false');
    assert.ok(classes.has('no-rail'));
    context.setRailVisible(true);
    assert.equal(el.rail.hidden, false);
    assert.equal(el.navToggle.hidden, false);
    assert.ok(!classes.has('no-rail'));
});

test('оригинал: выбор нескольких файлов и изображений остается, пустая панель скрыта до загрузки', () => {
    const html = fs.readFileSync(path.join(__dirname, '../md-reader/index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../assets/md-reader/reader.css'), 'utf8');
    assert.match(html, /id="fileInput"[^>]*multiple/);
    assert.match(html, /localFile: true/);
    assert.match(html, /image\/\*/);
    assert.match(html, /class="shell no-rail"/);
    assert.match(html, /id="rail"[^>]*hidden/);
    assert.match(html, /id="navToggle"[^>]*hidden/);
    assert.match(css, /\.shell\.no-rail\s*\{/);
    assert.ok(!source.includes('badrocktv'));
});
