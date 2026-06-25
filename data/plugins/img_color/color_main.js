/**
 * sketch_color_adjust —— 色彩调节插件（CSS Filter 版）
 * 亮度 / 对比度 / 饱和度 / 色相 / 模糊 / 透明度 / 灰度 / 反相 / 深褐色
 * 纯前端实时渲染，不破坏原始图片
 * API 路径自动从 manifest.json 中的 id 生成（带兜底）
 */

export default class SketchColorAdjustPlugin extends SketchApp.Plugin {
    constructor(app) {
        super(app);

        // 色彩状态
        this.brightness = 0;
        this.contrast = 0;
        this.saturation = 0;
        this.hueRotate = 0;
        this.blur = 0;
        this.opacity = 100;
        this.grayscale = false;
        this.invert = false;
        this.sepia = false;
        this.keepSettings = false;

        // API_BASE 将在 onload 中正确初始化
        this.API_BASE = null;

        this.presets = [];
        this.panel = null;
        this.ribbonBtn = null;
        this.unsubscribers = [];
    }

    async onload() {
        // 确保 this.id 有效，避免拼接出双斜杠
        if (!this.id) {
            // 优先使用 manifest 中的 id，否则使用已知的文件夹名
            this.id = this.manifest?.id || 'img_color';
        }
        this.API_BASE = `/api/plugins/${this.id}`;

        await this.loadPresets();

        this.ribbonBtn = this.addRibbonButton('color_adjust', {
            icon: '🎨',
            title: '色彩调节',
            callback: () => this.togglePanel()
        });

        this.unsubscribers.push(
            this.app.practice.onImageChange((url) => {
                if (this.keepSettings) {
                    this.applyColorFilter();
                } else {
                    this.resetAllExceptKeep();
                }
            })
        );

        this.panel = this.addPanel('main', {
            title: '色彩调节',
            icon: '🎨'
        });
        this.renderPanel();

        if (this.app.practice.currentImage) {
            this.applyColorFilter();
        }
    }

    togglePanel() {
        this.app.ui.showPanel(`${this.id}-main`);
        this.syncUI();
    }

