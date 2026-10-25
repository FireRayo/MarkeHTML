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
const context={window:{},console,URL,URLSearchParams,Date,Promise,Blob,ArrayBuffer,setTimeout,clearTimeout,
  localStorage:{getItem:key=>memory.get(key)||null,setItem:(key,v)=>memory.set(key,v),removeItem:key=>memory.delete(key)},
  location:{protocol:'https:',href:'https://store.pages.dev/',pathname:'/',search:'',hash:'',assign(value){this.redirect=value;}},
  history:{replaceState(...args){this.last=args;}},
  fetch:async (url,options={})=>{
    calls.push({url,method:options.method,headers:options.headers,body:options.body});
    let result=[];
    if(url.endsWith('/auth/v1/user')) result={id:'00000000-0000-4000-8000-000000000001'};
    if(url.includes('grant_type=refresh_token')) result={access_token:'refreshed',refresh_token:'new_refresh',expires_in:3600};
    if(url.endsWith('/storage/v1/object/copy')) result={Key:'published-apps/path'};
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
const copy=JSON.parse(calls.at(-1).body);
assert.equal(copy.destinationBucket,'published-apps');
assert.equal(copy.sourceKey,'user/app/application.html');
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
console.log(`OK: ${calls.length} peticiones simuladas, OAuth, refresh, key pública, upload, copy, RPC y logout.`);
