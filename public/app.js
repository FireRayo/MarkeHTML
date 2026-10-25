/* ========================================================================
 * CONTROLADOR DE INTERFAZ — HTML Offline Store V0.1.0
 * Responsabilidades: i18n, tema, navegación, formularios, catálogo y revisión.
 * No se mezclan aquí credenciales, SQL ni detalles HTTP (véase api.js).
 * Todos los mensajes al usuario pasan por t() y todas las cadenas remotas
 * se insertan escapadas o usando textContent para evitar inyección HTML.
 * ======================================================================== */
(() => {
  'use strict';
  const API = window.StoreAPI;
  const CFG = window.STORE_CONFIG;
  const DICT = window.STORE_I18N;
  const LANG_KEY = 'htmlStore.language.v1';
  const THEME_KEY = 'htmlStore.theme.v1';
  const CATEGORY_SYMBOLS = Object.freeze({ tools:'⌘',productivity:'▤',education:'✧',development:'</>',graphics:'◈',games:'♟',utilities:'⚙',other:'◇' });
  const state = {
    lang: ['en','es','it','pt-BR'].includes(localStorage.getItem(LANG_KEY)) ? localStorage.getItem(LANG_KEY) : 'en',
    theme: localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light',
    section:'catalog', categories:[], catalog:[], mine:[], pending:[], user:null, profile:null,
    filterCategory:'all', search:'', sort:'newest', busy:false, confirmedDialog:false
  };
  const $ = id => document.getElementById(id);

  /* Resuelve claves semánticas y permite reemplazos para mensajes dinámicos. */
  function t(key, vars = {}) {
    const template = DICT[state.lang][key] ?? DICT.en[key] ?? key;
    return String(template).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, symbol => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[symbol]));
  }
  function safeId(value) { return String(value ?? '').replace(/[^0-9a-z-]/gi,''); }
  function humanSize(bytes) {
    if (!Number.isFinite(Number(bytes))) return '—';
    const size = Number(bytes);
    return size < 1024 ? `${size} B` : size < 1048576 ? `${(size/1024).toFixed(1)} KB` : `${(size/1048576).toFixed(2)} MB`;
  }
  function formatDate(date) {
    if (!date) return '—';
    const d = new Date(date);
    return Number.isNaN(d.valueOf()) ? '—' : new Intl.DateTimeFormat(state.lang, {year:'numeric',month:'short',day:'numeric'}).format(d);
  }
  function categoryName(appOrCategory) {
    const slug = typeof appOrCategory === 'string' ? appOrCategory : appOrCategory?.categories?.slug;
    return t(slug || 'other');
  }
  function latestVersion(app) { return app?.app_versions?.[0] || null; }
  function images(app) { return [...(app?.app_assets || [])].sort((a,b) => a.position - b.position); }
  function displayAuthor(app) { return app?.profiles?.display_name || t('developer'); }
  function notify(message, type = 'info') {
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.textContent = message;
    $('toastStack').append(item);
    setTimeout(() => item.remove(), 5500);
  }
  function logFailure(area, error, message = 'operationError') {
    console.error(`[HTML Store/${area}]`, error);
    notify(t(message), 'error');
  }

  /* El idioma predeterminado siempre es inglés, aunque el navegador use otro. */
  function applyLanguage(lang) {
    state.lang = DICT[lang] ? lang : 'en';
    localStorage.setItem(LANG_KEY, state.lang);
    document.documentElement.lang = state.lang;
    $('languageSelect').value = state.lang;
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach(node => { node.innerHTML = t(node.dataset.i18nHtml); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-aria]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.i18nAria)); });
    document.querySelectorAll('[data-close]').forEach(node => { node.setAttribute('aria-label', t('closeWindow')); });
    $('aboutButton').setAttribute('aria-label', t('openAbout'));
    $('aboutButton').title = t('openAbout');
    applyTheme(state.theme);
    updateCategories();
    renderCatalog();
    renderMyApps();
    renderPending();
    /* Un modal de detalles abierto debe re-traducirse, sin perder el elemento. */
    if ($('detailsDialog').open && state.selectedApp) drawDetails(state.selectedApp, state.selectedMode);
  }

  /* Dos temas completos, sin depender de prefers-color-scheme del sistema. */
  function applyTheme(theme) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    document.body.dataset.theme = state.theme;
    localStorage.setItem(THEME_KEY, state.theme);
    $('themeIcon').textContent = state.theme === 'dark' ? '☀' : '☾';
    const label = t(state.theme === 'dark' ? 'themeLight' : 'themeDark');
    $('themeButton').setAttribute('aria-label',label);
    $('themeButton').title = label;
  }

  /* Menú en una sola página: reduce puntos de fallo y evita rutas en servidor. */
  function navigate(section) {
    state.section = section;
    const onCatalog = section === 'catalog';
    $('catalogSection').classList.toggle('hidden',!onCatalog);
    $('myAppsSection').classList.toggle('hidden',section !== 'my');
    $('adminSection').classList.toggle('hidden',section !== 'admin');
    document.querySelector('.hero').classList.toggle('hidden',!onCatalog);
    document.querySelector('.stats-grid').classList.toggle('hidden',!onCatalog);
    ['catalogNav','myAppsNav','adminNav'].forEach((id,index) => $(id).classList.toggle('active',index === ['catalog','my','admin'].indexOf(section)));
    if(section === 'my') refreshMine();
    if(section === 'admin') refreshPending();
    window.scrollTo({top:0,behavior:'smooth'});
  }

  /* Permisos visibles: la capa de UI no es la barrera de seguridad. */
  function updateAuthenticationUI() {
    const signedIn = Boolean(state.user && state.profile);
    const isAdmin = state.profile?.role === 'admin';
    $('loginButton').classList.toggle('hidden',signedIn);
    $('userArea').classList.toggle('hidden',!signedIn);
    $('myAppsNav').classList.toggle('hidden',!signedIn);
    $('adminNav').classList.toggle('hidden',!isAdmin);
    if (signedIn) {
      $('userName').textContent = state.profile.display_name || t('developer');
      $('userInitial').textContent = (state.profile.display_name || 'U').slice(0,1).toUpperCase();
    }
    $('developerIntro').classList.toggle('hidden', !signedIn || state.profile?.role !== 'user');
    $('myAppsPublishButton').classList.toggle('hidden',!signedIn || state.profile?.role === 'user');
    if ((!signedIn && state.section !== 'catalog') || (state.section === 'admin' && !isAdmin)) navigate('catalog');
  }

  /* Las categorías vienen de la DB, pero sus nombres están traducidos aquí. */
  function updateCategories() {
    const select = $('categorySelect');
    const uploadSelect = $('appCategory');
    select.replaceChildren(new Option(t('allCategories'),'all'));
    uploadSelect.replaceChildren(new Option(t('chooseCategory'),''));
    const chips = $('categoryChips');
    chips.replaceChildren();
    const available = [{id:'all',slug:'allCategories'},...state.categories];
    for (const category of available) {
      if (category.slug !== 'allCategories') {
        const option = new Option(categoryName(category.slug),category.id);
        select.add(option);
        uploadSelect.add(new Option(categoryName(category.slug),category.id));
      }
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (state.filterCategory === category.id ? ' active' : '');
      chip.dataset.category = category.id;
      chip.textContent = category.slug === 'allCategories' ? t('allCategories') : categoryName(category.slug);
      chips.append(chip);
    }
    select.value = state.filterCategory;
  }

  /* Render del catálogo: texto escapado y capturas como imágenes, nunca HTML ejecutable. */
  function filteredCatalog() {
    const search = state.search.trim().toLocaleLowerCase();
    const result = state.catalog.filter(app => {
      if(state.filterCategory !== 'all' && app.category_id !== state.filterCategory) return false;
      const blob = [app.title,app.summary,app.description,displayAuthor(app)].join(' ').toLocaleLowerCase();
      return blob.includes(search);
    });
    return result.sort((a,b) => state.sort === 'name' ? a.title.localeCompare(b.title) : new Date(b.published_at) - new Date(a.published_at));
  }
  function renderCatalog() {
    const results = filteredCatalog();
    const grid = $('appGrid');
    grid.replaceChildren();
    $('appCount').textContent = API.configured() ? String(state.catalog.length) : '—';
    $('devCount').textContent = API.configured() ? String(new Set(state.catalog.map(app => app.author_id)).size) : '—';
    $('resultCount').textContent = t('resultCount',{count:results.length});
    const isEmpty = results.length === 0;
    $('catalogEmpty').classList.toggle('hidden',!isEmpty);
    $('emptyTitle').textContent = t(state.catalog.length ? 'noApps' : 'noPublished');
    $('emptyDescription').textContent = t(state.catalog.length ? 'noAppsDetail' : 'noPublishedDetail');
    $('resetFiltersButton').classList.toggle('hidden',!state.catalog.length);
    for (const app of results) {
      const card = document.createElement('article');
      card.className = 'app-card';
      const firstImage = images(app)[0];
      const imageHtml = firstImage ? `<img loading="lazy" alt="" src="${escapeHtml(API.publishedUrl(firstImage.storage_path))}">` : escapeHtml(CATEGORY_SYMBOLS[app.categories?.slug] || '◇');
      const version = latestVersion(app);
      card.innerHTML = `<div class="app-card-top"><div class="app-card-icon">${imageHtml}</div><div class="app-card-meta"><h3 title="${escapeHtml(app.title)}">${escapeHtml(app.title)}</h3><div class="app-card-category">${escapeHtml(categoryName(app))}</div></div></div><p class="app-card-summary">${escapeHtml(app.summary)}</p><div class="app-card-footer"><div><small class="app-card-author" title="${escapeHtml(displayAuthor(app))}">${escapeHtml(t('by',{name:displayAuthor(app)}))}</small><small>${escapeHtml(t('versionLabel',{version:version?.version || '—'}))} · ${escapeHtml(humanSize(version?.file_size))}</small></div><button class="button button-small" type="button" data-action="detail" data-id="${safeId(app.id)}">${escapeHtml(t('viewDetails'))}</button></div>`;
      grid.append(card);
    }
  }

  /* Panel personal: drafts permiten cancelar metadatos y archivos incompletos. */
  function renderMyApps() {
    const list = $('myAppsList');
    list.replaceChildren();
    if(!state.mine.length) { if(state.profile?.role !== 'user') list.innerHTML = `<div class="empty-line">${escapeHtml(t('myAppsEmpty'))}</div>`;return; }
    for(const app of state.mine) {
      const row = document.createElement('article');
      row.className = 'dashboard-row';
      const info = document.createElement('div'); info.className = 'dashboard-info';
      const heading = document.createElement('h3');heading.textContent = app.title;
      const description = document.createElement('p');
      description.textContent = `${categoryName(app)} · ${t('uploadedOn',{date:formatDate(app.created_at)})}`;
      info.append(heading,description);
      const status = document.createElement('span');status.className = `status ${app.status}`;status.textContent = t(app.status);
      const actions = document.createElement('div');actions.className = 'dashboard-actions';
      if(app.status === 'published') actions.append(actionButton('detail',app.id,t('viewDetails')));
      if(app.status === 'draft') actions.append(actionButton('discard',app.id,t('discard')));
      row.append(info,status,actions);list.append(row);
    }
  }
  function renderPending() {
    const list = $('adminList');list.replaceChildren();
    $('pendingBadge').textContent = state.pending.length;
    $('pendingBadge').classList.toggle('hidden',!state.pending.length);
    if(!state.pending.length) {list.innerHTML = `<div class="empty-line">${escapeHtml(t('adminEmpty'))}</div>`;return;}
    for(const app of state.pending) {
      const row = document.createElement('article');row.className = 'dashboard-row';
      const info = document.createElement('div');info.className = 'dashboard-info';
      const heading = document.createElement('h3');heading.textContent = app.title;
      const desc = document.createElement('p');desc.textContent = `${displayAuthor(app)} · ${categoryName(app)} · ${t('uploadedOn',{date:formatDate(app.created_at)})}`;
      info.append(heading,desc);
      const controls = document.createElement('div');controls.className = 'dashboard-actions';
      controls.append(actionButton('review',app.id,t('viewFiles')));
      controls.append(actionButton('reject',app.id,t('reject')));
      controls.append(actionButton('approve',app.id,t('approve'),'button-primary'));
      row.append(info,controls);list.append(row);
    }
  }
  function actionButton(action,id,label,extraClass='') {
    const button = document.createElement('button');button.type = 'button';button.className = `button button-small ${extraClass}`;
    button.dataset.action = action;button.dataset.id = id;button.textContent = label;
    return button;
  }

  /* Página de detalle en un modal: jamás contiene un iframe de terceros. */
  function drawDetails(app, mode='public') {
    state.selectedApp = app; state.selectedMode = mode;
    $('detailsHeading').textContent = app.title;
    const detail = $('detailsContent');detail.replaceChildren();
    const meta = document.createElement('div');meta.className = 'details-subtitle';
    for(const text of [categoryName(app), t('by',{name:displayAuthor(app)}),t('versionLabel',{version:latestVersion(app)?.version || '—'}),t('fileSize') + ': ' + humanSize(latestVersion(app)?.file_size)]) {
      const span = document.createElement('span');span.textContent = text;meta.append(span);
    }
    const summary = document.createElement('p');summary.className = 'details-description';summary.textContent = app.summary;
    const description = document.createElement('p');description.className = 'details-description';description.textContent = app.description;
    detail.append(meta,summary,description);
    const shots = images(app);
    if (mode === 'public' && shots.length) {
      const gallery = document.createElement('div');gallery.className = 'details-cover';
      for(const shot of shots){const img=document.createElement('img');img.src=API.publishedUrl(shot.storage_path);img.alt=t('screenshots');img.loading='lazy';gallery.append(img);}
      detail.append(gallery);
    }
    if (mode === 'review') {
      const warning = document.createElement('p');warning.className = 'dialog-intro';warning.textContent = t('fileSecurity');detail.append(warning);
      const actions = document.createElement('div');actions.className = 'dashboard-actions';
      actions.append(actionButton('inspect',app.id,t('inspectHtml')));
      if(shots.length) actions.append(actionButton('inspectImages',app.id,t('previewScreenshots')));
      detail.append(actions);
    }
    const footer = document.createElement('div');footer.className='details-footer';
    const note = document.createElement('small');note.textContent = t('approvedInfo');footer.append(note);
    if(mode === 'public' && latestVersion(app)) {
      const link = document.createElement('a');
      link.className = 'button button-primary';
      link.href = API.publishedUrl(latestVersion(app).storage_path, safeDownloadName(app.title,latestVersion(app).version));
      link.target = '_blank';link.rel = 'noopener noreferrer';
      link.textContent = '↓ ' + t('download');footer.append(link);
    }
    detail.append(footer);
  }
  function safeDownloadName(title,version){
    const sanitized = String(title).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,60) || 'application';
    const cleanedVersion = String(version).replace(/[^a-zA-Z0-9._-]/g,'');
    return `${sanitized}_v${cleanedVersion}.html`;
  }
  function openDetails(app,mode='public') {drawDetails(app,mode);$('detailsDialog').showModal();}

  /* Confirmación accesible y sin window.confirm (estilo nativo no neomórfico). */
  function askConfirmation(heading,message) {
    const dialog = $('confirmDialog');
    $('confirmHeading').textContent = t(heading);$('confirmMessage').textContent = t(message);
    dialog.showModal();
    return new Promise(resolve => {
      let completed = false;
      const finish = answer => {
        if(completed) return;
        completed = true;
        $('confirmAccept').removeEventListener('click',onYes);
        $('confirmCancel').removeEventListener('click',onNo);
        dialog.removeEventListener('close',onNo);
        if(dialog.open) dialog.close();
        resolve(answer);
      };
      const onYes = () => finish(true);
      const onNo = () => finish(false);
      $('confirmAccept').addEventListener('click',onYes);
      $('confirmCancel').addEventListener('click',onNo);
      dialog.addEventListener('close',onNo,{once:true});
    });
  }

  async function loadCatalog() {
    if(!API.configured()) {renderCatalog();return;}
    try {
      const [categories,catalog] = await Promise.all([API.getCategories(),API.getCatalog()]);
      state.categories = categories || [];
      state.catalog = catalog || [];
      updateCategories();renderCatalog();
    } catch(error) {logFailure('catalog',error,'catalogError');}
  }
  async function refreshMine() {
    if(!state.user) return;
    try {state.mine = await API.getMyApps(state.user.id) || [];renderMyApps();}
    catch(error){logFailure('mine',error);}
  }
  async function refreshPending() {
    if(state.profile?.role !== 'admin') return;
    try{state.pending = await API.getPending() || [];renderPending();}
    catch(error){logFailure('pending',error);}
  }
  async function restoreAuthentication() {
    const callback = API.handleOAuthCallback();
    if(callback.error) notify(t('authError'),'error');
    if(!API.configured() || !API.hasSession()) {updateAuthenticationUI();return;}
    try {
      state.user = await API.getUser();
      state.profile = await API.getProfile(state.user.id);
      if(!state.profile) throw new Error('Falta perfil: revise el trigger handle_new_user');
      updateAuthenticationUI();
      if(state.profile.role === 'admin') refreshPending();
    } catch(error) {
      console.warn('[HTML Store/Auth] No se pudo recuperar la sesión:',error);
      API.clearSession();state.user = null;state.profile = null;
      updateAuthenticationUI();notify(t('sessionExpired'),'error');
    }
  }

  function requestPublish() {
    if(!API.configured()) return notify(t('notConfigured'),'error');
    if(!state.user) return notify(t('signInFirst'),'error');
    if(state.profile?.role === 'user') { navigate('my'); return; }
    $('uploadForm').reset();
    $('htmlFileName').textContent = t('htmlFileLimit');
    $('imageFileNames').textContent = t('screenshotsLimit');
    $('uploadDialog').showModal();
  }

  /* Se inspeccionan extensión, tamaño y cabecera básica; esto NO certifica offline. */
  async function validateSubmission(form) {
    const title = $('appTitle').value.trim();
    const summary = $('appSummary').value.trim();
    const description = $('appDescription').value.trim();
    const version = $('appVersion').value.trim();
    const categoryId = $('appCategory').value;
    const html = $('htmlFile').files[0];
    const screenshots = [...$('imageFiles').files];
    if (!title || !summary || !description || !categoryId || !version || title.length>80 || summary.length>180 || description.length>4000) throw new Error('validateRequired');
    if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,29}$/.test(version)) throw new Error('validateVersion');
    if (!html || !/\.html$/i.test(html.name) || html.size===0 || html.size > CFG.MAX_HTML_BYTES) throw new Error('validateFile');
    const beginning = await html.slice(0,65536).text();
    if (!/<!doctype\s+html|<html(?:\s|>)/i.test(beginning)) throw new Error('validateHtmlContent');
    if (screenshots.length > CFG.MAX_IMAGES) throw new Error('validateImages');
    for(const file of screenshots){
      if(file.size === 0 || file.size > CFG.MAX_IMAGE_BYTES || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('validateImages');
      const bytes = new Uint8Array(await file.slice(0,12).arrayBuffer());
      const png = file.type==='image/png' && [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n);
      const jpeg = file.type==='image/jpeg' && bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
      const webp = file.type==='image/webp' && String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP';
      if(!png && !jpeg && !webp) throw new Error('validateImages');
    }
    if(!$('confirmOffline').checked) throw new Error('validateOffline');
    return {title,summary,description,version,categoryId,html,screenshots};
  }

  /* Registro draft -> subida privada -> metadatos -> RPC submit_app.
   * Si falla, la operación de limpieza intenta deshacer los archivos subidos.
   * Si se corta la red, el usuario ve el borrador en Mis apps para descartarlo.
   */
  async function submitApplication(event) {
    event.preventDefault();
    if(state.busy) return;
    let draft = null;
    const uploadedPaths = [];
    try {
      const data = await validateSubmission(event.target);
      state.busy = true;
      $('submitButton').disabled = true;
      $('submitButton').textContent = t('loading');
      draft = await API.insert('apps',{title:data.title,summary:data.summary,description:data.description,category_id:data.categoryId,author_id:state.user.id,status:'draft'});
      if(!draft?.id) throw new Error('No se recibió UUID del borrador');
      const prefix = `${state.user.id}/${draft.id}`;
      const htmlPath = `${prefix}/application.html`;
      await API.uploadPending(htmlPath,data.html,'application/octet-stream');uploadedPaths.push(htmlPath);
      await API.insert('app_versions',{app_id:draft.id,version:data.version,file_size:data.html.size,storage_path:htmlPath});
      for(let index=0;index<data.screenshots.length;index++){
        const file=data.screenshots[index];
        const extension = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type];
        const path=`${prefix}/screenshot_${index+1}.${extension}`;
        await API.uploadPending(path,file,file.type);uploadedPaths.push(path);
        await API.insert('app_assets',{app_id:draft.id,position:index+1,mime_type:file.type,storage_path:path});
      }
      await API.rpc('submit_app',{p_app_id:draft.id});
      $('uploadDialog').close();
      notify(t('submitSuccess'),'success');
      navigate('my');
    } catch(error) {
      if(error.message.startsWith('validate') && DICT.en[error.message]) notify(t(error.message),'error');
      else logFailure('submit',error,'submitError');
      if(draft?.id){
        try{
          if(uploadedPaths.length) await API.deletePendingFiles(uploadedPaths);
          await API.removeDraftRow(draft.id);
        } catch(cleanError){console.warn('[HTML Store/Cleanup] Borrador conservado para limpieza posterior:',cleanError);}
        await refreshMine();
      }
    } finally {
      state.busy = false;
      $('submitButton').disabled=false;
      $('submitButton').textContent=t('submitForReview');
    }
  }

  async function approveApplication(app) {
    if(!await askConfirmation('approveHeading','approveMessage')) return;
    if(state.busy) return;
    state.busy = true;
    try{
      /* Copiar primero las imágenes y al final el HTML; la RPC valida todas. */
      const files = [...images(app).map(item=>item.storage_path),latestVersion(app)?.storage_path].filter(Boolean);
      for(const path of files) {
        /* Solo se continúa si la API confirmó el archivo en published-apps.
         * La capa HTTP gestiona los reintentos verificando la copia real.
         */
        await API.copyToPublished(path);
      }
      await API.rpc('approve_app',{p_app_id:app.id});
      notify(t('appApproved'),'success');
      await Promise.all([refreshPending(),loadCatalog()]);
    }catch(error){logFailure('approve',error,'approvalPartial');}
    finally{state.busy=false;}
  }
  async function rejectApplication(app){
    if(!await askConfirmation('rejectHeading','rejectMessage')) return;
    if(state.busy)return;
    state.busy=true;
    try{await API.rpc('reject_app',{p_app_id:app.id});notify(t('appRejected'),'success');await refreshPending();}
    catch(error){logFailure('reject',error);}
    finally{state.busy=false;}
  }
  async function discardDraft(app){
    if(!await askConfirmation('discardHeading','discardMessage')) return;
    if(state.busy)return;
    state.busy=true;
    try{
      /* Incluye paths canónicos aun si un fallo interrumpió la inserción del metadato. */
      const prefix = `${state.user.id}/${app.id}`;
      const paths = new Set([`${prefix}/application.html`, ...images(app).map(s=>s.storage_path)]);
      for(const i of [1,2,3]) for(const extension of ['png','jpg','webp']) paths.add(`${prefix}/screenshot_${i}.${extension}`);
      /* La API DELETE acepta nombres inexistentes al quitar varios objetos. */
      await API.deletePendingFiles([...paths]);
      await API.removeDraftRow(app.id);
      notify(t('draftDiscarded'),'success');await refreshMine();
    }catch(error){logFailure('discard',error);}
    finally{state.busy=false;}
  }
  async function inspectSubmission(app,allImages=false){
    try{
      if(allImages){
        const shots=images(app);for(const shot of shots){
          const ext = shot.mime_type==='image/png'?'png':shot.mime_type==='image/webp'?'webp':'jpg';
          await API.downloadPending(shot.storage_path,`review_${app.id}_${shot.position}.${ext}`);
        }
      }else if(latestVersion(app)) await API.downloadPending(latestVersion(app).storage_path,`review_${app.id}.html`);
    }catch(error){logFailure('inspect',error,'downloadIssue');}
  }

  /* Delegación: un único listener por panel sobrevive a todos los redibujados. */
  function wireCardActions(node){
    node.addEventListener('click',async event => {
      const button = event.target.closest('[data-action]');
      if(!button || !node.contains(button))return;
      const action=button.dataset.action,id=button.dataset.id;
      const app=[...state.catalog,...state.mine,...state.pending].find(entry=>entry.id===id);
      if(!app)return;
      if(action==='detail') openDetails(app);
      if(action==='review') openDetails(app,'review');
      if(action==='approve') await approveApplication(app);
      if(action==='reject') await rejectApplication(app);
      if(action==='discard') await discardDraft(app);
      if(action==='inspect') await inspectSubmission(app);
      if(action==='inspectImages') await inspectSubmission(app,true);
    });
  }
  function connectEvents(){
    $('languageSelect').addEventListener('change',event=>applyLanguage(event.target.value));
    $('themeButton').addEventListener('click',()=>applyTheme(state.theme==='light'?'dark':'light'));
    $('aboutButton').addEventListener('click',()=>$('aboutDialog').showModal());
    document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
    $('homeButton').addEventListener('click',()=>navigate('catalog'));
    $('catalogNav').addEventListener('click',()=>navigate('catalog'));
    $('myAppsNav').addEventListener('click',()=>navigate('my'));
    $('adminNav').addEventListener('click',()=>navigate('admin'));
    $('refreshAdminButton').addEventListener('click',refreshPending);
    $('exploreButton').addEventListener('click',()=>$('catalogSection').scrollIntoView({behavior:'smooth'}));
    $('publishButton').addEventListener('click',requestPublish);
    $('myAppsPublishButton').addEventListener('click',requestPublish);
    $('loginButton').addEventListener('click',()=>{
      try{if(!API.configured())return notify(t('notConfigured'),'error');API.loginWithGitHub();}
      catch(error){logFailure('OAuth',error,'authError');}
    });
    $('logoutButton').addEventListener('click',async()=>{
      await API.logout();state.user=null;state.profile=null;state.mine=[];state.pending=[];
      updateAuthenticationUI();notify(t('signedOut'),'success');
    });
    $('enableDeveloperButton').addEventListener('click',async()=>{
      if(!await askConfirmation('enableDeveloperConfirm','enableDeveloperMessage'))return;
      try{await API.rpc('become_developer');state.profile=await API.getProfile(state.user.id);updateAuthenticationUI();notify(t('contributorEnabled'),'success');}
      catch(error){logFailure('enable-developer',error);}
    });
    $('searchInput').addEventListener('input',event=>{state.search=event.target.value;renderCatalog();});
    $('sortSelect').addEventListener('change',event=>{state.sort=event.target.value;renderCatalog();});
    $('categorySelect').addEventListener('change',event=>setCategory(event.target.value));
    $('categoryChips').addEventListener('click',event=>{const b=event.target.closest('[data-category]');if(b)setCategory(b.dataset.category);});
    $('resetFiltersButton').addEventListener('click',()=>{state.search='';$('searchInput').value='';setCategory('all');});
    $('htmlFile').addEventListener('change',event=>{$('htmlFileName').textContent=event.target.files[0] ? t('fileLabel',{name:event.target.files[0].name}) : t('htmlFileLimit');});
    $('imageFiles').addEventListener('change',event=>{$('imageFileNames').textContent=event.target.files.length ? t('imagesLabel',{count:event.target.files.length}) : t('screenshotsLimit');});
    $('uploadForm').addEventListener('submit',submitApplication);
    for(const node of [$('appGrid'),$('myAppsList'),$('adminList'),$('detailsContent')]) wireCardActions(node);
  }
  function setCategory(id){state.filterCategory=id;updateCategories();renderCatalog();}

  async function init(){
    $('footerVersion').textContent=`v${CFG.VERSION}`;
    $('aboutVersion').textContent=CFG.VERSION;
    $('aboutApplication').textContent=CFG.APP_NAME;
    $('githubLink').href=CFG.GITHUB_URL;
    $('setupNotice').classList.toggle('hidden',API.configured());
    connectEvents();
    applyLanguage(state.lang);
    applyTheme(state.theme);
    updateAuthenticationUI();
    await Promise.all([loadCatalog(),restoreAuthentication()]);
  }
  init().catch(error=>logFailure('init',error));
})();
