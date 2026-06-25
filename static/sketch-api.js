/**
 * sketch-api.js —— SketchApp 核心 API（Obsidian 模式）
 * 所有插件通过 window.SketchApp 与主应用交互
 */

// ========== 事件系统 ==========
class EventEmitter {
    constructor() {
        this._events = {};
    }
    
    on(event, callback) {
        if (!this._events[event]) this._events[event] = [];
        this._events[event].push(callback);
        return () => this.off(event, callback);
    }
    
    off(event, callback) {
        if (!this._events[event]) return;
        this._events[event] = this._events[event].filter(cb => cb !== callback);
    }
    
    once(event, callback) {
        const wrapper = (...args) => {
            callback(...args);
            this.off(event, wrapper);
        };
        return this.on(event, wrapper);
    }
    
    emit(event, ...args) {
        if (!this._events[event]) return;
        this._events[event].forEach(cb => {
            try { cb(...args); } catch (e) { console.error(`[EventEmitter] ${event}:`, e); }
        });
    }
}

// ========== Vault API（文件系统）==========
class VaultAPI {
    constructor() {
        this.baseUrl = '';
    }
    
    async read(path) {
        const resp = await fetch(`${this.baseUrl}/api/file?path=${encodeURIComponent(path)}`);
        if (!resp.ok) throw new Error(`读取失败: ${path}`);
        return await resp.blob();
    }
    
    async readText(path) {
        const resp = await fetch(`${this.baseUrl}/api/file?path=${encodeURIComponent(path)}`);
        if (!resp.ok) throw new Error(`读取失败: ${path}`);
        return await resp.text();
    }
    
    async readJson(path) {
        const text = await this.readText(path);
        return JSON.parse(text);
    }
    
