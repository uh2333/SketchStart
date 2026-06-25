/**
 * sketch_image_transform —— 图片变换插件
 * 使用 CSS Transform 实现旋转/翻转，零性能损耗，兼容其他插件
 */

const API_BASE = '/api/plugins/image_transform';

export default class SketchImageTransformPlugin extends SketchApp.Plugin {
    constructor(app) {
        super(app);
        this.rotation = 0;
        this.flipH = false;
        this.flipV = false;
        this.keepSettings = false;

        this.presets = [];
        this.panel = null;
        this.ribbonBtn = null;
        this.unsubscribers = [];
    }

    async onload() {
        if (!this.id) {
            this.id = this.manifest?.id || 'img_transform';
        }

        await this.loadPresets();

        this.ribbonBtn = this.addRibbonButton('image_transform', {
            icon: '↻',
            title: '图片变换',
            callback: () => this.togglePanel()
        });

        this.unsubscribers.push(
            this.app.practice.onImageChange(() => {
                if (this.keepSettings) {
                    this.applyTransformWhenReady();
                } else {
                    this.resetExceptKeep();
                }
            })
        );

        this.panel = this.addPanel('main', {
            title: '图片变换',
            icon: '↻'
        });
        this.renderPanel();

        if (this.app.practice.currentImage) {
            this.applyTransformWhenReady();
        }
    }

    togglePanel() {
        this.app.ui.showPanel(`${this.id}-main`);
        this.syncUI();
    }

    // ========== 渲染面板 ==========
    renderPanel() {
        this.panel.innerHTML = `
            <div class="transform_panel" style="padding:15px; color:var(--text); height:100%; display:flex; flex-direction:column; gap:12px; overflow-y:auto;">
                <div class="section" style="background:var(--bg-secondary, var(--bg)); padding:12px; border-radius:8px; border:1px solid var(--border);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <label style="font-size:0.85rem;">旋转角度</label>
                        <span class="rotation_val" style="font-size:0.8rem; color:var(--primary); font-weight:600;">0°</span>
                    </div>
                    <input type="range" class="rotation_slider" min="-180" max="180" value="0" style="width:100%;">
                </div>

                <div class="section" style="background:var(--bg-secondary, var(--bg)); padding:10px 12px; border-radius:8px; border:1px solid var(--border); display:flex; flex-direction:column; gap:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <label style="font-size:0.85rem;">↔ 左右翻转</label>
                        <label class="switch" id="switch_flip_h" style="position:relative; display:inline-block; width:40px; height:22px; border-radius:22px; transition: background .3s;">
                            <input type="checkbox" class="flip_h_toggle" style="opacity:0; width:0; height:0;">
                            <span class="slider_round" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; border-radius:22px; transition:.3s;"></span>
                        </label>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <label style="font-size:0.85rem;">↕ 上下翻转</label>
                        <label class="switch" id="switch_flip_v" style="position:relative; display:inline-block; width:40px; height:22px; border-radius:22px; transition: background .3s;">
                            <input type="checkbox" class="flip_v_toggle" style="opacity:0; width:0; height:0;">
                            <span class="slider_round" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; border-radius:22px; transition:.3s;"></span>
                        </label>
                    </div>
                </div>

                <div class="section" style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-secondary, var(--bg)); padding:10px 12px; border-radius:8px; border:1px solid var(--border);">
                    <label style="font-size:0.85rem;">🔒 切换图片时保持设置</label>
                    <label class="switch" id="switch_keep" style="position:relative; display:inline-block; width:40px; height:22px; border-radius:22px; transition: background .3s;">
                        <input type="checkbox" class="keep_settings_toggle" style="opacity:0; width:0; height:0;">
                        <span class="slider_round" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; border-radius:22px; transition:.3s;"></span>
                    </label>
                </div>

                <div class="action_buttons" style="display:flex; gap:8px;">
                    <button class="reset_btn btn small" style="flex:1;">重置</button>
                    <button class="save_preset_btn btn primary small" style="flex:1;">保存预设</button>
                </div>

                <div class="presets_section" style="flex:1; min-height:0; display:flex; flex-direction:column;">
                    <div style="font-weight:600; margin-bottom:8px; font-size:0.9rem; display:flex; justify-content:space-between; align-items:center;">
                        <span>预设</span>
                        <span class="presets_count" style="font-size:0.75rem; color:#888; font-weight:normal;">(${this.presets.length})</span>
                    </div>
                    <div class="presets_list" style="flex:1; overflow-y:auto; font-size:0.85rem; border:1px solid var(--border); border-radius:8px; padding:8px; background:var(--bg-secondary, var(--bg));">
                        ${this.renderPresetsList()}
                    </div>
                </div>
            </div>
        `;

        this.addSwitchStyles();
        this.bindEvents();
        this.syncUI();
    }

