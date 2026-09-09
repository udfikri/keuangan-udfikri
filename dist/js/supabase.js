(function () {
  "use strict";

  const config = window.APP_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/i.test(config.SUPABASE_URL || "")
    && config.SUPABASE_ANON_KEY
    && !config.SUPABASE_ANON_KEY.includes("ISI_");

  window.supabaseConfigured = Boolean(configured);
  window.supabaseClient = configured
    ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;
})();
