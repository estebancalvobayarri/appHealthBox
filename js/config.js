// Configuración de conexión con Supabase.
// Copia estos dos valores de Supabase → Project Settings → API.
// La "anon public key" es pública por diseño: la base de datos solo deja
// usar las funciones de la app, que piden sesión en cada llamada.
//
// Mientras estén vacíos, la app funciona en MODO DEMOSTRACIÓN
// (todo se guarda solo en el navegador).
window.HORAFIT_CONFIG = {
  SUPABASE_URL: "",       // p. ej. "https://abcdefghijklm.supabase.co"
  SUPABASE_ANON_KEY: "",  // p. ej. "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...."
};
