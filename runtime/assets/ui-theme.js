/* 屏幕彼端 · 全页面配色加载：只设置 data-theme，不改内容 */
(function () {
  function apply(id) {
    document.documentElement.dataset.theme = id || 'warm';
  }
  try {
    fetch('/api/ui-theme', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { apply(j && j.current); })
      .catch(function () { apply('warm'); });
  } catch (e) { apply('warm'); }
})();
