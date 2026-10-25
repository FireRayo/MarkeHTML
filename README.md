# HTML Offline Store · V0.1.0

Primera versión de una **tienda comunitaria de aplicaciones independientes en un único archivo `.html`**, sin tarifas para publicar o descargar. La **tienda es un sitio web**; las aplicaciones que distribuye se descargan como archivos autocontenidos para uso offline.

**Stack:** HTML5 + CSS3 + JavaScript nativo (sin frameworks, librerías remotas, CDN ni Node.js en producción), Cloudflare Pages, Supabase Auth/PostgREST/Storage, GitHub OAuth.

## 1. Archivos

```text
html-offline-store/
├── public/
│   ├── index.html         # Estructura y diálogos accesibles
│   ├── styles.css         # Neomorfismo Light / Dark
│   ├── config.js          # Versión y configuración pública
│   ├── i18n.js            # en, es, it, pt-BR
│   ├── api.js             # Supabase HTTP/REST, Auth, Storage
│   ├── app.js             # Presentación, validación, navegación
│   └── assets/favicon.svg # Icono vectorial local
├── supabase/
│   └── schema.sql         # Tablas, permisos RLS, buckets y RPC
├── tests/
│   └── check_static.mjs   # Comprobaciones automatizadas sin dependencias
├── LICENSE
└── README.md
```

## 2. Requisitos previos (planes gratuitos)

