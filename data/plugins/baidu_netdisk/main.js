/**
 * 百度网盘插件 —— main.js
 * 插件路径: data/plugins/baidu_netdisk
 * 
 * 功能:
 * - 授权（获取链接、提交码、轮询验证）
 * - 文件浏览（目录展开、面包屑导航、返回上级、刷新）
 * - 下载（重命名、自动更新本地状态、刷新主程序列表）
 * - 上传（支持浏览本地图包目录选择文件、自动检测云端重复）
 * - 配额显示、已下载状态标识
 */

const API_BASE = '/api/plugins/baidu_netdisk';
const POLL_INTERVAL = 5000;
const ALLOWED_EXTS = ['.zip', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

export default class BaiduNetdiskPlugin extends SketchApp.Plugin {
    constructor(app) {
        super(app);

        this.authState = {
            authorized: false,
            verifying: false,
            quota: null,
            used: null,
            message: ''
        };
        this.authUrl = '';
        this.authCode = '';
        this.isAuthLoading = false;
        this.isSubmitLoading = false;
        this.isPolling = false;
        this.pollTimer = null;

        this.files = [];
        this.currentPath = '/';
        this.pathStack = ['/'];
        this.isFilesLoading = false;
        this.selectedFile = null;
        this.downloadingFile = null;
        this.isDownloadLoading = false;

        // 上传相关
        this.uploadFile = null;
        this.isUploadLoading = false;
        this.uploadingFilePath = null;

        this.panel = null;
        this.ribbonBtn = null;
    }

    async onload() {
        this.ribbonBtn = this.addRibbonButton('baidu-netdisk', {
            icon: '☁️',
            title: '百度网盘',
            callback: () => this.togglePanel()
        });

        this.panel = this.addPanel('main', {
            title: '百度网盘',
            icon: '☁️'
        });

        await this.injectStyles();  // 加载外部样式
        this.render();
        await this.checkAuthStatus();
        if (this.authState.verifying) {
            this.startPolling();
        }
    }

    togglePanel() {
        const panelId = `${this.id}-main`;
        this.app.ui.showPanel(panelId);
    }

    // ========== API 请求 ==========
    async apiGet(path) {
        const res = await fetch(API_BASE + path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async apiPost(path, body) {
        const res = await fetch(API_BASE + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: '请求失败' }));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }
        return res.json();
    }

    // ========== 授权 ==========
    async checkAuthStatus() {
        if (this.isPolling) return;
        this.isPolling = true;
        try {
            const data = await this.apiGet('/auth/status');
            this.authState = data;
            if (data.authorized) {
                this.authUrl = '';
                this.authCode = '';
                this.stopPolling();
                if (this.files.length === 0) {
                    await this.loadFiles('/');
                }
            }
            this.render();
        } catch (e) {
            console.error('[BaiduNetdisk] 检查授权状态失败:', e);
        } finally {
            this.isPolling = false;
        }
    }

    async startAuth() {
        if (this.isAuthLoading) return;
        this.isAuthLoading = true;
        this.render();
        try {
            const data = await this.apiPost('/auth/start', {});
            if (data.success && data.url) {
                this.authUrl = data.url;
                window.open(this.authUrl, '_blank');
                this.app.ui.notice('🔗 已打开授权页面，请登录并复制授权码');
            } else if (data.success && !data.url) {
                await this.checkAuthStatus();
            } else {
                this.authState.message = data.message || '获取授权链接失败';
                this.app.ui.notice('❌ ' + this.authState.message);
            }
        } catch (e) {
            this.authState.message = '获取授权链接失败: ' + e.message;
            this.app.ui.notice('❌ ' + this.authState.message);
        } finally {
            this.isAuthLoading = false;
            this.render();
        }
    }

    async submitAuthCode() {
        if (!this.authCode.trim() || this.isSubmitLoading) return;
        this.isSubmitLoading = true;
        this.render();
        try {
            const data = await this.apiPost('/auth/code', { code: this.authCode.trim() });
            if (data.success) {
                if (data.verifying) {
                    this.authState.verifying = true;
                    this.startPolling();
                    this.app.ui.notice('⏳ 授权码已提交，正在验证...');
                } else {
                    this.authUrl = '';
                    this.authCode = '';
                    this.stopPolling();
                    await this.checkAuthStatus();
                    this.app.ui.notice('✅ 百度网盘授权成功');
                }
            } else {
                this.authState.message = data.message || '授权失败';
                this.app.ui.notice('❌ ' + this.authState.message);
            }
        } catch (e) {
            this.authState.message = '提交授权码失败: ' + e.message;
            this.app.ui.notice('❌ ' + this.authState.message);
        } finally {
            this.isSubmitLoading = false;
            this.render();
        }
    }

    async disconnect() {
        if (!confirm('确定要断开与百度网盘的连接吗？')) return;
        try {
            await this.apiPost('/auth/disconnect', {});
            this.authState = { authorized: false, verifying: false, quota: null, used: null, message: '' };
            this.files = [];
            this.currentPath = '/';
            this.pathStack = ['/'];
            this.stopPolling();
            this.app.ui.notice('🔌 已断开百度网盘连接');
            this.render();
        } catch (e) {
            console.error('[BaiduNetdisk] 断开连接失败:', e);
            this.app.ui.notice('❌ 断开连接失败');
        }
    }

    // ========== 文件浏览 ==========
    async loadFiles(path) {
        this.isFilesLoading = true;
        this.render();
        try {
            const data = await this.apiPost('/files', { path });
            this.files = data.list || [];
            this.currentPath = data.current_path || path;
        } catch (e) {
            if (e.message.includes('401') || e.message.includes('未授权')) {
                this.authState = { authorized: false, verifying: false, message: '授权已过期' };
                this.files = [];
                this.app.ui.notice('⚠️ 授权已过期，请重新授权');
            } else {
                this.authState.message = '加载文件失败: ' + e.message;
                this.app.ui.notice('❌ ' + this.authState.message);
            }
        } finally {
            this.isFilesLoading = false;
            this.render();
        }
    }

    enterDirectory(file) {
        this.pathStack.push(file.path);
        this.loadFiles(file.path);
    }

    goBack() {
        if (this.pathStack.length <= 1) return;
        this.pathStack.pop();
        const parentPath = this.pathStack[this.pathStack.length - 1];
        this.loadFiles(parentPath);
    }

    navigateTo(index) {
        const segments = this.currentPath.split('/').filter(Boolean);
        const newPath = '/' + segments.slice(0, index).join('/');
        this.pathStack = this.pathStack.slice(0, index + 1);
        if (this.pathStack.length === 0) this.pathStack = ['/'];
        this.loadFiles(newPath || '/');
    }

    refreshFiles() {
        this.loadFiles(this.currentPath);
    }

    // ========== 下载 ==========
    showDownloadDialog(file) {
        this.selectedFile = file;
        this.render();
    }

    closeDownloadDialog() {
        this.selectedFile = null;
        this.render();
    }

    async confirmDownload() {
        if (!this.selectedFile) return;
        const input = this.panel.querySelector('#bn-download-name');
        const packageName = input ? input.value.trim() : '';
        if (!packageName) {
            this.app.ui.notice('⚠️ 请输入图包名称');
            return;
        }
        this.isDownloadLoading = true;
        this.downloadingFile = this.selectedFile.path;
        this.render();
        try {
            const data = await this.apiPost('/download', {
                remote_path: this.selectedFile.path,
                package_name: packageName
            });
            if (data.success) {
                this.selectedFile = null;
                this.app.ui.notice(`✅ 下载成功！\n保存路径: ${data.local_path}`);
                await this.loadFiles(this.currentPath);
                if (typeof window.loadPackages === 'function') {
                    window.loadPackages();
                }
            } else {
                this.app.ui.notice('❌ 下载失败: ' + (data.message || '未知错误'));
                this.selectedFile = null;
            }
        } catch (e) {
            this.app.ui.notice('❌ 下载失败: ' + e.message);
            this.selectedFile = null;
        } finally {
            this.isDownloadLoading = false;
            this.downloadingFile = null;
            this.render();
        }
    }

    // ========== 上传 ==========
    showUploadDialog() {
        this.uploadFile = { name: '' };
        this.render();
        setTimeout(() => {
            const container = this.panel?.querySelector('#bn-local-files-container');
            if (container) {
                // 默认不展开
            }
        }, 50);
    }

    closeUploadDialog() {
        this.uploadFile = null;
        this.render();
    }

    async confirmUpload() {
        const localInput = this.panel.querySelector('#bn-upload-local');
        const remoteInput = this.panel.querySelector('#bn-upload-remote');
        const localName = localInput ? localInput.value.trim() : '';
        let remoteName = remoteInput ? remoteInput.value.trim() : '';
        if (!localName) {
            this.app.ui.notice('⚠️ 请输入本地文件名');
            return;
        }
        if (!remoteName) remoteName = localName;

        this.isUploadLoading = true;
        this.uploadingFilePath = localName;
        this.render();

        try {
            const data = await this.apiPost('/upload', {
                local_path: localName,
                remote_filename: remoteName
            });
            if (data.success) {
                this.uploadFile = null;
                this.app.ui.notice(`✅ 上传成功: ${data.remote_path}`);
                await this.loadFiles(this.currentPath);
                if (typeof window.loadPackages === 'function') window.loadPackages();
            } else {
                this.app.ui.notice('❌ 上传失败: ' + (data.message || '未知错误'));
                this.uploadFile = null;
            }
        } catch (e) {
            this.app.ui.notice('❌ 上传异常: ' + e.message);
            this.uploadFile = null;
        } finally {
            this.isUploadLoading = false;
            this.uploadingFilePath = null;
            this.render();
        }
    }

    // ========== 浏览本地文件（新增） ==========
    async listLocalFiles() {
        const container = this.panel.querySelector('#bn-local-files-container');
        if (!container) return;
        if (container.style.display === 'block') {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'block';
        container.innerHTML = '<div style="text-align:center;padding:10px;color:#64748b;">加载中...</div>';

        try {
            const resp = await fetch('/api/list?dir=');
            const data = await resp.json();
            const files = data.files || [];
            if (files.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:10px;color:#64748b;">图包目录为空</div>';
                return;
            }
            const allowedExts = ['.zip', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
            const filtered = files.filter(f => {
                const ext = f.slice(f.lastIndexOf('.')).toLowerCase();
                return allowedExts.includes(ext);
            });
            if (filtered.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:10px;color:#64748b;">没有可上传的文件（支持 zip/图片）</div>';
                return;
            }
            let html = '<ul class="bn-local-file-list">';
            filtered.forEach(f => {
                html += `<li data-file="${this.escapeHtml(f)}">${this.escapeHtml(f)}</li>`;
            });
            html += '</ul>';
            container.innerHTML = html;

            container.querySelectorAll('.bn-local-file-list li').forEach(li => {
                li.addEventListener('click', () => {
                    const fileName = li.dataset.file;
                    this.selectLocalFile(fileName);
                });
            });
        } catch (e) {
            container.innerHTML = `<div style="color:#ef4444;padding:10px;">加载失败: ${e.message}</div>`;
        }
    }

    selectLocalFile(fileName) {
        const input = this.panel.querySelector('#bn-upload-local');
        if (input) {
            input.value = fileName;
            const remoteInput = this.panel.querySelector('#bn-upload-remote');
            if (remoteInput && !remoteInput.value.trim()) {
                remoteInput.value = fileName;
            }
        }
        const container = this.panel.querySelector('#bn-local-files-container');
        if (container) container.style.display = 'none';
    }

    // ========== 轮询 ==========
    startPolling() {
        this.stopPolling();
        this.pollTimer = setInterval(() => this.checkAuthStatus(), POLL_INTERVAL);
    }

    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    // ========== 工具 ==========
    isImage(ext) {
        return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(ext);
    }

    formatSize(size) {
        if (!size || size === 'unknown') return '-';
        if (typeof size === 'string' && /[KMGT]B$/.test(size)) return size;
        let s = parseInt(size);
        if (isNaN(s)) return size;
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        while (s >= 1024 && i < units.length - 1) { s /= 1024; i++; }
        return s.toFixed(2) + ' ' + units[i];
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ========== 渲染 ==========
    render() {
        if (!this.panel) return;
        this.panel.innerHTML = this.authState.authorized
            ? this.renderFileBrowser()
            : this.renderAuthPanel();
        this.bindEvents();
    }

    renderAuthPanel() {
        if (this.authUrl) {
            return `
                <div class="bn-auth-panel">
                    <div class="bn-auth-url-box">
                        <p class="bn-label">请访问以下链接完成授权：</p>
                        <div class="bn-url-row">
                            <input type="text" class="bn-url-input" value="${this.escapeHtml(this.authUrl)}" readonly id="bn-auth-url">
                            <button class="bn-btn bn-btn-secondary" id="bn-copy-url">复制</button>
                            <a href="${this.escapeHtml(this.authUrl)}" target="_blank" class="bn-btn bn-btn-secondary">打开</a>
                        </div>
                        <p class="bn-hint">授权完成后，将页面中的授权码粘贴到下方</p>
                    </div>
                    <div class="bn-code-row">
                        <input type="text" class="bn-code-input" placeholder="粘贴授权码" 
                            value="${this.escapeHtml(this.authCode)}" id="bn-auth-code" 
                            ${this.isSubmitLoading ? 'disabled' : ''}>
                        <button class="bn-btn bn-btn-primary" id="bn-submit-code" 
                            ${!this.authCode.trim() || this.isSubmitLoading ? 'disabled' : ''}>
                            ${this.isSubmitLoading ? '<span class="bn-spinner"></span> 提交中...' : '提交授权码'}
                        </button>
                    </div>
                    <div class="bn-auth-actions">
                        <button class="bn-btn bn-btn-text" id="bn-reset-auth">重新获取链接</button>
                    </div>
                    ${this.authState.message ? `<p class="bn-error">${this.escapeHtml(this.authState.message)}</p>` : ''}
                </div>
            `;
        }
        return `
            <div class="bn-auth-panel">
                <div class="bn-auth-start">
                    <p class="bn-auth-desc">连接百度网盘，浏览和下载图包文件</p>
                    <button class="bn-btn bn-btn-primary" id="bn-start-auth" ${this.isAuthLoading ? 'disabled' : ''}>
                        ${this.isAuthLoading ? '<span class="bn-spinner"></span> 获取中...' : '获取授权链接'}
                    </button>
                    ${this.authState.verifying ? '<p class="bn-info"><span class="bn-spinner"></span> 正在验证授权...</p>' : ''}
                    ${this.authState.message ? `<p class="bn-error">${this.escapeHtml(this.authState.message)}</p>` : ''}
                </div>
            </div>
        `;
    }

    renderFileBrowser() {
        const segments = this.currentPath.split('/').filter(Boolean);
        let breadcrumbHtml = segments.map((seg, idx) => {
            const isLast = idx === segments.length - 1;
            return `<span class="bn-breadcrumb-item ${isLast ? 'active' : ''}" data-idx="${idx + 1}">${this.escapeHtml(seg)}</span>`;
        }).join('<span class="bn-breadcrumb-sep">/</span>');
        if (segments.length === 0) {
            breadcrumbHtml = '<span class="bn-breadcrumb-item active">根目录</span>';
        } else {
            breadcrumbHtml = '<span class="bn-breadcrumb-item" data-idx="0">根目录</span><span class="bn-breadcrumb-sep">/</span>' + breadcrumbHtml;
        }

        let filesHtml = '';
        if (this.isFilesLoading && this.files.length === 0) {
            filesHtml = `<div class="bn-loading"><div class="bn-spinner bn-spinner-large"></div><span>加载中...</span></div>`;
        } else if (this.files.length === 0) {
            filesHtml = `<div class="bn-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><p>该目录为空</p></div>`;
        } else {
            filesHtml = this.files.map(file => {
                const isDir = file.isdir;
                const ext = file.ext || '';
                const isAllowed = isDir || ALLOWED_EXTS.includes(ext);
                const isSelected = this.selectedFile && this.selectedFile.path === file.path;
                const isDownloading = this.downloadingFile === file.path;
                const isDownloaded = file.downloaded || false;

                let iconSvg = '';
                if (isDir) {
                    iconSvg = `<svg class="bn-icon-folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
                } else if (this.isImage(ext)) {
                    iconSvg = `<svg class="bn-icon-image" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
                } else if (ext === '.zip') {
                    iconSvg = `<svg class="bn-icon-zip" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
                } else {
                    iconSvg = `<svg class="bn-icon-file" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`;
                }

                return `
                    <div class="bn-file-item ${isDir ? 'bn-directory' : ''} ${!isAllowed ? 'bn-not-allowed' : ''} ${isSelected ? 'bn-selected' : ''}"
                        data-path="${this.escapeHtml(file.path)}" data-isdir="${isDir}">
                        <div class="bn-file-icon">${iconSvg}</div>
                        <div class="bn-file-info">
                            <span class="bn-file-name" title="${this.escapeHtml(file.name)}">
                                ${this.escapeHtml(file.name)}
                                ${isDownloaded ? '<span class="bn-downloaded-badge">已下载</span>' : ''}
                            </span>
                            ${!isDir ? `<span class="bn-file-size">${this.formatSize(file.size)}</span>` : ''}
                        </div>
                        <div class="bn-file-actions">
                            ${!isDir && isAllowed ? `
                                <button class="bn-btn bn-btn-small bn-btn-primary bn-download-btn" 
                                    data-path="${this.escapeHtml(file.path)}" data-name="${this.escapeHtml(file.name)}"
                                    ${(isDownloading || isDownloaded) ? 'disabled' : ''}>
                                    ${isDownloading ? '<span class="bn-spinner"></span>' : ''}
                                    ${isDownloaded ? '已下载 ✅' : '下载'}
                                </button>
                            ` : ''}
                            ${!isDir && !isAllowed ? '<span class="bn-not-allowed-tag">不支持</span>' : ''}
                            ${isDir ? `<svg class="bn-enter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        const quotaText = this.authState.quota && this.authState.quota !== 'unknown'
            ? `${this.formatSize(this.authState.used)} / ${this.formatSize(this.authState.quota)}`
            : '';

        return `
            <div class="bn-file-browser">
                <div class="bn-breadcrumb-bar">
                    <button class="bn-btn bn-btn-icon" id="bn-go-back" ${this.pathStack.length <= 1 ? 'disabled' : ''}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <div class="bn-breadcrumb-path">${breadcrumbHtml}</div>
                    <button class="bn-btn bn-btn-icon" id="bn-refresh" ${this.isFilesLoading ? 'disabled' : ''}>
                        <svg class="${this.isFilesLoading ? 'bn-spin' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    </button>
                </div>
                <div class="bn-file-list">${filesHtml}</div>
                ${quotaText ? `<div class="bn-footer-bar"><span class="bn-quota">${quotaText}</span></div>` : ''}
                <div class="bn-footer-actions">
                    <button class="bn-btn bn-btn-text" id="bn-upload-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        上传
                    </button>
                    <button class="bn-btn bn-btn-text bn-btn-danger" id="bn-disconnect">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                        断开连接
                    </button>
                </div>
            </div>
            ${this.selectedFile ? this.renderDownloadDialog() : ''}
            ${this.uploadFile ? this.renderUploadDialog() : ''}
        `;
    }

    renderDownloadDialog() {
        if (!this.selectedFile) return '';
        const defaultName = this.selectedFile.name.replace(/\.[^/.]+$/, '');
        return `
            <div class="bn-dialog-overlay" id="bn-dialog-overlay">
                <div class="bn-dialog">
                    <h3>下载图包</h3>
                    <p>将 <strong>${this.escapeHtml(this.selectedFile.name)}</strong> 下载到本地图包目录</p>
                    <div class="bn-dialog-input">
                        <label>图包名称：</label>
                        <input type="text" class="bn-input" id="bn-download-name" value="${this.escapeHtml(defaultName)}" placeholder="输入图包名称">
                    </div>
                    <div class="bn-dialog-actions">
                        <button class="bn-btn bn-btn-secondary" id="bn-cancel-download">取消</button>
                        <button class="bn-btn bn-btn-primary" id="bn-confirm-download" ${this.isDownloadLoading ? 'disabled' : ''}>
                            ${this.isDownloadLoading ? '<span class="bn-spinner"></span> 下载中...' : '确认下载'}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    renderUploadDialog() {
        return `
            <div class="bn-dialog-overlay" id="bn-upload-dialog-overlay">
                <div class="bn-dialog" style="max-width: 500px;">
                    <h3>上传图包</h3>
                    <p>选择本地图包目录中的文件上传到百度网盘根目录</p>
                    <div class="bn-dialog-input">
                        <label>本地文件名：</label>
                        <div style="display: flex; gap: 8px;">
                            <input type="text" class="bn-input" id="bn-upload-local" placeholder="输入文件名或浏览选择" style="flex:1;">
                            <button class="bn-btn bn-btn-secondary" id="bn-browse-local" style="flex-shrink:0;">浏览</button>
                        </div>
                    </div>
                    <div id="bn-local-files-container">
                        <!-- 动态插入文件列表 -->
                    </div>
                    <div class="bn-dialog-input">
                        <label>云端文件名（可选，留空则使用本地文件名）：</label>
                        <input type="text" class="bn-input" id="bn-upload-remote" placeholder="留空则自动使用本地文件名">
                    </div>
                    <div class="bn-dialog-actions">
                        <button class="bn-btn bn-btn-secondary" id="bn-cancel-upload">取消</button>
                        <button class="bn-btn bn-btn-primary" id="bn-confirm-upload" ${this.isUploadLoading ? 'disabled' : ''}>
                            ${this.isUploadLoading ? '<span class="bn-spinner"></span> 上传中...' : '确认上传'}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // ========== 事件绑定 ==========
    bindEvents() {
        const panel = this.panel;
        if (!panel) return;

        // 授权
        const startAuthBtn = panel.querySelector('#bn-start-auth');
        if (startAuthBtn) startAuthBtn.addEventListener('click', () => this.startAuth());

        const copyUrlBtn = panel.querySelector('#bn-copy-url');
        if (copyUrlBtn) {
            copyUrlBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(this.authUrl).then(() => {
                    copyUrlBtn.textContent = '已复制';
                    setTimeout(() => { copyUrlBtn.textContent = '复制'; }, 2000);
                }).catch(() => {
                    const input = panel.querySelector('#bn-auth-url');
                    if (input) { input.select(); document.execCommand('copy'); }
                    copyUrlBtn.textContent = '已复制';
                    setTimeout(() => { copyUrlBtn.textContent = '复制'; }, 2000);
                });
            });
        }

        const authCodeInput = panel.querySelector('#bn-auth-code');
        if (authCodeInput) {
            authCodeInput.addEventListener('input', (e) => {
                this.authCode = e.target.value;
                this.render();
            });
            authCodeInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.submitAuthCode();
            });
        }

        const submitCodeBtn = panel.querySelector('#bn-submit-code');
        if (submitCodeBtn) submitCodeBtn.addEventListener('click', () => this.submitAuthCode());

        const resetAuthBtn = panel.querySelector('#bn-reset-auth');
        if (resetAuthBtn) {
            resetAuthBtn.addEventListener('click', () => {
                this.authUrl = '';
                this.authCode = '';
                this.authState.message = '';
                this.render();
            });
        }

        // 文件浏览
        const goBackBtn = panel.querySelector('#bn-go-back');
        if (goBackBtn) goBackBtn.addEventListener('click', () => this.goBack());

        const refreshBtn = panel.querySelector('#bn-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshFiles());

        panel.querySelectorAll('.bn-breadcrumb-item').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.idx);
                this.navigateTo(idx);
            });
        });

        panel.querySelectorAll('.bn-file-item').forEach(el => {
            el.addEventListener('click', () => {
                const isDir = el.dataset.isdir === 'true';
                const filePath = el.dataset.path;
                const file = this.files.find(f => f.path === filePath);
                if (!file) return;
                if (isDir) {
                    this.enterDirectory(file);
                } else {
                    this.showDownloadDialog(file);
                }
            });
        });

        panel.querySelectorAll('.bn-download-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const filePath = el.dataset.path;
                const file = this.files.find(f => f.path === filePath);
                if (file) this.showDownloadDialog(file);
            });
        });

        // 上传按钮
        const uploadBtn = panel.querySelector('#bn-upload-btn');
        if (uploadBtn) uploadBtn.addEventListener('click', () => this.showUploadDialog());

        // 上传对话框事件
        const uploadOverlay = panel.querySelector('#bn-upload-dialog-overlay');
        if (uploadOverlay) {
            uploadOverlay.addEventListener('click', (e) => {
                if (e.target === uploadOverlay) this.closeUploadDialog();
            });
        }
        const cancelUploadBtn = panel.querySelector('#bn-cancel-upload');
        if (cancelUploadBtn) cancelUploadBtn.addEventListener('click', () => this.closeUploadDialog());

        const confirmUploadBtn = panel.querySelector('#bn-confirm-upload');
        if (confirmUploadBtn) confirmUploadBtn.addEventListener('click', () => this.confirmUpload());

        // 浏览本地文件
        const browseBtn = panel.querySelector('#bn-browse-local');
        if (browseBtn) {
            browseBtn.addEventListener('click', () => {
                this.listLocalFiles();
            });
        }

        const uploadLocalInput = panel.querySelector('#bn-upload-local');
        if (uploadLocalInput) {
            uploadLocalInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.confirmUpload();
            });
            setTimeout(() => uploadLocalInput.focus(), 50);
        }

        // 断开连接
        const disconnectBtn = panel.querySelector('#bn-disconnect');
        if (disconnectBtn) disconnectBtn.addEventListener('click', () => this.disconnect());

        // 下载对话框
        const dialogOverlay = panel.querySelector('#bn-dialog-overlay');
        if (dialogOverlay) {
            dialogOverlay.addEventListener('click', (e) => {
                if (e.target === dialogOverlay) this.closeDownloadDialog();
            });
        }
        const cancelDownloadBtn = panel.querySelector('#bn-cancel-download');
        if (cancelDownloadBtn) cancelDownloadBtn.addEventListener('click', () => this.closeDownloadDialog());

        const confirmDownloadBtn = panel.querySelector('#bn-confirm-download');
        if (confirmDownloadBtn) confirmDownloadBtn.addEventListener('click', () => this.confirmDownload());

        const downloadNameInput = panel.querySelector('#bn-download-name');
        if (downloadNameInput) {
            downloadNameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.confirmDownload();
            });
            setTimeout(() => downloadNameInput.focus(), 50);
        }
    }

    // ========== 样式加载（外部 CSS） ==========
    async injectStyles() {
        const styleId = `${this.id}-styles`;
        if (document.getElementById(styleId)) return;
        try {
            const response = await fetch('/api/plugins/baidu_netdisk/static/style.css');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const cssText = await response.text();
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = cssText;
            document.head.appendChild(style);
        } catch (e) {
            console.warn('[BaiduNetdisk] 加载外部样式失败，使用备用内联样式', e);
            this.injectInlineFallback();
        }
    }

    // 备用内联样式（精简版，仅保证基本可用）
    injectInlineFallback() {
        const styleId = `${this.id}-styles`;
        if (document.getElementById(styleId)) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .bn-dialog input, .bn-dialog button { background: #f1f5f9 !important; color: #bb2c44 !important; }
            .bn-btn-primary { background: #e94560 !important; color: white !important; }
            .bn-btn-secondary { background: #e2e8f0 !important; color: #7d1f1f !important; }
        `;
        document.head.appendChild(style);
    }

    onunload() {
        this.stopPolling();
        if (this.ribbonBtn) this.ribbonBtn.remove();
        this.app.ui.removePanel(`${this.id}-main`);
        const styleEl = document.getElementById(`${this.id}-styles`);
        if (styleEl) styleEl.remove();
    }
}