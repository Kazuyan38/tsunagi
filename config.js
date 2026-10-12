/* owl — 接続先。ここにあるのは「公開してよい」値だけ（anon キーは RLS 前提で公開用）。
 * 秘密（service role キー・Gmail アプリパスワード・各自のタスクバスタートークン）はサーバ側にしか置かない。 */
window.TSUNAGI = {
  url: "https://fgqmbgmukyvgonzczsgh.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZncW1iZ211a3l2Z29uemN6c2doIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MzA5MDgsImV4cCI6MjEwNzMwNjkwOH0.Zd4vwu8zcrJ70ZgqvXe0VKnUdoUDHbBx403W51c9VdE",
  maxUploadMB: 50,   // Supabase 無料枠のアップロード上限
  // Web Push の VAPID 公開鍵（公開してよい値。対になる秘密鍵はサーバの push_config にだけある）
  vapidPublicKey: "BAb25k2J0b-voGKfysCVhhb3C7De5wOKHrEaXxyqf2s6x957E-kTp_CMRWR6sOckaUl2y5IKB2zP1Rsz2yFFYas",
};
