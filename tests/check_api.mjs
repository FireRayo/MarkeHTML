/**
 * Pruebas de contrato REST de la tienda mediante fetch simulado.
 * No se finge haber verificado un proyecto Supabase externo: se verifica
 * el armado de peticiones, encabezados y renovación de la sesión.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const memory=new Map();
const calls=[];
const publishedObjects=new Map();
let forceInvalidConflict=false;
const context={window:{},console,URL,URLSearchParams,Date,Promise,Blob,ArrayBuffer,setTimeout,clearTimeout,
  localStorage:{getItem:key=>memory.get(key)||null,setItem:(key,v)=>memory.set(key,v),removeItem:key=>memory.delete(key)},
  location:{protocol:'https:',href:'https://store.pages.dev/',pathname:'/',search:'',hash:'',assign(value){this.redirect=value;}},
  history:{replaceState(...args){this.last=args;}},
  fetch:async (url,options={})=>{
    calls.push({url,method:options.method,headers:options.headers,body:options.body});
    let result=[];
    if(url.endsWith('/auth/v1/user')) result={id:'00000000-0000-4000-8000-000000000001'};
    if(url.includes('grant_type=refresh_token')) result={access_token:'refreshed',refresh_token:'new_refresh',expires_in:3600};
    if(url.includes('/storage/v1/object/authenticated/pending-apps/') && options.method === 'GET') {
      return new Response(new Blob(['<html></html>'],{type:'application/octet-stream'}), {status:200});
    }
    if(url.includes('/storage/v1/object/published-apps/') && options.method === 'POST') {
      const key=url.split('/published-apps/')[1];
      if (publishedObjects.has(key) || forceInvalidConflict) {
        return new Response(JSON.stringify({message:'The resource already exists'}),{status:409});
      }
      publishedObjects.set(key,options.body.size);
      result={Key:key};
    }
    if(url.includes('/storage/v1/object/public/published-apps/') && options.method === 'HEAD') {
      const key=url.split('/published-apps/')[1];
      if (!publishedObjects.has(key)) return new Response(null,{status:404});
      return new Response(null,{status:200,headers:{'content-length':String(publishedObjects.get(key))}});
    }
    return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
  },Response,
};
context.window.location=context.location;
const cfg=fs.readFileSync(path.join(root,'public/config.js'),'utf8');
vm.runInNewContext(cfg,context);
context.window.STORE_CONFIG={...context.window.STORE_CONFIG,SUPABASE_URL:'https://demo.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_123456789012345'};
vm.runInNewContext(fs.readFileSync(path.join(root,'public/api.js'),'utf8'),context);
const api=context.window.StoreAPI;
assert.equal(api.configured(),true);
await api.getCatalog();
assert.equal(calls.at(-1).headers.apikey,context.window.STORE_CONFIG.SUPABASE_PUBLISHABLE_KEY);
assert.equal(calls.at(-1).headers.Authorization,undefined,'La clave publicable no puede viajar como Bearer');
context.location.hash='#access_token=firstToken&refresh_token=firstRefresh&expires_in=3600';
assert.equal(api.handleOAuthCallback().success,true);
assert.equal(context.history.last[2],'/','El callback debe borrar el fragmento');
await api.getUser();
assert.equal(calls.at(-1).headers.Authorization,'Bearer firstToken');
assert.equal((await api.getUser()).id,'00000000-0000-4000-8000-000000000001');
await api.rpc('approve_app',{p_app_id:'test-uuid'});
const rpc=calls.at(-1);
assert.ok(rpc.url.endsWith('/rest/v1/rpc/approve_app'));
assert.equal(JSON.parse(rpc.body).p_app_id,'test-uuid');
await api.copyToPublished('user/app/application.html');
assert.equal(calls.at(-1).method,'HEAD','Confirmar existencia pública antes de RPC');
assert.ok(publishedObjects.has('user/app/application.html'));
assert.ok(calls.some(item=>item.url.includes('/storage/v1/object/published-apps/') && item.method==='POST'));
assert.equal(calls.some(item=>item.url.endsWith('/object/copy')),false,'No usar copia ambigua entre buckets');
await api.copyToPublished('user/app/application.html');
assert.equal(publishedObjects.size,1,'Reintento idempotente si ya existe la copia');
forceInvalidConflict=true;
await assert.rejects(api.copyToPublished('other/app/application.html'), /\(409\)/,
  'Un conflicto sin copia verificada no debe tolerarse');
forceInvalidConflict=false;
await api.uploadPending('user/app/application.html',new Blob(['<html></html>']),'application/octet-stream');
assert.equal(calls.at(-1).headers['Content-Type'],'application/octet-stream');
assert.ok(api.publishedUrl('user/app/application.html','demo.html').includes('download=demo.html'));
context.location.hash='#access_token=expired&refresh_token=expiredRefresh&expires_in=0';
api.handleOAuthCallback();
await api.getUser();
const renewedCalls=calls.filter(call=>call.url.includes('grant_type=refresh_token'));
assert.equal(renewedCalls.length,1);
assert.equal(calls.at(-1).headers.Authorization,'Bearer refreshed');
api.loginWithGitHub();
assert.ok(context.location.redirect.includes('provider=github'));
assert.ok(context.location.redirect.includes('redirect_to='));
await api.logout();
assert.equal(api.hasSession(),false);
console.log(`OK: ${calls.length} peticiones simuladas, OAuth, refresh, key pública, upload, transferencia explícita, RPC y logout.`);