    // ========== 渲染面板 ==========
    renderPanel() {
        this.panel.innerHTML = `
            <div class="color_adjust_panel" style="
                padding:15px; color:var(--text); height:100%; display:flex; flex-direction:column; gap:12px; overflow-y:auto;
            ">
                <div class="section" style="background:var(--bg-secondary, var(--bg)); padding:12px; border-radius:8px; border:1px solid var(--border);">

                    <!-- 亮度 -->
                    <div class="slider_group" style="margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="font-size:0.8rem;">亮度</label>
                            <span class="brightness_val" style="font-size:0.75rem; color:var(--primary);">0</span>
                        </div>
                        <input type="range" class="brightness_slider" min="-100" max="100" value="0" style="width:100%;">
                    </div>

                    <!-- 对比度 -->
                    <div class="slider_group" style="margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="font-size:0.8rem;">对比度</label>
                            <span class="contrast_val" style="font-size:0.75rem; color:var(--primary);">0</span>
                        </div>
                        <input type="range" class="contrast_slider" min="-100" max="100" value="0" style="width:100%;">
                    </div>

                    <!-- 饱和度 -->
                    <div class="slider_group" style="margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="font-size:0.8rem;">饱和度</label>
                            <span class="saturation_val" style="font-size:0.75rem; color:var(--primary);">0</span>
                        </div>
                        <input type="range" class="saturation_slider" min="-100" max="100" value="0" style="width:100%;">
                    </div>

                    <!-- 色相旋转（彩虹条） -->
                    <div class="slider_group" style="margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="font-size:0.8rem;">色相旋转</label>
                            <span class="hue_val" style="font-size:0.75rem; color:var(--primary);">0°</span>
                        </div>
                        <input type="range" class="hue_slider" min="0" max="360" value="0" style="width:100%;">
                    </div>

                    <!-- 模糊 -->
                    <div class="slider_group" style="margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="font-size:0.8rem;">模糊</label>
                            <span class="blur_val" style="font-size:0.75rem; color:var(--primary);">0 px</span>
                        </div>
                        <input type="range" class="blur_slider" min="0" max="20" value="0" style="width:100%;">
                    </div>

                    <!-- 透明度 -->
                    <div class="slider_group" style="margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="font-size:0.8rem;">透明度</label>
                            <span class="opacity_val" style="font-size:0.75rem; color:var(--primary);">100%</span>
                        </div>
                        <input type="range" class="opacity_slider" min="0" max="100" value="100" style="width:100%;">
                    </div>

                    <!-- 开关组（灰度、反相、深褐色） -->
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="font-size:0.8rem;">灰度</label>
                            <label class="switch" id="switch_grayscale" style="position:relative; display:inline-block; width:40px; height:22px; border-radius:22px; transition: background .3s;">
                                <input type="checkbox" class="grayscale_toggle" style="opacity:0; width:0; height:0;">
                                <span class="slider_round" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; border-radius:22px; transition:.3s;"></span>
                            </label>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="font-size:0.8rem;">反相</label>
                            <label class="switch" id="switch_invert" style="position:relative; display:inline-block; width:40px; height:22px; border-radius:22px; transition: background .3s;">
                                <input type="checkbox" class="invert_toggle" style="opacity:0; width:0; height:0;">
                                <span class="slider_round" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; border-radius:22px; transition:.3s;"></span>
                            </label>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="font-size:0.8rem;">深褐色（怀旧）</label>
                            <label class="switch" id="switch_sepia" style="position:relative; display:inline-block; width:40px; height:22px; border-radius:22px; transition: background .3s;">
                                <input type="checkbox" class="sepia_toggle" style="opacity:0; width:0; height:0;">
                                <span class="slider_round" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; border-radius:22px; transition:.3s;"></span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- 保持设置（开关激活时蓝底） -->
                <div class="section" style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-secondary, var(--bg)); padding:10px 12px; border-radius:8px; border:1px solid var(--border);">
                    <label style="font-size:0.85rem;">🔒 切换图片时保持设置</label>
                    <label class="switch" id="switch_keep" style="position:relative; display:inline-block; width:40px; height:22px; border-radius:22px; transition: background .3s;">
                        <input type="checkbox" class="keep_settings_toggle" style="opacity:0; width:0; height:0;">
                        <span class="slider_round" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; border-radius:22px; transition:.3s;"></span>
                    </label>
                </div>

                <!-- 操作按钮 -->
                <div class="action_buttons" style="display:flex; gap:8px;">
                    <button class="reset_btn btn small" style="flex:1;">重置</button>
                    <button class="save_preset_btn btn primary small" style="flex:1;">保存预设</button>
                </div>

                <!-- 预设列表 -->
                <div class="presets_section">
                    <div style="font-weight:600; margin-bottom:8px; font-size:0.9rem; display:flex; justify-content:space-between; align-items:center;">
                        <span>预设</span>
                        <span class="presets_count" style="font-size:0.75rem; color:#888; font-weight:normal;">(${this.presets.length})</span>
                    </div>
                    <div class="presets_list" style="
                        max-height:150px; overflow-y:auto; font-size:0.85rem; 
                        border:1px solid var(--border); border-radius:8px; padding:8px; 
                        background:var(--bg-secondary, var(--bg));
                    ">
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
            /* 开关轨道默认灰色 */
            .slider_round {
                background-color: #ccc;
            }
            /* 选中后切换为蓝色（微信风格） */
            .switch input:checked + .slider_round {
                background-color: var(--primary, #4a9eff);
            }
            .switch input:checked + .slider_round:before {
                transform: translateX(18px);
            }
            .slider_round:before {
                content:""; position:absolute; height:16px; width:16px;
                left:3px; bottom:3px; background-color:white; border-radius:50%; transition:.3s;
            }

            /* 开关激活时外框变蓝（保留备用） */
            .switch.switch_active {
                background: #e6f0ff;
            }

            /* 通用滑块 */
            .color_adjust_panel input[type="range"] { 
                -webkit-appearance:none; appearance:none; height:6px; border-radius:3px; 
                background:var(--border); outline:none; 
            }
            .color_adjust_panel input[type="range"]::-webkit-slider-thumb { 
                -webkit-appearance:none; width:16px; height:16px; border-radius:50%; 
                background:var(--primary); cursor:pointer; border:2px solid white; 
                box-shadow:0 1px 3px rgba(0,0,0,0.3); 
            }
            .color_adjust_panel input[type="range"]::-moz-range-thumb { 
                width:16px; height:16px; border-radius:50%; 
                background:var(--primary); cursor:pointer; border:2px solid white; 
                box-shadow:0 1px 3px rgba(0,0,0,0.3); 
            }

            /* 色相彩虹条 */
            .color_adjust_panel input[type="range"].hue_slider {
                background: linear-gradient(to right, 
                    #ff0000 0%, #ffff00 16.6%, #00ff00 33.3%, 
                    #00ffff 50%, #0000ff 66.6%, #ff00ff 83.3%, #ff0000 100%);
            }

            /* 预设 */
            .preset_item { display:flex; justify-content:space-between; align-items:center; 
                padding:8px 10px; border-radius:6px; cursor:pointer; transition:background 0.2s; margin-bottom:4px; }
            .preset_item:hover { background:var(--hover-bg, rgba(0,0,0,0.05)); }
            .preset_item .preset_name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .preset_item .preset_params { font-size:0.7rem; color:#888; margin-right:8px; }
            .preset_item .delete_btn { opacity:0.5; transition:opacity 0.2s; padding:2px 6px; 
                border-radius:4px; background:none; border:none; cursor:pointer; color:var(--text); }
            .preset_item:hover .delete_btn { opacity:1; }
            .preset_item .delete_btn:hover { background:rgba(255,0,0,0.1); color:#e74c3c; }
        `;
        document.head.appendChild(style);
    }