1. Crear un proyecto en [Supabase](https://supabase.com/dashboard), anotando **Project URL** y **publishable key** (`sb_publishable_...`). Nunca usar `sb_secret_...`, `service_role` ni secretos OAuth en JavaScript público.
2. Abrir **SQL Editor** y ejecutar `supabase/schema.sql` íntegro. Esto crea tablas, reglas RLS, dos buckets y funciones RPC. El proyecto debe estar recién creado; si ya hay tablas personalizadas con estos nombres, revisar las migraciones antes de ejecutar.
3. Abrir `public/config.js` e introducir URL y clave pública:

```js
SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_TU-CLAVE'
```

La clave **publicable** necesariamente está disponible en el navegador: la protección la implementan los permisos SQL. Solo `config.js` centraliza estos valores. Los límites de 10 MB de HTML / 2 MB por captura deben coincidir con `schema.sql`.

## 3. GitHub OAuth

1. En Supabase → **Authentication → Sign In / Providers → GitHub**, copiar **Callback URL** de Supabase (`https://TU-PROYECTO.supabase.co/auth/v1/callback`).
2. En GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**, crear la app OAuth; poner la URL final de la tienda como homepage y la **Callback URL de Supabase**, no la página de Cloudflare, como *Authorization callback URL*.
3. Copiar el *Client ID* y *Client Secret* a **Supabase → Auth → Providers → GitHub**. Activar el proveedor. **El secreto permanece exclusivamente en GitHub/Supabase.**
4. En **Supabase → Authentication → URL Configuration**, configurar **Site URL** con el sitio real (`https://TU-SITIO.pages.dev/`) e incluir el mismo URL exacto en **Redirect URLs**. La tienda inicia OAuth con `redirect_to` a su propia URL.
5. Abrir la tienda en HTTPS y pulsar **Sign in**. El registro ocurre automáticamente la primera vez que el usuario acepta GitHub OAuth. No hay registro paralelo por contraseña.

**Importante:** GitHub no puede completar OAuth desde una URL `file://`; publicar en Pages o utilizar un servidor HTTP local con una URL autorizada. Esta implementación sin SDK procesa el **flujo implícito** de Supabase en el fragmento `#access_token...`, lo borra del historial y renueva la sesión mediante `auth/v1/token`. Usa únicamente HTTPS en producción.

## 4. Primer administrador

El registro se crea inicialmente con rol `user`. Después de entrar por primera vez con tu cuenta GitHub, consulta desde SQL Editor:

```sql
select id, display_name, role from public.profiles order by created_at;
```

Copia tu UUID real y ejecuta **manualmente** (desde SQL Editor y nunca desde el navegador):

```sql
update public.profiles
set role = 'admin'
where id = 'TU-UUID-REAL'::uuid;
```

Cierra e inicia sesión de nuevo o recarga la tienda. Aparecerá la sección **Review / Revisión**. **Ningún usuario puede convertirse a sí mismo en administrador** mediante API pública; activar la cuenta de colaborador solo cambia `user` → `developer`.

## 5. Deploy gratis en Cloudflare Pages

1. Sube todo el contenido de esta carpeta a un repositorio GitHub, por ejemplo `html-offline-store`.
2. En [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages → Create → Pages → Connect to Git**, enlaza el repositorio.
3. Framework preset: **None**; build command: vacío; build output directory: **`public`**; production branch: **`main`**.
4. Despliega. Cloudflare asignará un subdominio `pages.dev` (el nombre disponible depende del nombre del proyecto).
5. Vuelve a Supabase Auth y GitHub OAuth para comprobar las URL públicas configuradas, y prueba el registro y descarga.

No se utiliza build ni instalación de paquetes. Para previsualizar localmente sin OAuth:

```bash
cd public
python3 -m http.server 8080
# abrir http://localhost:8080
```

Si no se han configurado credenciales, se muestra la interfaz completa en **modo de vista previa sin simular datos**, y las acciones remotas muestran un aviso de configuración. Cloudflare aloja la **tienda online**; los archivos HTML publicados se diseñan para funcionar offline una vez descargados.

## 6. Ciclo de publicación

1. Usuario → **Sign in with GitHub**.
2. **My apps → Enable contributor account** (gratuito y sin aprobación manual para obtener el rol; el contenido SÍ requiere revisión).
3. **Publish an app**: nombre, versión, categoría, resumen, descripción, HTML (1–10 MB) y hasta 3 capturas PNG/JPEG/WebP (2 MB cada una).
4. El borrador se guarda en `apps` (`draft`). Los archivos se suben al bucket privado `pending-apps`. Las rutas contienen el UUID de autor y app. `app_versions` y `app_assets` guardan la metadata. La RPC `submit_app` comprueba la existencia real de los objetos y cambia `draft` → `pending`.
5. Admin → **Review**: descarga HTML/capturas para inspección offline; **Approve** copia desde `pending-apps` a `published-apps` mediante la API Storage. La RPC `approve_app` comprueba las copias antes de establecer `published`. **Reject** cambia el estado a `rejected` sin publicar el archivo.
6. Catálogo: un usuario anónimo puede ver apps publicadas, filtrarlas, revisar detalles y descargar el HTML con parámetro `?download=...`. La subida lo marcó como `application/octet-stream`.

### Seguridad: decisiones y límites del MVP

- Publicar código HTML no lo vuelve seguro: **una revisión manual de seguridad y de funcionamiento offline es indispensable**. El checkbox del autor es una declaración, NO una prueba automática. No existe certificación, sandbox ejecutable ni antivirus incorporado.
- `public/_headers` añade CSP, X-Content-Type-Options, X-Frame-Options y política de permisos a Cloudflare Pages. Para usar un dominio Supabase propio, se deben ajustar `connect-src`/`img-src`.
- No se abre ningún HTML de terceros en un iframe ni se inyecta como código en la tienda. Los textos de metadatos se presentan escapados/textContent; las capturas públicas solo aceptan PNG/JPEG/WebP, no SVG.
- Solo el administrador copia archivos al bucket de lectura pública. La comprobación RLS ocurre en el servidor, incluso si alguien manipula el JavaScript.
- Para evitar ejecutar HTML alojado, se establece MIME `application/octet-stream` y se usa `?download=`. Recomiendo verificar las cabeceras HTTP (`Content-Type`/`Content-Disposition`) reales en el proyecto antes de habilitar cargas de desconocidos.
- Un admin debe inspeccionar los archivos descargados en **máquina/VM de pruebas** sin credenciales ni datos sensibles. Descargar un archivo HTML no equivale a garantizar que sea inocuo.
- El flujo Storage→Postgres comprende varias llamadas HTTP y **no es transaccional**. Si el proceso se interrumpe, puede dejar borradores privados o copias públicas sin ficha. Hay limpieza manual de borradores y reintento de copia; la reconciliación programada se deja para una siguiente versión.
- El endpoint de publicación es público solo para lectura; un archivo aprobado se podrá compartir desde su URL aun si se retira posteriormente del catálogo. Añadir retirada/borrado de apps, control de abusos y cuotas por autor antes de abrir a gran escala.
- Los nombres/roles de contribuyentes son datos públicos. No hay campo de email visible en `profiles`.
- Los contadores del inicio se calculan **sobre los últimos 200 registros cargados**, no sobre toda la base de datos. Paginación y contadores exactos son funciones posteriores.
- Versiones nuevas, edición posterior, rankings, comentarios, favoritos, comprobación offline y reportes de abuso están fuera del alcance V0.1.
- El backend necesita conexión para iniciar sesión, revisar apps y descargar archivos; **solo las apps descargadas** son para uso offline. La tienda no funciona totalmente offline.

## 7. Pruebas

Comprobar sintaxis JavaScript con Node.js instalado en el equipo de desarrollo:

```bash
node --check public/config.js
node --check public/i18n.js
node --check public/api.js
node --check public/app.js
node tests/check_static.mjs
node tests/check_api.mjs
```

Además se recomienda revisar manualmente estos pasos **contra el proyecto Supabase real**, pues un entorno sin credenciales no permite afirmar que OAuth, RLS y Storage de producción ya se probaron:

1. Abrir en pantalla móvil/escritorio; cambiar las cuatro lenguas sin recarga; verificar cierre About con botón y `Esc`.
2. Light → Dark → recarga → tema persistido. Cambiar lengua → recarga → lengua persistida.
3. Sin configurar backend: aviso visible, login sin conexión a un servicio remoto y catálogo vacío real.
4. Con backend: entrar con GitHub, activar developer, subir HTML válido y capturas; comprobar estado pendiente.
5. Probar HTML vacío/no HTML, extensión incorrecta, tamaños mayores al máximo, 4 imágenes, MIME no permitido, confirmación sin marcar.
6. Administrador descarga archivos, rechaza un envío y aprueba otro; una cuenta sin rol admin no debe poder publicar ni ejecutar `approve_app` ni copiar al bucket público por REST.
7. Verificar que usuarios anónimos **no pueden consultar** apps `draft`, `pending`, `rejected` ni leer `pending-apps`.
8. Descargar HTML desde el catálogo, comprobar `Content-Disposition: attachment` y funcionamiento offline en una computadora de pruebas.
9. Comprobar renovación automática de sesión después de la expiración del token y cierre de sesión.

## 8. Fuentes técnicas de referencia

- [Supabase REST API](https://supabase.com/docs/guides/api)
- [Supabase publishable keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [GitHub OAuth en Supabase](https://supabase.com/docs/guides/auth/social-login/auth-github)
- [Flujo OAuth implícito](https://supabase.com/docs/guides/auth/sessions/implicit-flow)
- [Políticas RLS Storage](https://supabase.com/docs/guides/storage/security/access-control)
- [Copias entre buckets](https://supabase.com/docs/guides/storage/management/copy-move-objects)
- [Descargas Storage y `?download`](https://supabase.com/docs/guides/storage/serving/downloads)

**Autor:** Raymundo Ortiz · **GitHub:** https://github.com/FireRayo/ · **Versión centralizada:** `STORE_CONFIG.VERSION`.