    async write(path, data) {
        // data 通常是字符串，也可能是 Blob
        const body = data instanceof Blob ? data : String(data);
        const resp = await fetch(`${this.baseUrl}/api/upload?path=${encodeURIComponent(path)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream'   // 或者 text/plain
            },
            body: body
        });
        if (!resp.ok) throw new Error(`写入失败: ${path}`);
        return await resp.json();
    }
    
    async list(dir = '') {
        const resp = await fetch(`${this.baseUrl}/api/list?dir=${encodeURIComponent(dir)}`);
        return await resp.json();
    }
    
    async exists(path) {
        try {
            const resp = await fetch(`${this.baseUrl}/api/exists?path=${encodeURIComponent(path)}`);
            return (await resp.json()).exists;
        } catch { return false; }
    }
}

// ========== Practice API（练习相关）==========
class PracticeAPI extends EventEmitter {
    constructor() {
        super();
        this._currentImage = null;
        this._isPlaying = false;
        this._currentPackage = null;
        this._currentCategory = null;
        this._images = [];
        this._index = 0;
        this._interval = 60;
    }
    
    get currentImage() { return this._currentImage; }
    get isPlaying() { return this._isPlaying; }
    get currentPackage() { return this._currentPackage; }
    get currentCategory() { return this._currentCategory; }
    get images() { return [...this._images]; }
    get currentIndex() { return this._index; }
    get interval() { return this._interval; }
    
    onImageChange(callback) { return this.on('image-change', callback); }
    onPracticeStart(callback) { return this.on('practice-start', callback); }
    onPracticeEnd(callback) { return this.on('practice-end', callback); }
    onPracticePause(callback) { return this.on('practice-pause', callback); }
    onPracticeResume(callback) { return this.on('practice-resume', callback); }
    onTimerTick(callback) { return this.on('timer-tick', callback); }
    onPackageChange(callback) { return this.on('package-change', callback); }
    onFavorite(callback) { return this.on('favorite', callback); }
    
    _setState(state) {
        if (state.currentImage !== undefined) {
            this._currentImage = state.currentImage;
            this.emit('image-change', state.currentImage);
        }
        if (state.isPlaying !== undefined) {
            const wasPlaying = this._isPlaying;
            this._isPlaying = state.isPlaying;
            if (!wasPlaying && state.isPlaying) this.emit('practice-resume');
            if (wasPlaying && !state.isPlaying) this.emit('practice-pause');
        }
        if (state.images !== undefined) this._images = state.images;
        if (state.index !== undefined) this._index = state.index;
        if (state.interval !== undefined) this._interval = state.interval;
        if (state.currentPackage !== undefined) {
            this._currentPackage = state.currentPackage;
            this.emit('package-change', state.currentPackage);
        }
        if (state.currentCategory !== undefined) {
            this._currentCategory = state.currentCategory;
        }
    }
    
    _startPractice(images, options = {}) {
        this._images = images;
        this._index = 0;
        this._isPlaying = true;
        this._currentPackage = options.package || null;
        this._currentCategory = options.category || null;
        this._interval = options.interval || 60;
        this.emit('practice-start', { images, ...options });
    }
    
    _endPractice() {
        this._isPlaying = false;
        this.emit('practice-end', {
            images: this._images,
            practicedCount: this._index + 1
        });
    }
    
    _timerTick(timeLeft) {
        this.emit('timer-tick', timeLeft);
    }
    
    _favorite(data) {
        this.emit('favorite', data);
    }
}

// ========== UI API（界面操作）==========
class UIAPI {
    constructor() {
        this._ribbonButtons = new Map();
        this._commands = new Map();
        this._panels = new Map();
        this._settingTabs = new Map();
        this._styles = new Map();  // 插件加载的 CSS
    }
    
    // ===== 加载外部资源 =====
    loadCSS(url, id) {
        if (id && this._styles.has(id)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url;
            if (id) link.id = `plugin-style-${id}`;
            link.onload = () => {
                if (id) this._styles.set(id, link);
                resolve(link);
            };
            link.onerror = reject;
            document.head.appendChild(link);
        });
    }
    
    loadJS(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    unloadCSS(id) {
        const link = this._styles.get(id);
        if (link) {
            link.remove();
            this._styles.delete(id);
        }
    }
    
    // ===== 竖条按钮 =====
    addRibbonButton(id, options) {
        const { icon, title, callback } = options;
        const ribbon = document.getElementById('plugin-ribbon');
        
        if (this._ribbonButtons.has(id)) {
            this._ribbonButtons.get(id).remove();
        }
        
        const btn = document.createElement('button');
        btn.className = 'ribbon-btn plugin-btn';
        btn.id = `ribbon-${id}`;
        btn.textContent = icon || '📦';
        btn.title = title || id;
        btn.addEventListener('click', callback);
        ribbon.appendChild(btn);
        this._ribbonButtons.set(id, btn);
        return btn;
    }
    
    removeRibbonButton(id) {
        const btn = this._ribbonButtons.get(id);
        if (btn) { btn.remove(); this._ribbonButtons.delete(id); }
    }
    
    // ===== 命令注册 =====
    addCommand(id, options) {
        const { name, callback, hotkey } = options;
        this._commands.set(id, { name, callback, hotkey });
        return id;
    }
    
    executeCommand(id) {
        const cmd = this._commands.get(id);
        if (cmd) cmd.callback();
    }
    
    // ===== 面板系统 =====
    addPanel(id, options = {}) {
        const { title, icon, onShow, onHide } = options;
        
        let panel = this._panels.get(id);
        if (!panel) {
            panel = document.createElement('div');
            panel.id = `plugin-panel-${id}`;
            panel.className = 'plugin-panel';
            panel.style.cssText = 'display:none; height:100%; overflow:auto;';
            
            const container = document.getElementById('plugin-panels-container');
            if (container) container.appendChild(panel);
            this._panels.set(id, { element: panel, title, icon, onShow, onHide });
        }
        return panel;
    }
    
    showPanel(id) {
        this._panels.forEach((p, key) => {
            p.element.style.display = key === id ? 'block' : 'none';
            if (key === id && p.onShow) p.onShow();
            if (key !== id && p.onHide) p.onHide();
        });
        
        const panelData = this._panels.get(id);
        if (panelData) {
            document.getElementById('plugin-sidebar-title').textContent = panelData.title || id;
        }
        
        document.getElementById('plugin-sidebar-panel').classList.add('open');
        document.body.classList.add('sidebar-open');
        document.getElementById('plugin-list-view').style.display = 'none';
        document.getElementById('plugin-content-view').style.display = 'flex';
    }
    
    hidePanel(id) {
        const panelData = this._panels.get(id);
        if (panelData) {
            panelData.element.style.display = 'none';
            if (panelData.onHide) panelData.onHide();
        }
    }
    
    removePanel(id) {
        const panelData = this._panels.get(id);
        if (panelData) {
            panelData.element.remove();
            this._panels.delete(id);
        }
    }
    
    // ===== 设置页 =====
    addSettingTab(id, options) {
        const { name, icon, render } = options;
        this._settingTabs.set(id, { name, icon, render });
    }
    
    // ===== 通知 =====
    notice(message, duration = 3000) {
        const notice = document.createElement('div');
        notice.className = 'plugin-notice';
        notice.textContent = message;
        notice.style.cssText = `
            position: fixed; bottom: 20px; right: 20px;
            background: var(--card); color: var(--text);
            padding: 12px 20px; border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10001; animation: slideIn 0.3s ease;
        `;
        document.body.appendChild(notice);
        setTimeout(() => {
            notice.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notice.remove(), 300);
        }, duration);
    }
    
    // ===== 模态框 =====
    modal(options) {
        const { title, content, buttons = [] } = options;
        const overlay = document.createElement('div');
        overlay.className = 'plugin-modal-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); z-index: 10000;
            display: flex; justify-content: center; align-items: center;
        `;
        
        const modal = document.createElement('div');
        modal.className = 'plugin-modal';
        modal.style.cssText = `
            background: var(--card); padding: 25px; border-radius: 12px;
            max-width: 500px; width: 90%; max-height: 80vh; overflow: auto;
        `;
        
        modal.innerHTML = `
            <h3 style="margin-top:0;">${title}</h3>
            <div>${content}</div>
            <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:20px;">
                ${buttons.map(b => `<button class="btn ${b.primary ? 'primary' : ''}">${b.text}</button>`).join('')}
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        
        const btns = modal.querySelectorAll('button');
        buttons.forEach((b, i) => {
            if (btns[i]) btns[i].addEventListener('click', () => { b.callback?.(); close(); });
        });
        
        return { close };
    }
}

// ========== 插件基类 ==========
class SketchPlugin {
    constructor(app) {
        this.app = app;
        this.id = '';
        this.name = '';
        this.manifest = null;
    }
    
    async onload() {}
    onunload() {}
    
    addRibbonButton(id, options) {
        return this.app.ui.addRibbonButton(`${this.id}-${id}`, options);
    }
    
    addCommand(id, options) {
        return this.app.ui.addCommand(`${this.id}:${id}`, options);
    }
    
    addPanel(id, options) {
        return this.app.ui.addPanel(`${this.id}-${id}`, {
            ...options,
            title: options.title || `${this.name} - ${id}`
        });
    }
    
    addSettingTab(id, options) {
        return this.app.ui.addSettingTab(`${this.id}-${id}`, options);
    }
    
    notice(message, duration) {
        this.app.ui.notice(message, duration);
    }
    
    // 便捷方法：加载插件自己的资源
    loadCSS(filename) {
        return this.app.ui.loadCSS(`/plugins/${this.id}/${filename}`, `${this.id}-${filename}`);
    }
    
    loadJS(filename) {
        return this.app.ui.loadJS(`/plugins/${this.id}/${filename}`);
    }
    
    unloadCSS(filename) {
        this.app.ui.unloadCSS(`${this.id}-${filename}`);
    }
}

// ========== 全局 SketchApp 对象 ==========
window.SketchApp = {
    vault: new VaultAPI(),
    practice: new PracticeAPI(),
    ui: new UIAPI(),
    events: new EventEmitter(),
    version: '1.0.0',
    Plugin: SketchPlugin,
    
    _internal: {
        setState: (state) => window.SketchApp.practice._setState(state),
        startPractice: (images, options) => window.SketchApp.practice._startPractice(images, options),
        endPractice: () => window.SketchApp.practice._endPractice(),
        timerTick: (timeLeft) => window.SketchApp.practice._timerTick(timeLeft),
        favorite: (data) => window.SketchApp.practice._favorite(data)
    }
};

window.SketchApp.EventEmitter = EventEmitter;