    bindEvents() {
        const panel = this.panel;

        panel.querySelector('.brightness_slider').addEventListener('input', e => {
            this.brightness = parseInt(e.target.value);
            this.updateLabel('brightness_val', this.brightness);
            this.applyColorFilter();
        });
        panel.querySelector('.contrast_slider').addEventListener('input', e => {
            this.contrast = parseInt(e.target.value);
            this.updateLabel('contrast_val', this.contrast);
            this.applyColorFilter();
        });
        panel.querySelector('.saturation_slider').addEventListener('input', e => {
            this.saturation = parseInt(e.target.value);
            this.updateLabel('saturation_val', this.saturation);
            this.applyColorFilter();
        });
        panel.querySelector('.hue_slider').addEventListener('input', e => {
            this.hueRotate = parseInt(e.target.value);
            this.updateLabel('hue_val', this.hueRotate, '°');
            this.applyColorFilter();
        });
        panel.querySelector('.blur_slider').addEventListener('input', e => {
            this.blur = parseInt(e.target.value);
            this.updateLabel('blur_val', this.blur, ' px');
            this.applyColorFilter();
        });
        panel.querySelector('.opacity_slider').addEventListener('input', e => {
            this.opacity = parseInt(e.target.value);
            this.updateLabel('opacity_val', this.opacity, '%');
            this.applyColorFilter();
        });

        // 开关事件（含样式切换）
        const toggleSwitch = (toggleClass, property, switchId) => {
            panel.querySelector(`.${toggleClass}`).addEventListener('change', e => {
                this[property] = e.target.checked;
                this.applyColorFilter();
                this.updateSwitchStyle(switchId, e.target.checked);
            });
        };
        toggleSwitch('grayscale_toggle', 'grayscale', 'switch_grayscale');
        toggleSwitch('invert_toggle', 'invert', 'switch_invert');
        toggleSwitch('sepia_toggle', 'sepia', 'switch_sepia');

        panel.querySelector('.keep_settings_toggle').addEventListener('change', e => {
            this.keepSettings = e.target.checked;
            this.updateSwitchStyle('switch_keep', e.target.checked);
        });

        panel.querySelector('.reset_btn').addEventListener('click', () => this.resetAll(true));
        panel.querySelector('.save_preset_btn').addEventListener('click', () => this.showSavePresetDialog());
    }

    updateSwitchStyle(switchId, active) {
        const el = document.getElementById(switchId);
        if (el) el.classList.toggle('switch_active', active);
    }

    updateLabel(className, value, suffix = '') {
        const el = this.panel?.querySelector(`.${className}`);
        if (el) {
            const sign = (value > 0 && !suffix.startsWith(' px') && !suffix.startsWith('%')) ? '+' : '';
            el.textContent = `${sign}${value}${suffix}`;
        }
    }

    syncUI() {
        if (!this.panel) return;
        const panel = this.panel;

        panel.querySelector('.brightness_slider').value = this.brightness;
        this.updateLabel('brightness_val', this.brightness);

        panel.querySelector('.contrast_slider').value = this.contrast;
        this.updateLabel('contrast_val', this.contrast);

        panel.querySelector('.saturation_slider').value = this.saturation;
        this.updateLabel('saturation_val', this.saturation);

        panel.querySelector('.hue_slider').value = this.hueRotate;
        this.updateLabel('hue_val', this.hueRotate, '°');

        panel.querySelector('.blur_slider').value = this.blur;
        this.updateLabel('blur_val', this.blur, ' px');

        panel.querySelector('.opacity_slider').value = this.opacity;
        this.updateLabel('opacity_val', this.opacity, '%');

        panel.querySelector('.grayscale_toggle').checked = this.grayscale;
        this.updateSwitchStyle('switch_grayscale', this.grayscale);

        panel.querySelector('.invert_toggle').checked = this.invert;
        this.updateSwitchStyle('switch_invert', this.invert);

        panel.querySelector('.sepia_toggle').checked = this.sepia;
        this.updateSwitchStyle('switch_sepia', this.sepia);

        panel.querySelector('.keep_settings_toggle').checked = this.keepSettings;
        this.updateSwitchStyle('switch_keep', this.keepSettings);

        this.updatePresetsList();
    }

