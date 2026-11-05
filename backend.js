// Conexión con los datos y las cuentas. La app pide siempre lo mismo;
// esto lo resuelve con el servidor local o con Supabase, según config.js.
(function () {
  const cfg = window.CURSADA_CONFIG || {};
  const useSupabase = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);

  // Lo que trae el link de un mail hay que leerlo antes de que la librería limpie la dirección.
  const fromLink = new URLSearchParams(location.hash.replace(/^#/, ''));
  const linkError = fromLink.get('error_description');
  let recovery = fromLink.get('type') === 'recovery';

  let sb = null;
  let token = null;

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('script'));
    document.head.append(s);
  });

  const can = { google: false, forgot: useSupabase, changeEmail: useSupabase };
  const ready = useSupabase
    ? loadScript('vendor/supabase.js').then(() => {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
      });
      sb.auth.onAuthStateChange((event, session) => {
        token = session ? session.access_token : null;
        if (event === 'PASSWORD_RECOVERY') recovery = true;
      });
      // El botón de Google aparece solo si está activado en el proyecto.
      return fetch(`${cfg.supabaseUrl}/auth/v1/settings`, { headers: { apikey: cfg.supabaseAnonKey } })
        .then((r) => r.json())
        .then((d) => { can.google = !!(d.external && d.external.google); })
        .catch(() => { can.google = false; });
    })
    : Promise.resolve();

  const MESSAGES = {
    invalid_credentials: 'El mail o la contraseña no coinciden.',
    email_not_confirmed: 'Todavía no confirmaste tu mail. Abrí el link que te mandamos.',
    over_email_send_rate_limit: 'Mandamos demasiados mails seguidos. Probá de nuevo en unos minutos.',
    over_request_rate_limit: 'Demasiados intentos. Probá de nuevo en unos minutos.',
    weak_password: 'Esa contraseña es muy débil. Probá con una más larga.',
    same_password: 'La contraseña nueva tiene que ser distinta de la actual.',
    email_exists: 'Ya hay una cuenta con ese mail.',
    user_already_exists: 'Ya hay una cuenta con ese mail. Probá iniciar sesión.',
    signup_disabled: 'Por ahora no se pueden crear cuentas nuevas.',
    email_address_invalid: 'Revisá el mail: no parece válido.',
  };
  const fail = (error, fallback) => {
    const status = error && (error.code === 'invalid_credentials' ? 401 : (error.status || 400));
    return { status: status >= 400 ? status : 400, data: { error: (error && MESSAGES[error.code]) || fallback } };
  };
  const home = () => location.origin + location.pathname;

  // ---------- Supabase
  async function me() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return { status: 401, data: { error: 'Sin sesión.' } };
    const u = session.user;
    const { data, error } = await sb.from('user_state').select('rev,state').eq('user_id', u.id).maybeSingle();
    if (error) throw error;
    const meta = u.user_metadata || {};
    const providers = (u.app_metadata && u.app_metadata.providers) || [];
    return {
      status: 200,
      data: {
        user: { email: u.email, name: meta.name || meta.full_name || '', hasPassword: providers.includes('email') },
        rev: data ? data.rev : 0,
        state: data ? data.state : null,
      },
    };
  }
  async function verifyPassword(password) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return false;
    const { error } = await sb.auth.signInWithPassword({ email: session.user.email, password });
    return !error;
  }
  const routes = {
    'GET /api/me': me,
    async 'POST /api/signup'(b) {
      if (String(b.password || '').length < 8) return { status: 400, data: { error: 'La contraseña tiene que tener al menos 8 caracteres.' } };
      const { data, error } = await sb.auth.signUp({ email: b.email, password: b.password, options: { data: { name: b.name }, emailRedirectTo: home() } });
      if (error) return fail(error, 'No se pudo crear la cuenta. Probá de nuevo.');
      if (!data.session) return { status: 202, data: { confirm: true, email: b.email } };
      return me();
    },
    async 'POST /api/login'(b) {
      const { error } = await sb.auth.signInWithPassword({ email: b.email, password: b.password });
      if (error) return fail(error, 'No se pudo entrar. Probá de nuevo.');
      return me();
    },
    async 'POST /api/logout'() {
      await sb.auth.signOut();
      return { status: 200, data: { ok: true } };
    },
    async 'PUT /api/state'(b) {
      const { data, error } = await sb.rpc('save_state', { p_state: b.state, p_rev: b.rev });
      if (error) {
        if (error.code === '28000') return { status: 401, data: { error: 'Tu sesión terminó.' } };
        throw error;
      }
      if (data.ok) return { status: 200, data: { rev: data.rev } };
      return { status: 409, data: { rev: data.rev, state: data.state } };
    },
    async 'POST /api/forgot'(b) {
      const { error } = await sb.auth.resetPasswordForEmail(b.email, { redirectTo: home() });
      if (error && error.code && error.code.startsWith('over_')) return fail(error, 'Probá de nuevo en unos minutos.');
      return { status: 200, data: { ok: true } }; // misma respuesta exista o no la cuenta
    },
    async 'POST /api/password'(b) {
      if (String(b.password || '').length < 8) return { status: 400, data: { error: 'La contraseña tiene que tener al menos 8 caracteres.' } };
      if (b.current !== undefined && !(await verifyPassword(b.current))) return { status: 401, data: { error: 'La contraseña actual no coincide.' } };
      const { error } = await sb.auth.updateUser({ password: b.password });
      if (error) return fail(error, 'No se pudo cambiar la contraseña.');
      recovery = false;
      return { status: 200, data: { ok: true } };
    },
    async 'POST /api/email'(b) {
      const { error } = await sb.auth.updateUser({ email: b.email }, { emailRedirectTo: home() });
      if (error) return fail(error, 'No se pudo cambiar el mail.');
      return { status: 200, data: { ok: true } };
    },
    async 'POST /api/account/delete'(b) {
      if (b.password !== undefined && !(await verifyPassword(b.password))) return { status: 401, data: { error: 'La contraseña no coincide.' } };
      const { error } = await sb.rpc('delete_my_account');
      if (error) return { status: 400, data: { error: 'No se pudo borrar la cuenta.' } };
      await sb.auth.signOut({ scope: 'local' });
      return { status: 200, data: { ok: true } };
    },
  };

  // ---------- Servidor local
  async function localRequest(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let data = {};
    try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
    return { status: res.status, data };
  }

  window.CursadaBackend = {
    ready,
    // Lo que se puede ofrecer en pantalla con cada forma de funcionar.
    can,
    linkError,
    isRecovery: () => recovery,
    async request(method, url, body) {
      await ready;
      if (!useSupabase) return localRequest(method, url, body);
      const route = routes[`${method} ${url}`];
      if (!route) return { status: 404, data: { error: 'No existe.' } };
      return route(body || {});
    },
    async google() {
      await ready;
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: home() } });
      if (error) throw error;
    },
    // Último guardado al cerrar la pestaña.
    beacon(state, rev) {
      if (!useSupabase) {
        fetch('/api/state', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, rev }) });
      } else if (token) {
        fetch(`${cfg.supabaseUrl}/rest/v1/rpc/save_state`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token}` }, body: JSON.stringify({ p_state: state, p_rev: rev }) });
      }
    },
  };
})();
