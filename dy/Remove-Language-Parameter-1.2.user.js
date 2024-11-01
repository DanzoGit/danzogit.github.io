// ==UserScript==
// @name         Remove Language Parameter
// @namespace    Remove Language Parameter
// @version      1.2
// @updateURL	https://danzogit.github.io/dy/Remove-Language-Parameter-1.2.user.js
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