    // ========== CSS filter ==========
    applyColorFilter() {
        const img = document.querySelector('#player-image');
        if (!img) return;

        const filters = [];
        if (this.brightness !== 0) filters.push(`brightness(${1 + this.brightness / 100})`);
        if (this.contrast !== 0) filters.push(`contrast(${1 + this.contrast / 100})`);
        if (this.saturation !== 0) filters.push(`saturate(${1 + this.saturation / 100})`);
        if (this.hueRotate !== 0) filters.push(`hue-rotate(${this.hueRotate}deg)`);
        if (this.blur > 0) filters.push(`blur(${this.blur}px)`);
        if (this.opacity < 100) filters.push(`opacity(${this.opacity / 100})`);
        if (this.grayscale) filters.push('grayscale(1)');
        if (this.invert) filters.push('invert(1)');
        if (this.sepia) filters.push('sepia(1)');

        img.style.filter = filters.join(' ');
    }

    removeColorFilter() {
        const img = document.querySelector('#player-image');
        if (img) img.style.filter = '';
    }

    resetAllExceptKeep() {
        this.brightness = 0;
        this.contrast = 0;
        this.saturation = 0;
        this.hueRotate = 0;
        this.blur = 0;
        this.opacity = 100;
        this.grayscale = false;
        this.invert = false;
        this.sepia = false;
        this.syncUI();
        this.removeColorFilter();
    }

    resetAll(restoreImage = true) {
        this.keepSettings = false;
        this.resetAllExceptKeep();
        if (restoreImage) {
            this.removeColorFilter();
            this.app.ui.notice('✅ 已重置');
        }
    }

    // ========== 预设管理 ==========
    async loadPresets() {
        try {
            const resp = await fetch(`${this.API_BASE}/presets`);
            if (resp.ok) {
                const data = await resp.json();
                this.presets = (data.presets || []).map(p => ({
                    brightness: 0, contrast: 0, saturation: 0,
                    hue_rotate: 0, blur: 0, opacity: 100,
                    grayscale: false, invert: false, sepia: false,
                    keep_settings: false,
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
            await fetch(`${this.API_BASE}/presets`, {
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
            if (p.brightness !== 0) parts.push(`亮${p.brightness > 0 ? '+' : ''}${p.brightness}`);
            if (p.contrast !== 0) parts.push(`对${p.contrast > 0 ? '+' : ''}${p.contrast}`);
            if (p.saturation !== 0) parts.push(`饱${p.saturation > 0 ? '+' : ''}${p.saturation}`);
            if (p.hue_rotate !== 0) parts.push(`色${p.hue_rotate}°`);
            if (p.blur > 0) parts.push(`模糊${p.blur}px`);
            if (p.opacity < 100) parts.push(`透明${p.opacity}%`);
            if (p.grayscale) parts.push('灰度');
            if (p.invert) parts.push('反相');
            if (p.sepia) parts.push('怀旧');
            if (p.keep_settings) parts.push('🔒保持');
            const paramsStr = parts.length > 0 ? parts.join(', ') : '默认';
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
        const trimmedName = name.trim();
        if (this.presets.some(p => p.name === trimmedName)) {
            this.app.ui.notice('⚠️ 该名称已存在');
            return;
        }
        const preset = {
            name: trimmedName,
            brightness: this.brightness,
            contrast: this.contrast,
            saturation: this.saturation,
            hue_rotate: this.hueRotate,
            blur: this.blur,
            opacity: this.opacity,
            grayscale: this.grayscale,
            invert: this.invert,
            sepia: this.sepia,
            keep_settings: this.keepSettings
        };
        this.presets.push(preset);
        this.savePresetsToFile();
        this.updatePresetsList();
        this.app.ui.notice(`✅ 预设 "${trimmedName}" 已保存`);
    }

    loadPreset(index) {
        const p = this.presets[index];
        if (!p) return;
        this.brightness = p.brightness ?? 0;
        this.contrast = p.contrast ?? 0;
        this.saturation = p.saturation ?? 0;
        this.hueRotate = p.hue_rotate ?? 0;
        this.blur = p.blur ?? 0;
        this.opacity = p.opacity ?? 100;
        this.grayscale = p.grayscale ?? false;
        this.invert = p.invert ?? false;
        this.sepia = p.sepia ?? false;
        this.keepSettings = p.keep_settings ?? false;
        this.syncUI();
        this.applyColorFilter();
        this.app.ui.notice(`🎨 已应用预设 "${p.name}"`);
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
        this.removeColorFilter();
    }
}