-- MARKEHTML V0.1.1: ejecutar una sola vez si se viene de V0.1.0.
-- Permite verificar archivos ya publicados durante reintentos de aprobación.
-- No concede escritura ni privilegios a usuarios normales.
DROP POLICY IF EXISTS published_admin_read ON storage.objects;
CREATE POLICY published_admin_read ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'published-apps' AND public.is_admin());