    addSwitchStyles() {
        const styleId = `${this.id}_switch_styles`;
        if (document.getElementById(styleId)) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .slider_round { background-color: #ccc; }
            .switch input:checked + .slider_round { background-color: var(--primary, #4a9eff); }
            .switch input:checked + .slider_round:before { transform: translateX(18px); }
            .slider_round:before { content:""; position:absolute; height:16px; width:16px; left:3px; bottom:3px; background-color:white; border-radius:50%; transition:.3s; }
            .switch.switch_active { background: #e6f0ff; }
            .transform_panel input[type="range"] { -webkit-appearance:none; appearance:none; height:6px; border-radius:3px; background:var(--border); outline:none; }
            .transform_panel input[type="range"]::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:var(--primary); cursor:pointer; border:2px solid white; box-shadow:0 1px 3px rgba(0,0,0,0.3); }
            .transform_panel input[type="range"]::-moz-range-thumb { width:16px; height:16px; border-radius:50%; background:var(--primary); cursor:pointer; border:2px solid white; box-shadow:0 1px 3px rgba(0,0,0,0.3); }
            .preset_item { display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-radius:6px; cursor:pointer; transition:background 0.2s; margin-bottom:4px; }
            .preset_item:hover { background:var(--hover-bg, rgba(0,0,0,0.05)); }
            .preset_item .preset_name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .preset_item .preset_params { font-size:0.7rem; color:#888; margin-right:8px; }
            .preset_item .delete_btn { opacity:0.5; transition:opacity 0.2s; padding:2px 6px; border-radius:4px; background:none; border:none; cursor:pointer; color:var(--text); }
            .preset_item:hover .delete_btn { opacity:1; }
            .preset_item .delete_btn:hover { background:rgba(255,0,0,0.1); color:#e74c3c; }
        `;
        document.head.appendChild(style);
    }

    bindEvents() {
        const panel = this.panel;

        panel.querySelector('.rotation_slider').addEventListener('input', (e) => {
            this.rotation = parseInt(e.target.value);
            this.updateRotationDisplay(this.rotation);
            this.applyTransformStyle();
        });

        panel.querySelector('.flip_h_toggle').addEventListener('change', (e) => {
            this.flipH = e.target.checked;
            this.applyTransformStyle();
            this.updateSwitchStyle('switch_flip_h', e.target.checked);
        });
        panel.querySelector('.flip_v_toggle').addEventListener('change', (e) => {
            this.flipV = e.target.checked;
            this.applyTransformStyle();
            this.updateSwitchStyle('switch_flip_v', e.target.checked);
        });

        panel.querySelector('.keep_settings_toggle').addEventListener('change', (e) => {
            this.keepSettings = e.target.checked;
            this.updateSwitchStyle('switch_keep', e.target.checked);
        });

        panel.querySelector('.reset_btn').addEventListener('click', () => this.reset(true));
        panel.querySelector('.save_preset_btn').addEventListener('click', () => this.showSavePresetDialog());
    }

    updateSwitchStyle(switchId, active) {
        const el = document.getElementById(switchId);
        if (el) el.classList.toggle('switch_active', active);
    }

    updateRotationDisplay(angle) {
        const el = this.panel?.querySelector('.rotation_val');
        if (el) el.textContent = `${angle}°`;
    }

    syncUI() {
        if (!this.panel) return;
        const panel = this.panel;

        panel.querySelector('.rotation_slider').value = this.rotation;
        this.updateRotationDisplay(this.rotation);

        const flipH = panel.querySelector('.flip_h_toggle');
        if (flipH) {
            flipH.checked = this.flipH;
            this.updateSwitchStyle('switch_flip_h', this.flipH);
        }

        const flipV = panel.querySelector('.flip_v_toggle');
        if (flipV) {
            flipV.checked = this.flipV;
            this.updateSwitchStyle('switch_flip_v', this.flipV);
        }

        const keep = panel.querySelector('.keep_settings_toggle');
        if (keep) {
            keep.checked = this.keepSettings;
            this.updateSwitchStyle('switch_keep', this.keepSettings);
        }

        this.updatePresetsList();
    }

    // ========== 核心：CSS Transform 应用 ==========
    applyTransformStyle() {
        const img = document.querySelector('#player-image');
        if (!img) return;

        const scaleX = this.flipH ? -1 : 1;
        const scaleY = this.flipV ? -1 : 1;
        img.style.transform = `scale(${scaleX}, ${scaleY}) rotate(${this.rotation}deg)`;
        img.style.transformOrigin = 'center center';
        img.style.overflow = 'hidden';
    }

    removeTransformStyle() {
        const img = document.querySelector('#player-image');
        if (img) {
            img.style.transform = '';
            img.style.transformOrigin = '';
        }
    }

    applyTransformWhenReady() {
        const img = document.querySelector('#player-image');
        if (!img) return;

        if (img.complete) {
            this.applyTransformStyle();
        } else {
            const onLoad = () => {
                img.removeEventListener('load', onLoad);
                this.applyTransformStyle();
            };
            img.addEventListener('load', onLoad);
        }
    }

    resetExceptKeep() {
        this.rotation = 0;
        this.flipH = false;
        this.flipV = false;
        this.syncUI();
        this.removeTransformStyle();
    }

    reset(restoreImage = true) {
        this.keepSettings = false;
        this.resetExceptKeep();
        if (restoreImage) {
            this.app.ui.notice('✅ 已重置');
        }
    }

    // ========== 预设管理（新增 keep_settings 支持） ==========
    async loadPresets() {
        try {
            const resp = await fetch(`${API_BASE}/presets`);
            if (resp.ok) {
                const data = await resp.json();
                this.presets = (data.presets || []).map(p => ({
                    rotation: 0,
                    flip_horizontal: false,
                    flip_vertical: false,
                    keep_settings: false,   // 新增：默认不锁定
                    ...p
                }));
            }
        } catch (e) {
            console.warn('加载预设异常:', e);
            this.presets = [];
        }
        this.updatePresetsList();
    }

    async savePresetsToFile() {
        try {
            await fetch(`${API_BASE}/presets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ presets: this.presets })
            });
        } catch (e) {
            console.error('保存预设异常:', e);
            this.app.ui.notice('❌ 保存预设失败');
        }
    }

