// 端末に合わせて PC 版 / スマホ版へ振り分ける（URL の #… はそのまま引き継ぐ）
location.replace((/iPhone|iPod|Android.+Mobile|Mobile Safari|Windows Phone/i.test(navigator.userAgent) ? "m.html" : "pc.html") + location.hash);
