# HealthBox · app

App de [HealthBox](https://github.com/estebancalvobayarri/HealthBox): web-app instalable (se ve como una app al añadirla a la pantalla de inicio) con los vídeos de pausas activas para las empresas.

- **Empleados** (`index.html`): entran con el nombre y la contraseña de su empresa (una sola vez por dispositivo) y después con su usuario y contraseña. Ven la lista de vídeos y su progreso.
- **Registro**: cada vez que un usuario ve un vídeo **hasta el final**, queda guardado quién, qué vídeo y cuándo. Saltar hacia delante no cuenta: hay que haber reproducido al menos el 90 % de los segundos del vídeo. Si no hay conexión en ese momento, se guarda y se envía cuando vuelve.
- **Administración** (`admin.html`): crear y editar empresas, usuarios y vídeos, y consultar el registro con filtros, resumen por persona y descarga para Excel.

Mientras no se configure Supabase, la app funciona en **modo demostración** (los datos se guardan solo en el navegador).
- App: empresa `Demo`, contraseña `demo123`; usuario `ana`, contraseña `demo123`.
- Panel: usuario `admin`, contraseña `admin123`.

## Puesta en marcha

### 1. Crear la base de datos (Supabase, gratis)
1. Crea una cuenta en [supabase.com](https://supabase.com) y un proyecto nuevo (región: *West EU* o *Central EU*).
2. En el proyecto, abre **SQL Editor**, pega el contenido de [`supabase/setup.sql`](supabase/setup.sql) y pulsa **Run**.
3. En ese mismo editor, crea tu usuario de administración (cambia los datos):
   ```sql
   select horafit.create_admin('tu-usuario', 'tu-contraseña-segura');
   ```

### 2. Conectar la app
1. En Supabase copia la **Project URL** (Project Settings → Data API) y la **Publishable key** (Project Settings → API Keys). También sirve la antigua clave **anon public**.
2. Pégalas en [`js/config.js`](js/config.js) y guarda el cambio en GitHub.

La clave *anon* es pública por diseño. Las tablas están en un esquema privado y solo se puede acceder a través de funciones que comprueban la sesión en cada llamada. Las contraseñas se guardan cifradas (bcrypt), y tras 10 intentos fallidos se bloquea el acceso durante 15 minutos.

### 3. Publicar la web (GitHub Pages)
En el repositorio: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
En un par de minutos estará en `https://estebancalvobayarri.github.io/appHora-Fit/` (el panel, en `…/admin.html`).

### 4. Primeros pasos en el panel
1. Entra en `admin.html` con tu usuario de administración.
2. **Empresas y usuarios**: crea la empresa y sus usuarios.
3. **Vídeos**: sustituye los cuatro vídeos de prueba por los tuyos. Valen enlaces de YouTube (pueden ser «ocultos») o de archivos `.mp4`.
4. Da a cada empleado el nombre y la contraseña de la empresa, más su usuario y su contraseña.

## Instalar en el móvil
- **Android (Chrome)**: aparece el botón «Instalar HealthBox» al final de la lista, o bien Menú ⋮ → «Instalar aplicación».
- **iPhone (Safari)**: botón Compartir → «Añadir a pantalla de inicio».

## Estructura
```
index.html            App de empleados
admin.html            Panel de administración
css/styles.css        Estilos
js/config.js          Conexión con Supabase (rellenar)
js/api.js             Llamadas a Supabase y simulación del modo demo
js/app.js             Lógica de la app y seguimiento de vídeos
js/admin.js           Lógica del panel
sw.js                 Service worker (instalación y uso sin conexión)
manifest.webmanifest  Datos de la app instalable
supabase/setup.sql    Base de datos completa
```

Si cambias archivos de la app, sube el número de `VERSION` en `sw.js` para que los móviles reciban la versión nueva.
