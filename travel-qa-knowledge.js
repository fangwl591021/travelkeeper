(function () {
  const WORKER_URL = 'https://travelkeeper-worker.fangwl591021.workers.dev';
  const manifestPath = './knowledge/manifest.json';
  const workerManifestUrl = `${WORKER_URL}/api/knowledge/manifest`;
  const state = {
    manifest: null,
    documents: [],
    entries: [],
    loaded: false,
    error: '',
  };

  function normalize(value) {
    return String(value || '').toLowerCase();
  }

  function scoreEntry(entry, text) {
    const haystack = normalize(text);
    if (!haystack) return 0;
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    let score = 0;
    keywords.forEach(keyword => {
      if (keyword && haystack.includes(normalize(keyword))) score += 3;
    });
    tags.forEach(tag => {
      if (tag && haystack.includes(normalize(tag))) score += 1;
    });
    const title = normalize(entry.title);
    if (title && haystack.includes(title)) score += 4;
    return score;
  }

  function resolvePath(path) {
    const value = String(path || '').trim();
    if (/^https?:\/\//i.test(value)) return value;
    return './' + value.replace(/^\.?\//, '');
  }

  async function loadJson(path) {
    const res = await fetch(resolvePath(path), { cache: 'no-store' });
    if (!res.ok) throw new Error(`知識檔讀取失敗：${path} (${res.status})`);
    return res.json();
  }

  async function loadWorkerJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`知識庫 API 讀取失敗 (${res.status})`);
    const payload = await res.json();
    if (payload?.success === false) throw new Error(payload.error || 'KNOWLEDGE_API_FAILED');
    return payload?.data || payload;
  }

  async function loadManifestWithSource() {
    try {
      const manifest = await loadWorkerJson(workerManifestUrl);
      if (Array.isArray(manifest?.files) && manifest.files.length) {
        return { manifest, source: 'worker' };
      }
    } catch (err) {
      console.warn('Worker knowledge manifest unavailable:', err?.message || err);
    }
    return { manifest: await loadJson(manifestPath), source: 'local' };
  }

  async function loadDocument(file, source) {
    if (source === 'worker') {
      return loadWorkerJson(`${WORKER_URL}/api/knowledge/file?path=${encodeURIComponent(file.path || '')}`);
    }
    return loadJson(file.path);
  }

  async function load() {
    try {
      const loadedManifest = await loadManifestWithSource();
      state.manifest = loadedManifest.manifest;
      const files = Array.isArray(state.manifest?.files) ? state.manifest.files : [];
      const published = files.filter(file => (file.status || 'published') === 'published');
      const docs = await Promise.all(published.map(async file => {
        const doc = await loadDocument(file, loadedManifest.source);
        return { ...doc, manifestItem: file };
      }));
      state.documents = docs;
      state.entries = docs.flatMap(doc => (Array.isArray(doc.entries) ? doc.entries : []).map(entry => ({
        ...entry,
        documentId: doc.id || doc.manifestItem?.id || '',
        documentTitle: doc.title || doc.manifestItem?.title || '',
        category: entry.category || doc.category || doc.manifestItem?.category || '',
        source: entry.source || doc.source || doc.manifestItem?.source || '',
        sourceUrl: entry.source_url || doc.source_url || doc.manifestItem?.source_url || '',
        version: entry.version || doc.version || '',
      })));
      state.loaded = true;
      state.error = '';
    } catch (err) {
      state.loaded = false;
      state.error = err?.message || String(err);
      console.warn('TravelKeeper knowledge load failed:', state.error);
    }
    return state;
  }

  function match(text, limit = 3) {
    return state.entries
      .map(entry => ({ ...entry, score: scoreEntry(entry, text) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  function buildSuggestion(text) {
    const matched = match(text, 2);
    if (!matched.length) return '';
    const lead = '您好，這類旅遊權益問題我先幫您整理重點：';
    const body = matched.map(entry => entry.reply_template || entry.answer || '').filter(Boolean).join('\n\n');
    const sources = [...new Set(matched.map(entry => entry.source || entry.documentTitle).filter(Boolean))];
    const tail = [
      '為了協助您確認適用規定，請再提供訂單編號、出發日期、旅客姓名，以及目前遇到的狀況，我們會依實際契約與供應商規定協助確認。',
      sources.length ? `參考來源：${sources.join('、')}` : '',
    ].filter(Boolean).join('\n');
    return `${lead}\n\n${body}\n\n${tail}`;
  }

  window.TravelKeeperTravelQa = {
    manifestPath,
    workerManifestUrl,
    get loaded() { return state.loaded; },
    get error() { return state.error; },
    get manifest() { return state.manifest; },
    get documents() { return state.documents; },
    get entries() { return state.entries; },
    ready: load(),
    reload: load,
    match,
    buildSuggestion,
  };
})();
