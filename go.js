// 端末と画面の幅に合わせて PC 版 / スマホ版へ振り分ける（URL の #… はそのまま引き継ぐ）
location.replace((/iPhone|iPod|Android.+Mobile|Windows Phone/i.test(navigator.userAgent) || innerWidth < 720 ? "m.html" : "pc.html") + location.hash);
