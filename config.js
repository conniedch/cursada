// Con estos dos datos vacíos, Cursada usa el servidor local (server.js).
// Al completarlos, usa Supabase. La clave "anon" o "publishable" es pública por diseño:
// lo que protege los datos son las reglas de supabase/schema.sql.
// Nunca pegues acá la clave "service_role" o "secret".
window.CURSADA_CONFIG = {
  supabaseUrl: 'https://sxdzqwzlusxuqgnkthia.supabase.co',
  supabaseAnonKey: 'sb_publishable_hH8kdS2gaehvuKMGJo9_2w_zJOd13ub',
};
