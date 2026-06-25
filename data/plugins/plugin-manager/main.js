/**
 * Plugin Manager —— 插件管理器
 * 提供插件列表、启用/禁用、重新加载、卸载、日志查看功能
 * 配置读写使用通用 vault API（依赖后端映射 /data/ → 真实数据目录）
 */

class PluginManagerPlugin extends SketchPlugin {
    constructor(app) {
        super(app);
        this.configPath = '/data/plugins/plugin-manager/config.json';
        this.config = { disabled_plugins: [], plugin_settings: {} };
        this.logs = [];
        this.currentView = 'list'; // 'list' | 'detail'
        this.selectedManifest = null;
        this.allManifests = [];
        this.searchQuery = '';
    }

    async onload() {
        // 加载专属样式
        await this.loadCSS('styles.css');

        // 读取持久化配置
        await this.loadConfig();

        // 注册 Ribbon 按钮
        this.addRibbonButton('open-manager', {
            icon: '🔌',
            title: '插件管理器',
            callback: () => this.openManager()
        });

        // 注册主面板
        this.panel = this.addPanel('main', {
            title: '插件管理器',
            icon: '🔌',
            onShow: () => this.refreshList(),
            onHide: () => {}
        });

        // 初始化面板内部结构
        this.initPanelContent();

        // 延迟应用禁用配置（等待其他插件加载完毕）
        setTimeout(() => this.applyDisabledPlugins(), 100);
    }

    onunload() {
        this.unloadCSS('styles.css');
    }

    // ========== 配置持久化（使用 vault API） ==========
    async loadConfig() {
        try {
            const text = await this.app.vault.readText(this.configPath);
            this.config = JSON.parse(text);
        } catch (e) {
            console.warn('[PluginManager] 加载配置失败，使用默认配置', e);
            this.config = { disabled_plugins: [], plugin_settings: {} };
        }
    }