    renderPresetsList() {
        if (this.presets.length === 0) {
            return '<p style="color:#888; text-align:center; padding:20px 0;">暂无预设</p>';
        }
        return this.presets.map((p, i) => {
            const parts = [];
            if (p.rotation !== 0) parts.push(`${p.rotation}°`);
            if (p.flip_horizontal) parts.push('左右翻转');
            if (p.flip_vertical) parts.push('上下翻转');
            if (p.keep_settings) parts.push('🔒保持');   // 显示锁定状态
            const paramsStr = parts.length > 0 ? parts.join(', ') : '原始';
            return `
                <div class="preset_item" data-index="${i}">
                    <span class="preset_name">${this.escapeHtml(p.name)}</span>
                    <span class="preset_params">${paramsStr}</span>
                    <button class="delete_btn" data-index="${i}" title="删除">✕</button>
                </div>
            `;
        }).join('');
    }

    updatePresetsList() {
        const listEl = this.panel?.querySelector('.presets_list');
        const countEl = this.panel?.querySelector('.presets_count');
        if (listEl) {
            listEl.innerHTML = this.renderPresetsList();
            if (!listEl.dataset.listenerBound) {
                listEl.addEventListener('click', (e) => {
                    if (e.target.classList.contains('delete_btn')) {
                        const idx = parseInt(e.target.dataset.index, 10);
                        if (!isNaN(idx)) this.deletePreset(idx);
                        return;
                    }
                    const item = e.target.closest('.preset_item');
                    if (item) {
                        const idx = parseInt(item.dataset.index, 10);
                        if (!isNaN(idx)) this.loadPreset(idx);
                    }
                });
                listEl.dataset.listenerBound = 'true';
            }
        }
        if (countEl) countEl.textContent = `(${this.presets.length})`;
    }

    showSavePresetDialog() {
        const name = prompt('请输入预设名称：');
        if (!name || !name.trim()) return;
        const trimmed = name.trim();
        if (this.presets.some(p => p.name === trimmed)) {
            this.app.ui.notice('⚠️ 该名称已存在');
            return;
        }
        // 保存当前 keepSettings 状态
        this.presets.push({
            name: trimmed,
            rotation: this.rotation,
            flip_horizontal: this.flipH,
            flip_vertical: this.flipV,
            keep_settings: this.keepSettings   // 新增字段
        });
        this.savePresetsToFile();
        this.updatePresetsList();
        this.app.ui.notice(`✅ 预设 "${trimmed}" 已保存`);
    }

    loadPreset(index) {
        const p = this.presets[index];
        if (!p) return;
        this.rotation = p.rotation ?? 0;
        this.flipH = p.flip_horizontal ?? false;
        this.flipV = p.flip_vertical ?? false;
        this.keepSettings = p.keep_settings ?? false;   // 恢复锁定状态
        this.syncUI();
        this.applyTransformStyle();
        this.app.ui.notice(`↻ 已应用预设 "${p.name}"`);
    }

    async deletePreset(index) {
        const p = this.presets[index];
        if (!p) return;
        if (!confirm(`确定要删除预设 "${p.name}" 吗？`)) return;
        this.presets.splice(index, 1);
        await this.savePresetsToFile();
        this.updatePresetsList();
        this.app.ui.notice('🗑️ 预设已删除');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    onunload() {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        if (this.ribbonBtn) this.ribbonBtn.remove();
        this.app.ui.removePanel(`${this.id}-main`);
        const styleEl = document.getElementById(`${this.id}_switch_styles`);
        if (styleEl) styleEl.remove();
        this.removeTransformStyle();
    }
}