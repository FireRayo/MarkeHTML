/**
 * Pruebas estructurales independientes (solo Node para desarrollo).
 * Valida que todos los textos referenciados existen en los 4 idiomas,
 * que el HTML no importa dependencias remotas y que hay versión única.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
const root = path.resolve(import.meta.dirname,'..');
const file = location => fs.readFileSync(path.join(root,location),'utf8');
const context={window:{}};
vm.runInNewContext(file('public/i18n.js'),context);
vm.runInNewContext(file('public/config.js'),context);
const dictionaries=context.window.STORE_I18N;
const enKeys=Object.keys(dictionaries.en).sort();
for(const lang of ['en','es','it','pt-BR']){
  assert.deepEqual(Object.keys(dictionaries[lang]).sort(),enKeys,`Faltan o sobran claves en ${lang}`);
  for(const [key,value] of Object.entries(dictionaries[lang])) assert.ok(value.length>0,`Traducción vacía: ${lang}.${key}`);
}
const html=file('public/index.html');
const js=file('public/app.js');
const css=file('public/styles.css');
const sql=file('supabase/schema.sql');
for(const match of html.matchAll(/data-i18n(?:-html|-placeholder|-aria)?="([^"]+)"/g))
  assert.ok(dictionaries.en[match[1]],`Falta clave en HTML: ${match[1]}`);
for(const match of js.matchAll(/\bt\('([A-Za-z][A-Za-z0-9]*)'/g))
  assert.ok(dictionaries.en[match[1]],`Falta clave en JS: ${match[1]}`);
for(const url of html.matchAll(/(?:src|href)="(https?:\/\/[^\"]+)"/g))
  assert.ok(url[1] === 'https://github.com/FireRayo/',`Recurso externo en HTML: ${url[1]}`);
assert.ok(/VERSION:\s*'0\.1\.0'/.test(file('public/config.js')),'Versión central ausente');
assert.ok(!/fetch\(["']https?:\/\//.test(js),'App JavaScript depende de API remota desconocida');
for(const token of ['--bg:#DFE4EA','--bg:#20252B','--accent:#557BD9','--accent:#5C7FD6']) assert.ok(css.includes(token),`Paleta incompleta: ${token}`);
for(const name of ['profiles','categories','apps','app_versions','app_assets','pending-apps','published-apps','submit_app','approve_app','reject_app','become_developer']) assert.ok(sql.includes(name),`SQL falta ${name}`);
console.log(`OK: ${enKeys.length} mensajes × 4 idiomas, sin recursos externos, temas y SQL referenciados.`);