    async saveConfig() {
        try {
            await this.app.vault.write(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (e) {
            console.error('[PluginManager] 保存配置失败:', e);
            this.addLog('error', 'system', '保存配置失败: ' + e.message);
        }
    }

    async applyDisabledPlugins() {
        try {
            const resp = await fetch('/api/plugins/list');
            const data = await resp.json();
            const manifests = data.plugins || [];

            for (const manifest of manifests) {
                if (manifest.id === this.id) continue;
                if (this.config.disabled_plugins.includes(manifest.id)) {
                    if (window.pluginManager.plugins.has(manifest.id)) {
                        window.pluginManager.unloadPlugin(manifest.id);
                        this.addLog('unload', manifest.id, '启动时根据配置自动禁用');
                    }
                }
            }
        } catch (e) {
            console.error('[PluginManager] 应用禁用配置失败:', e);
        }
    }

    // ========== UI 构建 ==========
    initPanelContent() {
        this.panel.innerHTML = '';
        this.panel.style.cssText = 'display:flex; flex-direction:column; height:100%; padding:0;';

        // 列表视图
        this.listView = document.createElement('div');
        this.listView.className = 'pm-list-view';
        this.listView.style.cssText = 'flex:1; overflow:auto; padding:16px; display:flex; flex-direction:column;';

        // 详情视图
        this.detailView = document.createElement('div');
        this.detailView.className = 'pm-detail-view';
        this.detailView.style.cssText = 'flex:1; overflow:auto; padding:16px; display:none; flex-direction:column;';

        this.panel.appendChild(this.listView);
        this.panel.appendChild(this.detailView);

        this.renderListView();
    }

    openManager() {
        this.app.ui.showPanel(`${this.id}-main`);
        this.refreshList();
    }

    renderListView() {
        this.listView.innerHTML = '';

        // 搜索栏
        const searchWrap = document.createElement('div');
        searchWrap.className = 'pm-search-wrap';
        searchWrap.innerHTML = `<input type="text" class="pm-search-input" placeholder="搜索插件名称、ID或描述...">`;
        const searchInput = searchWrap.querySelector('input');
        searchInput.addEventListener('input', (e) => {
            this.searchQuery = e.target.value.trim().toLowerCase();
            this.renderPluginGrid();
        });
        this.listView.appendChild(searchWrap);

        // 统计信息
        this.statsBar = document.createElement('div');
        this.statsBar.className = 'pm-stats-bar';
        this.statsBar.style.cssText = 'font-size:0.8rem; color:#888; margin-bottom:10px;';
        this.listView.appendChild(this.statsBar);

        // 插件网格
        this.gridContainer = document.createElement('div');
        this.gridContainer.className = 'pm-grid';
        this.listView.appendChild(this.gridContainer);

        // 底部操作栏
        const footer = document.createElement('div');
        footer.className = 'pm-footer';
        footer.innerHTML = `
            <button class="btn small pm-refresh-btn">🔄 刷新</button>
            <button class="btn small pm-logs-btn">📋 日志</button>
        `;
        footer.querySelector('.pm-refresh-btn').addEventListener('click', () => this.refreshList());
        footer.querySelector('.pm-logs-btn').addEventListener('click', () => this.showLogs());
        this.listView.appendChild(footer);

        this.renderPluginGrid();
    }

    async refreshList() {
        try {
            const resp = await fetch('/api/plugins/list');
            const data = await resp.json();
            this.allManifests = data.plugins || [];
            this.renderPluginGrid();
        } catch (e) {
            this.app.ui.notice('获取插件列表失败');
            console.error('[PluginManager]', e);
        }
    }

    renderPluginGrid() {
        if (!this.gridContainer) return;
        this.gridContainer.innerHTML = '';

        const filtered = this.allManifests.filter(m => {
            const q = this.searchQuery;
            if (!q) return true;
            const name = (m.name || '').toLowerCase();
            const id = (m.id || '').toLowerCase();
            const desc = (m.description || '').toLowerCase();
            return name.includes(q) || id.includes(q) || desc.includes(q);
        });

        // 更新统计
        const total = this.allManifests.length;
        const loaded = this.allManifests.filter(m => window.pluginManager.plugins.has(m.id)).length;
        if (this.statsBar) {
            this.statsBar.textContent = `共 ${total} 个插件 | 已加载 ${loaded} 个${this.searchQuery ? ' | 筛选结果: ' + filtered.length + ' 个' : ''}`;
        }

        if (filtered.length === 0) {
            this.gridContainer.innerHTML = '<div class="pm-empty">暂无匹配插件</div>';
            return;
        }

        filtered.forEach(manifest => {
            const card = this.createPluginCard(manifest);
            this.gridContainer.appendChild(card);
        });
    }

    createPluginCard(manifest) {
        const isSelf = manifest.id === this.id;
        const isLoaded = window.pluginManager.plugins.has(manifest.id);
        const isEnabled = !this.config.disabled_plugins.includes(manifest.id);

        const card = document.createElement('div');
        card.className = `pm-card ${!isEnabled ? 'disabled' : ''}`;

        card.innerHTML = `
            <div class="pm-card-header">
                <div class="pm-card-icon">${manifest.icon || '📦'}</div>
                <div class="pm-card-version">v${manifest.version || '0.0.0'}</div>
            </div>
            <div class="pm-card-body">
                <div class="pm-card-name">${manifest.name || manifest.id}</div>
                <div class="pm-card-author">${manifest.author || '未知作者'}</div>
                <div class="pm-card-desc" title="${manifest.description || ''}">${manifest.description || '暂无描述'}</div>
            </div>
            <div class="pm-card-footer">
                <label class="pm-toggle-wrap">
                    <input type="checkbox" class="pm-toggle" ${isEnabled ? 'checked' : ''} ${isSelf ? 'disabled' : ''}>
                    <span class="pm-toggle-label">${isEnabled ? '已启用' : '已禁用'}</span>
                </label>
                ${isSelf ? '<span class="pm-badge">核心</span>' : ''}
            </div>
        `;

        // 开关事件
        const toggle = card.querySelector('.pm-toggle');
        if (!isSelf) {
            toggle.addEventListener('change', async (e) => {
                e.stopPropagation();
                await this.togglePlugin(manifest, e.target.checked);
            });
        }

        // 点击卡片进入详情
        card.addEventListener('click', (e) => {
            if (e.target.closest('.pm-toggle-wrap')) return;
            this.showDetail(manifest);
        });

        return card;
    }

    // ========== 详情视图 ==========
    showDetail(manifest) {
        this.selectedManifest = manifest;
        this.currentView = 'detail';
        this.listView.style.display = 'none';
        this.detailView.style.display = 'flex';
        this.detailView.innerHTML = '';

        const isSelf = manifest.id === this.id;
        const isEnabled = !this.config.disabled_plugins.includes(manifest.id);
        const plugin = window.pluginManager.getPlugin(manifest.id);

        // 头部导航
        const header = document.createElement('div');
        header.className = 'pm-detail-header';
        header.innerHTML = `
            <button class="btn small pm-back-btn">← 返回列表</button>
            <div style="flex:1;"></div>
            <button class="btn small pm-reload-btn" ${isSelf ? 'disabled' : ''}>🔄 重新加载</button>
        `;
        header.querySelector('.pm-back-btn').addEventListener('click', () => this.backToList());
        const reloadBtn = header.querySelector('.pm-reload-btn');
        if (!isSelf) {
            reloadBtn.addEventListener('click', () => this.reloadPlugin(manifest.id));
        }
        this.detailView.appendChild(header);

        // 基本信息
        const info = document.createElement('div');
        info.className = 'pm-detail-info';
        info.innerHTML = `
            <div class="pm-detail-icon">${manifest.icon || '📦'}</div>
            <div class="pm-detail-meta">
                <h3>${manifest.name || manifest.id}</h3>
                <p><strong>ID:</strong> ${manifest.id}</p>
                <p><strong>版本:</strong> v${manifest.version || '0.0.0'} | <strong>作者:</strong> ${manifest.author || '未知'}</p>
                <p><strong>权限:</strong> ${(manifest.permissions || []).join(', ') || '无'}</p>
                <p class="pm-detail-desc">${manifest.description || '暂无描述'}</p>
            </div>
        `;
        this.detailView.appendChild(info);

        // 设置区占位
        const settingsWrap = document.createElement('div');
        settingsWrap.className = 'pm-detail-section';
        settingsWrap.innerHTML = `<h4>⚙️ 插件设置</h4>`;
        if (plugin && this.app.ui._settingTabs && this.app.ui._settingTabs.size > 0) {
            const hasSettings = Array.from(this.app.ui._settingTabs.keys()).some(k => k.startsWith(manifest.id + '-'));
            settingsWrap.innerHTML += hasSettings
                ? '<p class="pm-hint">该插件已注册设置页，可在应用设置中访问</p>'
                : '<p class="pm-hint">该插件未提供设置页</p>';
        } else {
            settingsWrap.innerHTML += '<p class="pm-hint">该插件未提供设置页</p>';
        }
        this.detailView.appendChild(settingsWrap);

        // 操作区
        const actions = document.createElement('div');
        actions.className = 'pm-detail-section';
        actions.innerHTML = `<h4>🔧 操作</h4>`;

        const btnWrap = document.createElement('div');
        btnWrap.className = 'pm-detail-actions';

        if (!isSelf) {
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'btn ' + (isEnabled ? '' : 'primary');
            toggleBtn.textContent = isEnabled ? '⏸️ 禁用' : '▶️ 启用';
            toggleBtn.addEventListener('click', async () => {
                await this.togglePlugin(manifest, !isEnabled);
                this.showDetail(manifest);
            });
            btnWrap.appendChild(toggleBtn);

            const uninstallBtn = document.createElement('button');
            uninstallBtn.className = 'btn';
            uninstallBtn.style.cssText = 'background:#f44336; color:white; border:none;';
            uninstallBtn.textContent = '🗑️ 卸载';
            uninstallBtn.addEventListener('click', () => this.confirmUninstall(manifest));
            btnWrap.appendChild(uninstallBtn);
        } else {
            btnWrap.innerHTML = '<p class="pm-hint">🔒 核心插件，不可禁用或卸载</p>';
        }

        actions.appendChild(btnWrap);
        this.detailView.appendChild(actions);

        // 日志区
        const logsSection = document.createElement('div');
        logsSection.className = 'pm-detail-section';
        logsSection.innerHTML = `<h4>📋 最近日志</h4>`;
        const pluginLogs = this.logs
            .filter(l => l.pluginId === manifest.id || l.pluginId === 'system')
            .slice(-10);
        if (pluginLogs.length === 0) {
            logsSection.innerHTML += '<p class="pm-hint">暂无相关日志</p>';
        } else {
            const logList = document.createElement('div');
            logList.className = 'pm-log-list';
            pluginLogs.reverse().forEach(log => {
                const entry = document.createElement('div');
                entry.className = 'pm-log-entry';
                entry.textContent = `[${log.time}] ${log.action}: ${log.message}`;
                logList.appendChild(entry);
            });
            logsSection.appendChild(logList);
        }
        this.detailView.appendChild(logsSection);
    }

    backToList() {
        this.currentView = 'list';
        this.detailView.style.display = 'none';
        this.listView.style.display = 'flex';
        this.refreshList();
    }

    // ========== 插件操作 ==========
    async togglePlugin(manifest, enable) {
        const id = manifest.id;
        if (id === this.id) {
            this.app.ui.notice('核心插件不可禁用');
            return;
        }

        try {
            if (enable) {
                // 从禁用列表移除并保存
                this.config.disabled_plugins = this.config.disabled_plugins.filter(pid => pid !== id);
                await this.saveConfig();

                // 加载插件（如果未加载）
                if (!window.pluginManager.plugins.has(id)) {
                    await window.pluginManager.loadPlugin(manifest);
                    this.addLog('load', id, '用户启用插件');
                    this.app.ui.notice(`插件 "${manifest.name}" 已启用`);
                }
            } else {
                // 加入禁用列表并保存
                if (!this.config.disabled_plugins.includes(id)) {
                    this.config.disabled_plugins.push(id);
                }
                await this.saveConfig();

                // 卸载插件（如果已加载）
                if (window.pluginManager.plugins.has(id)) {
                    window.pluginManager.unloadPlugin(id);
                    this.addLog('unload', id, '用户禁用插件');
                    this.app.ui.notice(`插件 "${manifest.name}" 已禁用`);
                }
            }

            // 同步主应用的插件列表 UI
            if (window.pluginManager.renderPluginList) {
                window.pluginManager.renderPluginList();
            }

            // 刷新当前视图
            if (this.currentView === 'list') {
                this.renderPluginGrid();
            } else if (this.currentView === 'detail' && this.selectedManifest?.id === id) {
                this.showDetail(manifest);
            }
        } catch (e) {
            console.error('[PluginManager] 切换插件状态失败:', e);
            this.app.ui.notice('操作失败: ' + e.message);
            this.addLog('error', id, '切换状态失败: ' + e.message);
        }
    }

    async reloadPlugin(id) {
        if (id === this.id) {
            this.app.ui.notice('核心插件不可重新加载');
            return;
        }

        try {
            const manifest = this.allManifests.find(m => m.id === id);
            if (!manifest) {
                this.app.ui.notice('找不到插件配置');
                return;
            }

            if (window.pluginManager.plugins.has(id)) {
                window.pluginManager.unloadPlugin(id);
                this.addLog('unload', id, '重新加载前卸载');
            }

            await window.pluginManager.loadPlugin(manifest);
            this.addLog('load', id, '重新加载完成');
            this.app.ui.notice(`插件 "${manifest.name}" 已重新加载`);

            if (this.currentView === 'detail' && this.selectedManifest?.id === id) {
                this.showDetail(manifest);
            }
        } catch (e) {
            console.error('[PluginManager] 重新加载失败:', e);
            this.app.ui.notice('重新加载失败: ' + e.message);
            this.addLog('error', id, '重新加载失败: ' + e.message);
        }
    }

    confirmUninstall(manifest) {
        if (manifest.id === this.id) {
            this.app.ui.notice('核心插件不可卸载');
            return;
        }

        this.app.ui.modal({
            title: '⚠️ 确认卸载',
            content: `确定要卸载插件 <strong>"${manifest.name}"</strong> 吗？<br><small>卸载后插件将从内存中移除，但磁盘文件不会被删除。如需彻底删除，请手动删除 plugins/${manifest.id}/ 目录。</small>`,
            buttons: [
                { text: '取消' },
                {
                    text: '确认卸载',
                    primary: true,
                    callback: () => this.uninstallPlugin(manifest.id)
                }
            ]
        });
    }

    async uninstallPlugin(id) {
        try {
            // 从禁用列表移除
            this.config.disabled_plugins = this.config.disabled_plugins.filter(pid => pid !== id);
            await this.saveConfig();

            // 卸载内存中的实例
            if (window.pluginManager.plugins.has(id)) {
                window.pluginManager.unloadPlugin(id);
            }

            this.addLog('uninstall', id, '插件已卸载');
            this.app.ui.notice('插件已卸载');

            // 刷新并返回列表
            await this.refreshList();
            this.backToList();
        } catch (e) {
            console.error('[PluginManager] 卸载失败:', e);
            this.app.ui.notice('卸载失败: ' + e.message);
        }
    }

    // ========== 日志系统 ==========
    addLog(action, pluginId, message) {
        const now = new Date();
        const time = now.toLocaleString('zh-CN', {
            hour12: false,
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        this.logs.push({ time, action, pluginId, message });
        if (this.logs.length > 100) {
            this.logs = this.logs.slice(-100);
        }
    }

    showLogs() {
        const content = this.logs.length === 0
            ? '<p class="pm-hint">暂无日志记录</p>'
            : `<div class="pm-log-list" style="max-height:320px; overflow:auto;">
                ${this.logs.slice().reverse().map(log =>
                    `<div class="pm-log-entry">[${log.time}] <strong>${log.action}</strong> | ${log.pluginId}: ${log.message}</div>`
                ).join('')}
            </div>`;

        this.app.ui.modal({
            title: '📋 插件管理器日志',
            content: content,
            buttons: [
                { text: '关闭' },
                {
                    text: '清空日志',
                    callback: () => {
                        this.logs = [];
                        this.app.ui.notice('日志已清空');
                    }
                }
            ]
        });
    }
}

export default PluginManagerPlugin;