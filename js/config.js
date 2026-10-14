// Configuración de conexión con Supabase.
// Copia estos dos valores de Supabase → Project Settings → API Keys / Data API.
// Sirve la "Publishable key" (sb_publishable_…) o la antigua "anon public".
// Esa clave es pública por diseño: la base de datos solo deja
// usar las funciones de la app, que piden sesión en cada llamada.
//
// Mientras estén vacíos, la app funciona en MODO DEMOSTRACIÓN
// (todo se guarda solo en el navegador).
window.HORAFIT_CONFIG = {
  SUPABASE_URL: "https://fzkeavlhhpphvdstmocn.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_q_Rh43zUbcMCO8UYyHydDQ_jGFlBLBL",
};
