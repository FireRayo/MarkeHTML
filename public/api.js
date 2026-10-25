/* =====================================================================
 * CAPA DE DATOS — HTTP nativo sobre Supabase Auth, PostgREST y Storage.
 * No existe dependencia de supabase-js ni clave secreta en el navegador.
 * La seguridad autoritativa está en las políticas RLS de schema.sql.
 * ===================================================================== */
(() => {
  'use strict';
  const config = window.STORE_CONFIG;
  const SESSION_KEY = 'htmlStore.session.v1';
  let session = null;
  let refreshing = null;

  /* Lee una sesión persistida sin asumir que sus valores siguen vigentes. */
  function restoreSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (saved && typeof saved.access_token === 'string' && typeof saved.refresh_token === 'string') session = saved;
    } catch (error) { console.warn('[Auth] Sesión local ilegible:', error); }
  }

  function configured() {
    try {
      const url = new URL(config.SUPABASE_URL);
      return (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
        && typeof config.SUPABASE_PUBLISHABLE_KEY === 'string'
        && config.SUPABASE_PUBLISHABLE_KEY.trim().length > 20;
    } catch (_) { return false; }
  }

  function baseUrl() { return config.SUPABASE_URL.replace(/\/+$/, ''); }
  function headers(withAuth = true, extra = {}) {
    const result = { apikey: config.SUPABASE_PUBLISHABLE_KEY, ...extra };
    /* Las claves sb_publishable no son JWT. Solo el token del usuario va en Bearer. */
    if (withAuth && session?.access_token) result.Authorization = `Bearer ${session.access_token}`;
    return result;
  }

  /* Convierte errores HTTP en Error reales con un mensaje para diagnóstico. */
  async function request(path, { method = 'GET', body, auth = true, raw = false, extraHeaders = {} } = {}) {
    if (!configured()) throw new Error('Supabase sin configurar');
    if (auth) await ensureSession();
    const isBinary = body instanceof Blob || body instanceof ArrayBuffer;
    const outgoingHeaders = headers(auth, {
      ...(!isBinary && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders
    });
    const response = await fetch(baseUrl() + path, {
      method,
      headers: outgoingHeaders,
      body: body === undefined ? undefined : (isBinary ? body : JSON.stringify(body)),
      cache: 'no-store'
    });
    if (!response.ok) {
      const errorBody = await response.text();
      let detail = errorBody;
      try { const obj = JSON.parse(errorBody); detail = obj.message || obj.msg || obj.error_description || obj.error || errorBody; } catch (_) { /* Error no JSON */ }
      throw new Error(`${method} ${path.split('?')[0]} (${response.status}): ${detail}`);
    }
    if (raw) return response;
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  /* Captura tokens devueltos en el fragmento de OAuth implícito. */
  function handleOAuthCallback() {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.has('error') || hash.has('error_description')) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return { error: true };
    }
    if (!hash.has('access_token') || !hash.has('refresh_token')) return { success: false };
    const expiresIn = Math.max(0, Number(hash.get('expires_in') || 3600));
    saveSession({
      access_token: hash.get('access_token'),
      refresh_token: hash.get('refresh_token'),
      expires_at: Math.floor(Date.now() / 1000) + expiresIn
    });
    /* Se retiran tokens del historial antes de mostrar cualquier vista. */
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return { success: true };
  }

  function saveSession(data) {
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Number(data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600))
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  function clearSession() { session = null; localStorage.removeItem(SESSION_KEY); }
  function hasSession() { return Boolean(session?.access_token); }

  /* Serializa los refresh para evitar utilizar dos veces un refresh token rotativo. */
  async function ensureSession() {
    if (!session) return;
    if (session.expires_at > Date.now() / 1000 + 90) return;
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const refreshed = await request('/auth/v1/token?grant_type=refresh_token', {
            method: 'POST', body: { refresh_token: session.refresh_token }, auth: false
          });
          if (!refreshed?.access_token || !refreshed?.refresh_token) throw new Error('Respuesta inválida al renovar la sesión');
          saveSession(refreshed);
        } catch (error) { clearSession(); throw error; }
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  function loginWithGitHub() {
    if (!configured()) throw new Error('Supabase sin configurar');
    if (location.protocol === 'file:') throw new Error('OAuth necesita URL HTTP o HTTPS');
    const current = new URL(window.location.href);
    current.hash = '';
    /* redirect_to debe estar en la allowlist de Auth > URL Configuration. */
    const target = new URL(baseUrl() + '/auth/v1/authorize');
    target.searchParams.set('provider', 'github');
    target.searchParams.set('redirect_to', current.href);
    location.assign(target.href);
  }

  async function logout() {
    try {
      if (hasSession()) await request('/auth/v1/logout', { method: 'POST', body: {}, auth: true });
    } catch (error) { console.warn('[Auth] Fallo de revocación remota:', error); }
    finally { clearSession(); }
  }

  async function getUser() {
    if (!hasSession()) return null;
    const user = await request('/auth/v1/user');
    if (!user?.id) throw new Error('Sesión no válida');
    return user;
  }

  /* Lista acotada, con relaciones traídas por los FKs del esquema SQL. */
  const APP_FIELDS = 'id,title,summary,description,status,created_at,published_at,author_id,category_id,rejection_reason,app_versions(version,file_size,storage_path),app_assets(position,storage_path,mime_type),profiles!apps_author_id_fkey(display_name),categories(slug)';
  function listApps(filter, limit) {
    return request(`/rest/v1/apps?select=${encodeURIComponent(APP_FIELDS)}&${filter}&limit=${limit}`);
  }
  function getCatalog() { return listApps('status=eq.published&order=published_at.desc', config.CATALOG_LIMIT); }
  function getMyApps(userId) { return listApps(`author_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`, 150); }
  function getPending() { return listApps('status=eq.pending&order=created_at.asc', 150); }
  function getCategories() { return request('/rest/v1/categories?select=id,slug&order=slug.asc'); }
  async function getProfile(id) {
    const rows = await request(`/rest/v1/profiles?select=id,display_name,role&id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows?.[0] || null;
  }

  /* PostgREST usa Prefer:return=representation para recuperar el UUID creado. */
  async function insert(table, payload) {
    const rows = await request(`/rest/v1/${table}`, { method: 'POST', body: payload, extraHeaders: { Prefer: 'return=representation' } });
    return rows?.[0] || null;
  }
  function removeDraftRow(id) {
    return request(`/rest/v1/apps?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', extraHeaders: { Prefer: 'return=minimal' } });
  }
  function rpc(name, args = {}) { return request(`/rest/v1/rpc/${name}`, { method: 'POST', body: args }); }

  /* Al subir HTML forzamos application/octet-stream, nunca text/html. */
  function uploadPending(path, file, mime) {
    return request(`/storage/v1/object/${config.BUCKET_PENDING}/${encodePath(path)}`, {
      method: 'POST', body: file, extraHeaders: { 'Content-Type': mime, 'cache-control': '3600', 'x-upsert': 'false' }
    });
  }
  function copyToPublished(path) {
    return request('/storage/v1/object/copy', {
      method: 'POST', body: { bucketId: config.BUCKET_PENDING, sourceKey: path, destinationBucket: config.BUCKET_PUBLISHED, destinationKey: path }
    });
  }
  function deletePendingFiles(paths) {
    if (!paths.length) return Promise.resolve();
    return request(`/storage/v1/object/${config.BUCKET_PENDING}`, { method: 'DELETE', body: { prefixes: paths } });
  }
  function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }
  function publishedUrl(path, fileName) {
    const url = new URL(`${baseUrl()}/storage/v1/object/public/${config.BUCKET_PUBLISHED}/${encodePath(path)}`);
    if (fileName) url.searchParams.set('download', fileName);
    return url.href;
  }
  async function downloadPending(path, filename) {
    const result = await request(`/storage/v1/object/authenticated/${config.BUCKET_PENDING}/${encodePath(path)}`, { raw: true });
    const blob = await result.blob();
    saveBlob(blob, filename);
  }
  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    /* Revocar más tarde evita invalidar la descarga iniciada por el navegador. */
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  restoreSession();
  window.StoreAPI = Object.freeze({
    configured, handleOAuthCallback, loginWithGitHub, logout, clearSession, hasSession, getUser,
    getProfile, getCatalog, getMyApps, getPending, getCategories, insert, removeDraftRow,
    rpc, uploadPending, copyToPublished, deletePendingFiles, publishedUrl, downloadPending
  });
})();
