// ==UserScript==
// @name         Steam Fix RU
// @namespace    Steam Fix RU
// @version      1.0
// @author		Danzo
// @updateURL	https://danzogit.github.io/dy/Steam-Fix-RU.user.js
// @description  Убирает параметр `l=russian` из URL для CSS
// @match        *://store.steampowered.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    function removeLanguageParam() {
        // Находим все ссылки на CSS
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
