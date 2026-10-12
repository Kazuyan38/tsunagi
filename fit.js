// 画面の幅に合わせて PC 版 / スマホ版を選ぶ（端末の種類ではなく、実際の表示幅で）。#… は引き継ぐ。
// 狭い窓や縦向きのタブレットで PC 版が切れる・広い画面でスマホ版が間延びする、を防ぐ。
(() => {
  const here = /\/m\.html$/.test(location.pathname) ? "m" : /\/pc\.html$/.test(location.pathname) ? "pc" : "";
  if (!here) return;
  const phone = /iPhone|iPod|Android.+Mobile|Windows Phone/i.test(navigator.userAgent);
  // 行き来で揺れないよう、PC→スマホは 720px 未満、スマホ→PC は 900px 以上にする（スマホ端末は常にスマホ版）
  const want = () => phone || innerWidth < (here === "pc" ? 720 : 900) ? "m" : "pc";
  const go = () => { if (want() !== here) location.replace((here === "pc" ? "m" : "pc") + ".html" + location.hash); };
  go();
  let t; addEventListener("resize", () => { clearTimeout(t); t = setTimeout(go, 500); });
})();
