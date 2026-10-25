/*
 * CONFIGURACIÓN CENTRAL — HTML Offline Store.
 * Coloque exclusivamente la URL y la clave PUBLICABLE de Supabase.
 * Nunca incluya aquí claves secretas, service_role ni tokens privados.
 */
window.STORE_CONFIG = Object.freeze({
  APP_NAME: 'HTML Offline Store',
  VERSION: '0.1.0',
  SUPABASE_URL: 'https://babpcidhnlxyqfcnrsqi.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_MqJu5RZPeVg5IXHqTkDecQ_zKY-nPEI',
  MAX_HTML_BYTES: 10 * 1024 * 1024,
  MAX_IMAGE_BYTES: 2 * 1024 * 1024,
  MAX_IMAGES: 3,
  CATALOG_LIMIT: 200,
  BUCKET_PENDING: 'pending-apps',
  BUCKET_PUBLISHED: 'published-apps',
  GITHUB_URL: 'https://github.com/FireRayo/'
});
