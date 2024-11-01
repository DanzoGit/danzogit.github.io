// ==UserScript==
// @name         Remove Language Parameter
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Убирает параметр `l=russian` из URL ресурсов на этапе загрузки
// @match        *://store.steampowered.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    function removeLanguageParam() {
        // Находим все ссылки на CSS-файлы и другие ресурсы
        document.querySelectorAll('link[rel="stylesheet"], script').forEach(resource => {
            let url = new URL(resource.href);
            if (url.searchParams.get('l') === 'russian') {
                url.searchParams.delete('l');
                resource.href = url.toString(); // Обновляем URL ресурса
            }
        });
    }

    // Запускаем функцию сразу при загрузке страницы
    removeLanguageParam();

    // Используем MutationObserver для обработки новых ресурсов, добавленных динамически
    // const observer = new MutationObserver(removeLanguageParam);
    // observer.observe(document.head || document.documentElement, { childList: true, subtree: true });
})();
