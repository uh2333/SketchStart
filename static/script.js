/*
 script.js —— 完整交互逻辑（Obsidian 模式版）
 包含：图包管理、管理模式、收藏夹、多图包练习、插件系统（JS API）
 修改：主程序缩放改用 transform:scale 作用于 #image-wrapper，与插件的 transform 互不干扰
*/

// ========== 全局状态 ==========
let pendingMoveFile = null;
let pendingMoveCategory = null;
let currentPackage = '';
let currentSourceType = 'package';
let allFiles = [];
let selectedFiles = [];
let practiceImages = [];
let currentIndex = 0;
let timer = null;
let timeLeft = 0;
let isPaused = false;
let currentInterval = 60;
let currentMultiSession = null;
let pendingUploadFile = null;
let manageMode = false;
let currentFavPath = '';
let selectedFavImages = [];

// ========== 工具函数 ==========
function showView(viewId) {
    document.body.classList.remove('player-active');
    if (viewId !== 'player') {
        document.body.classList.remove('sidebar-open');
        const panel = document.getElementById('plugin-sidebar-panel');
        if (panel) panel.classList.remove('open');
    }
    ['view-home','view-settings','view-player','view-multi-settings','view-favorites-browser'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    if (viewId === 'home') document.getElementById('view-home').style.display = 'block';
    else if (viewId === 'settings') document.getElementById('view-settings').style.display = 'block';
    else if (viewId === 'player') { 
        document.getElementById('view-player').style.display = 'block'; 
        document.body.classList.add('player-active'); 
    }
    else if (viewId === 'multi-settings') document.getElementById('view-multi-settings').style.display = 'block';
    else if (viewId === 'favorites-browser') document.getElementById('view-favorites-browser').style.display = 'block';
}

function getSelectedInterval() {
    return parseInt(document.getElementById('select-interval').value, 10);
}

function getPracticeCount() {
    const val = parseInt(document.getElementById('input-count').value, 10);
    return isNaN(val) ? 1 : Math.max(1, val);
}

async function apiPost(url, data) {
    const resp = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    return resp.json();
}

function randomPick(array, count) {
    const shuffled = [...array].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, array.length));
}

function isLocalHost() {
    const hostname = window.location.hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isMobile() {
    return window.innerWidth <= 768;
}

// ========== 首页图包网格 ==========
async function loadPackages() {
    const resp = await fetch('/api/packages');
    const data = await resp.json();
    const grid = document.getElementById('package-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const emptyTip = document.getElementById('empty-tip');
    if (data.packages.length === 0) {
        emptyTip.style.display = 'block';
    } else {
        emptyTip.style.display = 'none';
        data.packages.forEach(pkg => {
            const card = document.createElement('div');
            card.className = 'card';
            card.draggable = manageMode;
            card.dataset.pkgName = pkg.name;
            if (pkg.is_completed) {
                card.style.position = 'relative';
                card.style.overflow = 'hidden';
            }

            let imgHtml = '';
            if (pkg.preview_images && pkg.preview_images.length > 0) {
                imgHtml = `<img src="data:image/jpeg;base64,${pkg.preview_images[0]}" alt="预览">`;
            } else {
                imgHtml = '<div style="height:120px;background:#eee;display:flex;align-items:center;justify-content:center;">无预览</div>';
            }
            card.innerHTML = `${imgHtml}<div class="info"><strong>${pkg.name}</strong><br>进度：${pkg.practiced_count}/${pkg.total}${pkg.is_completed ? '<span class="completed-badge">已完成</span>' : ''}</div>`;

            if (manageMode) {
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px;z-index:10;border-radius:8px;';
                overlay.innerHTML = `
                    ${pkg.is_completed ? '<p style="color:#fff;font-weight:bold;margin:0 0 5px 0;">已完成</p>' : ''}
                    <button class="btn small reset-btn" style="background:#4CAF50;color:white;border:none;padding:8px 20px;">重新开始</button>
                    <button class="btn small delete-btn" style="background:#f44336;color:white;border:none;padding:8px 20px;">删除</button>
                `;
                card.appendChild(overlay);
                overlay.querySelector('.reset-btn').addEventListener('click', (e) => { e.stopPropagation(); resetPackage(pkg.name); });
                overlay.querySelector('.delete-btn').addEventListener('click', (e) => { e.stopPropagation(); deletePackage(pkg.name); });
            } else if (pkg.is_completed) {
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px;z-index:10;border-radius:8px;';
                overlay.innerHTML = '<p style="color:#fff;font-weight:bold;margin:0 0 5px 0;">已完成</p><button class="btn small reset-btn" style="background:#4CAF50;color:white;border:none;padding:8px 20px;">重新开始</button><button class="btn small delete-btn" style="background:#f44336;color:white;border:none;padding:8px 20px;">删除</button>';
                card.appendChild(overlay);
                overlay.querySelector('.reset-btn').addEventListener('click', (e) => { e.stopPropagation(); resetPackage(pkg.name); });
                overlay.querySelector('.delete-btn').addEventListener('click', (e) => { e.stopPropagation(); deletePackage(pkg.name); });
            } else {
                card.addEventListener('click', () => selectPackage(pkg.name));
            }

            card.addEventListener('dragstart', (e) => {
                if (!manageMode) return;
                e.dataTransfer.setData('text/plain', pkg.name);
                e.dataTransfer.effectAllowed = 'move';
            });
            card.addEventListener('dragover', (e) => e.preventDefault());
            card.addEventListener('drop', async (e) => {
                e.preventDefault();
                if (!manageMode) return;
                const sourceName = e.dataTransfer.getData('text/plain');
                if (sourceName !== pkg.name && confirm(`合并"${sourceName}"到"${pkg.name}"？`)) {
                    await apiPost('/api/manage/merge_packages', { source: sourceName, target: pkg.name });
                    loadPackages();
                }
            });

            grid.appendChild(card);
        });
    }
}

async function resetPackage(name) {
    if (confirm(`确定重置"${name}"的进度吗？`)) {
        await apiPost('/api/reset_package', { package_name: name });
        loadPackages(); loadFavorites();
    }
}
async function deletePackage(name) {
    if (confirm(`确定删除"${name}"吗？此操作不可恢复。`)) {
        await apiPost('/api/delete_package', { package_name: name });
        loadPackages(); loadFavorites();
    }
}

// ========== 首页收藏分类 ==========
async function loadFavorites() {
    const resp = await fetch('/api/favorites');
    const data = await resp.json();
    const grid = document.getElementById('favorites-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const emptyTip = document.getElementById('favorites-empty-tip');
    if (data.categories.length === 0) {
        emptyTip.style.display = 'block';
    } else {
        emptyTip.style.display = 'none';
        data.categories.forEach(cat => {
            const card = document.createElement('div');
            card.className = 'card favorite-card';
            if (manageMode) {
                card.draggable = true;
                card.dataset.catPath = cat.name;
                card.style.position = 'relative';
                card.style.overflow = 'hidden';
            }
            card.innerHTML = `<div class="folder-icon">📁</div><div class="info"><strong>${cat.name}</strong><br>共 ${cat.count} 张</div>`;

            if (manageMode) {
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px;z-index:10;border-radius:8px;';
                overlay.innerHTML = `
                    <button class="btn small pack-btn" style="background:#2196F3;color:white;border:none;padding:8px 20px;">打包为图包</button>
                    <button class="btn small delete-btn" style="background:#f44336;color:white;border:none;padding:8px 20px;">删除</button>
                `;
                card.appendChild(overlay);

                overlay.querySelector('.pack-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        const resp = await fetch('/api/manage/pack_category', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ category: cat.name })
                        });
                        const result = await resp.json();
                        if (result.status === 'ok') {
                            alert(`已打包为 ${result.package_name}`);
                            loadFavorites();
                            loadPackages();
                        } else {
                            alert('打包失败：' + (result.detail || '未知错误'));
                        }
                    } catch (err) {
                        alert('网络错误，打包失败');
                        console.error(err);
                    }
                });
                overlay.querySelector('.delete-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm(`确定删除分类"${cat.name}"吗？`)) {
                        await apiPost('/api/manage/delete_category', { category: cat.name });
                        loadFavorites();
                    }
                });

                card.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/cat', cat.name);
                    e.dataTransfer.effectAllowed = 'move';
                });
                card.addEventListener('dragover', (e) => e.preventDefault());
                card.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    if (!manageMode) return;
                    const srcPath = e.dataTransfer.getData('text/cat');
                    if (srcPath === cat.name) return;
                    const newPath = cat.name + '/' + srcPath.split('/').pop();
                    if (confirm(`将"${srcPath}"移动到"${newPath}"下？`)) {
                        await apiPost('/api/manage/move_category', { old_path: srcPath, new_path: newPath });
                        loadFavorites();
                    }
                });
            } else {
                card.addEventListener('click', () => selectFavoriteCategory(cat.name));
            }

            grid.appendChild(card);
        });
    }
}

// ========== 收藏夹浏览视图 ==========
function selectFavoriteCategory(name) { enterFavoritesBrowser(name); }

async function enterFavoritesBrowser(path) {
    currentFavPath = path;
    selectedFavImages = [];
    showView('favorites-browser');
    await loadFavoritesBrowse();
}

async function loadFavoritesBrowse() {
    const resp = await apiPost('/api/favorites/browse', { path: currentFavPath });
    const breadcrumb = document.getElementById('favorites-breadcrumb');
    breadcrumb.innerHTML = '';
    const parts = currentFavPath.split('/').filter(p => p);
    const rootSpan = document.createElement('span');
    rootSpan.textContent = '收藏夹';
    rootSpan.style.cursor = 'pointer';
    rootSpan.addEventListener('click', () => enterFavoritesBrowser(''));
    breadcrumb.appendChild(rootSpan);
    let cumulative = '';
    parts.forEach((part) => {
        breadcrumb.appendChild(document.createTextNode(' / '));
        cumulative = cumulative ? `${cumulative}/${part}` : part;
        const span = document.createElement('span');
        span.textContent = part;
        span.style.cursor = 'pointer';
        span.dataset.path = cumulative;
        span.addEventListener('click', (e) => enterFavoritesBrowser(e.target.dataset.path));
        span.addEventListener('dragover', e => e.preventDefault());
        span.addEventListener('drop', async e => {
            e.preventDefault();
            const srcPath = e.dataTransfer.getData('text/folder');
            if (srcPath === cumulative) return;
            if (confirm(`将"${srcPath}"移动到"${cumulative || '根目录'}"下？`)) {
                await apiPost('/api/manage/move_category', { old_path: srcPath, new_path: cumulative ? cumulative + '/' + srcPath.split('/').pop() : srcPath.split('/').pop() });
                loadFavoritesBrowse();
            }
        });
        breadcrumb.appendChild(span);
    });

    if (!document.getElementById('browser-random-btn').dataset.bound) {
        document.getElementById('browser-random-btn').dataset.bound = '1';
        document.getElementById('browser-random-btn').addEventListener('click', browserRandomPractice);
        document.getElementById('browser-selected-btn').addEventListener('click', browserSelectedPractice);
    }

    const foldersGrid = document.getElementById('favorites-folders-grid');
    foldersGrid.innerHTML = '';
    resp.folders.forEach(folder => {
        const card = document.createElement('div');
        card.className = 'card favorite-card';
        card.draggable = true;
        card.dataset.folderPath = folder.path;
        card.innerHTML = `<div class="folder-icon">📁</div><div class="info"><strong>${folder.name}</strong></div>`;
        card.addEventListener('click', () => enterFavoritesBrowser(folder.path));

        card.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/folder', folder.path);
            e.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragover', e => e.preventDefault());
        card.addEventListener('drop', async e => {
            e.preventDefault();
            const srcPath = e.dataTransfer.getData('text/folder');
            if (srcPath === folder.path) return;
            const newPath = folder.path + '/' + srcPath.split('/').pop();
            if (confirm(`将"${srcPath}"移动到"${newPath}"下？`)) {
                await apiPost('/api/manage/move_category', { old_path: srcPath, new_path: newPath });
                loadFavoritesBrowse();
            }
        });

        if (manageMode) {
            const actions = document.createElement('div');
            actions.className = 'folder-actions';
            actions.innerHTML = `
                <button class="btn small move-up-btn">⬆️ 上移</button>
                <button class="btn small delete-btn">🗑 删除</button>
            `;
            actions.querySelector('.move-up-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                await apiPost('/api/manage/move_category_to_parent', { path: folder.path });
                loadFavoritesBrowse();
            });
            actions.querySelector('.delete-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`确定删除文件夹"${folder.name}"及其内容？`)) {
                    await apiPost('/api/manage/delete_favorite_item', { path: folder.path });
                    loadFavoritesBrowse();
                }
            });
            card.appendChild(actions);
        }

        foldersGrid.appendChild(card);
    });

    const imagesGrid = document.getElementById('favorites-images-grid');
    imagesGrid.innerHTML = '';
    const encodedPath = currentFavPath.split('/').map(encodeURIComponent).join('/');
    resp.files.forEach(file => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `<img src="/favorites/${encodedPath}/${encodeURIComponent(file)}" style="width:100%;height:120px;object-fit:cover;"><div class="info">${file}</div>`;

        card.addEventListener('click', (e) => {
            if (manageMode) {
                e.stopPropagation();
                card.classList.toggle('selected-image');
                if (card.classList.contains('selected-image')) {
                    selectedFavImages.push(file);
                } else {
                    selectedFavImages = selectedFavImages.filter(f => f !== file);
                }
                document.getElementById('browser-selected-btn').style.display = selectedFavImages.length ? 'inline-block' : 'none';
            } else {
                e.stopPropagation();
                apiPost('/api/start_practice', {
                    source_type: 'favorite',
                    category: currentFavPath,
                    selected_files: [file],
                    interval: 60
                }).then(resp => {
                    practiceImages = resp.image_urls;
                    currentIndex = 0;
                    currentInterval = 60;
                    currentSourceType = 'favorite';
                    showView('player');
                    displayImage(currentIndex);
                    startTimer(currentInterval);
                });
            }
        });

        if (manageMode) {
            const actions = document.createElement('div');
            actions.className = 'image-actions';
            actions.style.display = 'flex';
            actions.style.gap = '5px';
            actions.style.marginTop = '5px';
            actions.innerHTML = `
                <button class="btn small delete-img-btn" title="删除">🗑</button>
                <button class="btn small move-img-btn" title="移动到...">📁</button>
            `;
            actions.querySelector('.delete-img-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`确定删除图片"${file}"？`)) {
                    await apiPost('/api/manage/delete_favorite_image', { category: currentFavPath, filename: file });
                    loadFavoritesBrowse();
                }
            });

            actions.querySelector('.move-img-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                pendingMoveFile = file;
                pendingMoveCategory = currentFavPath;
                openMoveImageModal();
            });
            card.appendChild(actions);
        }

        imagesGrid.appendChild(card);
    });
}

async function browserRandomPractice() {
    const count = parseInt(document.getElementById('browser-count').value, 10);
    const interval = parseInt(document.getElementById('browser-interval').value, 10);
    const resp = await apiPost('/api/favorites/list', { category: currentFavPath });
    const picked = randomPick(resp.files, count);
    const startResp = await apiPost('/api/start_practice', { source_type: 'favorite', category: currentFavPath, selected_files: picked, interval });
    practiceImages = startResp.image_urls;
    currentIndex = 0;
    currentInterval = interval;
    currentSourceType = 'favorite';
    showView('player');
    displayImage(currentIndex);
    startTimer(currentInterval);
}

async function browserSelectedPractice() {
    if (!selectedFavImages.length) return alert('请先选中图片');
    const interval = parseInt(document.getElementById('browser-interval').value, 10);
    const startResp = await apiPost('/api/start_practice', { source_type: 'favorite', category: currentFavPath, selected_files: selectedFavImages, interval });
    practiceImages = startResp.image_urls;
    currentIndex = 0;
    currentInterval = interval;
    currentSourceType = 'favorite';
    showView('player');
    displayImage(currentIndex);
    startTimer(currentInterval);
}

document.getElementById('favorites-browser-back').addEventListener('click', () => {
    showView('home');
    loadPackages();
    loadFavorites();
});

// ========== 设置页 ==========
async function selectPackage(pkgName) {
    currentPackage = pkgName; currentSourceType = 'package';
    document.getElementById('current-package-name').textContent = pkgName;
    document.getElementById('source-label').textContent = '当前图包：';
    document.getElementById('file-preview-list').style.display = 'none';
    document.getElementById('manual-hint').style.display = 'none';
    showView('settings');
    const resp = await apiPost('/api/list_package_contents', { package_name: pkgName, exclude_practiced: true });
    allFiles = resp.files;
    if (allFiles.length === 0) alert('该图包所有图片均已练习过，请先重置进度。');
    const config = await fetch('/api/config').then(r => r.json());
    document.getElementById('input-count').value = config.default_count || 5;
    document.getElementById('select-interval').value = config.default_interval || 60;
}

// ========== 开始练习 ==========
document.getElementById('start-practice-btn').addEventListener('click', async () => {
    if (currentSourceType === 'package') {
        const resp = await apiPost('/api/list_package_contents', { package_name: currentPackage, exclude_practiced: true });
        allFiles = resp.files;
    }
    let finalFiles = [];
    if (currentSourceType === 'favorite') {
        if (selectedFiles.length > 0) finalFiles = selectedFiles;
        else { const count = getPracticeCount(); if (allFiles.length === 0) return alert('没有图片'); finalFiles = randomPick(allFiles, count); }
    } else {
        const count = getPracticeCount();
        if (allFiles.length === 0) return alert('没有未练习的图片');
        finalFiles = randomPick(allFiles, Math.min(count, allFiles.length));
    }
    currentInterval = getSelectedInterval();
    let resp;
    if (currentSourceType === 'favorite') resp = await apiPost('/api/start_practice', { source_type: 'favorite', category: currentPackage, selected_files: finalFiles, interval: currentInterval });
    else resp = await apiPost('/api/start_practice', { source_type: 'package', package_name: currentPackage, selected_files: finalFiles, interval: currentInterval });
    practiceImages = resp.image_urls;
    if (practiceImages.length === 0) return alert('加载失败');
    currentIndex = 0;
    showView('player');
    displayImage(currentIndex);
    startTimer(currentInterval);
});

// ========== 播放器核心 ==========
function displayImage(index) {
    const img = document.getElementById('player-image');
    if (!img) return;
    if (index >= 0 && index < practiceImages.length) {
        img.src = practiceImages[index];
        window.SketchApp._internal.setState({
            currentImage: practiceImages[index],
            index: index
        });
    }
    const slider = document.getElementById('zoom-slider');
    if (slider) slider.value = 100;
    // 切换图片时重置容器缩放（由主程序控制），图片本身的变换由插件管理
    const wrapper = document.getElementById('image-wrapper');
    if (wrapper) {
        wrapper.style.transform = 'scale(1)';
        wrapper.style.transformOrigin = 'center center';
    }
    // 同时重置图片的 transform（以防插件未加载，但通常插件会接管）
    if (img) {
        img.style.transform = '';
        img.style.zoom = ''; // 清除可能遗留的 zoom
    }
}

function startTimer(seconds) {
    if (timer) clearInterval(timer);
    timeLeft = seconds;
    isPaused = false;
    document.getElementById('pause-btn').textContent = '暂停';
    updateTimerDisplay();
    timer = setInterval(() => {
        if (isPaused) return;
        timeLeft--;
        updateTimerDisplay();
        window.SketchApp._internal.timerTick(timeLeft);
        if (timeLeft <= 0) {
            clearInterval(timer);
            timer = null;
            nextImage();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const fill = document.querySelector('.progress-fill');
    if (fill) fill.style.width = (timeLeft / currentInterval * 100) + '%';
    const text = document.getElementById('timer-text');
    if (text) text.textContent = timeLeft;
}

function nextImage() {
    if (currentIndex < practiceImages.length - 1) {
        currentIndex++;
        displayImage(currentIndex);
        startTimer(currentInterval);
    } else {
        const allFilenames = practiceImages.map(url => url.split('/').pop());
        finishPractice(allFilenames);
    }
}

function prevImage() {
    if (currentIndex > 0) {
        currentIndex--;
        displayImage(currentIndex);
        startTimer(currentInterval);
    }
}

async function finishPractice(filesToMark) {
    if (currentMultiSession) {
        await apiPost('/api/multi-practice/finish', {
            session_id: currentMultiSession,
            practiced_files: filesToMark
        });
        currentMultiSession = null;
    } else {
        if (currentSourceType === 'package') {
            await apiPost('/api/finish_practice', { package_name: currentPackage, practiced_files: filesToMark });
        } else {
            await apiPost('/api/finish_practice', { package_name: '', practiced_files: [] });
        }
    }
    if (timer) { clearInterval(timer); timer = null; }
    window.SketchApp._internal.endPractice();
    showView('home');
    loadPackages();
    loadFavorites();
}

document.getElementById('finish-partial-btn').addEventListener('click', () => {
    const upToCurrent = practiceImages.slice(0, currentIndex + 1).map(url => url.split('/').pop());
    if (upToCurrent.length === 0) return alert('没有图片可记录');
    if (currentSourceType === 'favorite') {
        finishPractice(upToCurrent);
    } else {
        if (confirm(`将前 ${upToCurrent.length} 张图片标记为已完成并退出？`)) finishPractice(upToCurrent);
    }
});

document.getElementById('finish-all-btn').addEventListener('click', () => {
    const allFilenames = practiceImages.map(url => url.split('/').pop());
    if (allFilenames.length === 0) return alert('没有图片可记录');
    if (currentSourceType === 'favorite') {
        finishPractice(allFilenames);
    } else {
        if (confirm(`将全部 ${allFilenames.length} 张图片标记为已完成并退出？`)) finishPractice(allFilenames);
    }
});

document.getElementById('pause-btn').addEventListener('click', () => {
    isPaused = !isPaused;
    document.getElementById('pause-btn').textContent = isPaused ? '继续' : '暂停';
    window.SketchApp._internal.setState({ isPlaying: !isPaused });
});

document.getElementById('next-btn').addEventListener('click', nextImage);
document.getElementById('prev-btn').addEventListener('click', prevImage);

document.getElementById('favorite-btn').addEventListener('click', () => {
    const currentImgUrl = practiceImages[currentIndex];
    const filename = currentImgUrl.split('/').pop();
    const category = prompt('请输入收藏分类（例如：人体/躯干）', '未分类');
    if (category !== null) {
        apiPost('/api/favorite', { temp_file_path: filename, category }).then(() => {
            alert('已收藏');
            window.SketchApp._internal.favorite({ filename, category });
        });
    }
});

// ========== 主程序缩放：使用 transform:scale 作用于容器 #image-wrapper ==========
document.getElementById('zoom-slider').addEventListener('input', (e) => {
    const wrapper = document.getElementById('image-wrapper');
    if (!wrapper) return;
    const scale = parseFloat(e.target.value) / 100;
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.transformOrigin = 'center center';
});

document.getElementById('fit-screen-btn').addEventListener('click', () => {
    const slider = document.getElementById('zoom-slider');
    if (slider) slider.value = 100;
    const wrapper = document.getElementById('image-wrapper');
    if (wrapper) {
        wrapper.style.transform = 'scale(1)';
        wrapper.style.transformOrigin = 'center center';
    }
});

// ========== 上传逻辑 ==========
const fileInput = document.getElementById('file-input');
document.getElementById('upload-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
        pendingUploadFile = file;
        await showUploadImageModal();
    } else if (['zip', 'rar'].includes(ext)) {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch('/api/upload_package', { method: 'POST', body: formData });
        const result = await resp.json();
        if (result.status === 'ok') {
            alert('上传成功');
            loadPackages();
        } else {
            alert('上传失败：' + (result.detail || '未知错误'));
        }
    }
    fileInput.value = '';
});

async function showUploadImageModal() {
    const modal = document.getElementById('upload-image-modal');
    const select = document.getElementById('existing-package-select');
    const resp = await fetch('/api/packages');
    const data = await resp.json();
    select.innerHTML = '<option value="">-- 选择一个图包 --</option>';
    data.packages.forEach(pkg => {
        const opt = document.createElement('option');
        opt.value = pkg.name; opt.textContent = pkg.name;
        select.appendChild(opt);
    });
    const config = await fetch('/api/config').then(r => r.json());
    const defaultPkg = config.default_upload_package || '';
    if (defaultPkg) {
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === defaultPkg) { select.selectedIndex = i; break; }
        }
    }
    document.getElementById('new-package-name').value = '';
    modal.style.display = 'flex';
}

document.getElementById('cancel-upload-btn').addEventListener('click', () => {
    document.getElementById('upload-image-modal').style.display = 'none';
    pendingUploadFile = null;
});

document.getElementById('upload-to-package-btn').addEventListener('click', async () => {
    const select = document.getElementById('existing-package-select');
    const newNameInput = document.getElementById('new-package-name');
    const newName = newNameInput.value.trim();
    const targetPackage = select.value;
    
    let createNew = false;
    let finalPackageName = '';
    
    if (newName) {
        createNew = true;
        finalPackageName = newName + '.zip';
    } else if (targetPackage) {
        createNew = false;
        finalPackageName = targetPackage;
    } else {
        return alert('请选择一个图包，或输入新图包名称');
    }

    const formData = new FormData();
    formData.append('file', pendingUploadFile);
    formData.append('create_new', createNew ? 'true' : 'false');
    formData.append('target_package', finalPackageName);

    try {
        const resp = await fetch('/api/upload_package', { method: 'POST', body: formData });
        const result = await resp.json();
        if (result.status === 'ok') {
            alert('上传成功');
            loadPackages();
        } else {
            alert('上传失败：' + (result.detail || '未知错误'));
        }
    } catch (err) {
        alert('网络错误，上传失败');
    }
    document.getElementById('upload-image-modal').style.display = 'none';
    pendingUploadFile = null;
});

// ========== 多图包练习 ==========
document.getElementById('multi-practice-btn').addEventListener('click', async () => {
    if (manageMode) { manageMode = false; loadPackages(); loadFavorites(); }
    showView('multi-settings'); await initMultiSettings();
});
let multiPractices = [];
async function initMultiSettings() {
    const resp = await fetch('/api/packages');
    const data = await resp.json();
    multiPractices = [];
    const container = document.getElementById('multi-practices-list');
    container.innerHTML = '<div class="multi-grid" id="multi-grid"></div><div class="multi-controls" id="multi-controls"></div>';
    const grid = document.getElementById('multi-grid');
    data.packages.forEach(pkg => {
        const card = document.createElement('div');
        card.className = 'multi-card selectable-card';
        card.dataset.pkg = pkg.name;
        card.innerHTML = `
            ${pkg.preview_images.length ? `<img src="data:image/jpeg;base64,${pkg.preview_images[0]}" alt="预览">` : '<div style="height:80px;background:#eee;"></div>'}
            <div class="info"><strong>${pkg.name}</strong><br>${pkg.practiced_count}/${pkg.total}</div>
            <div class="select-circle">○</div>
        `;
        card.addEventListener('click', () => {
            card.classList.toggle('selected-card');
            const circle = card.querySelector('.select-circle');
            if (card.classList.contains('selected-card')) {
                circle.textContent = '✓';
                multiPractices.push({ package_name: pkg.name, count: 5 });
            } else {
                circle.textContent = '○';
                multiPractices = multiPractices.filter(p => p.package_name !== pkg.name);
            }
            renderMultiControls();
        });
        grid.appendChild(card);
    });
    renderMultiControls();
}
function renderMultiControls() {
    const controls = document.getElementById('multi-controls');
    if (!controls) return;
    controls.innerHTML = '';
    multiPractices.forEach((p, i) => {
        const row = document.createElement('div'); row.className = 'multi-edit-row';
        row.innerHTML = `<span>${p.package_name}</span> <input type="number" class="multi-count-input" value="${p.count}" min="1">`;
        row.querySelector('input').addEventListener('change', (e) => {
            p.count = parseInt(e.target.value) || 1;
        });
        controls.appendChild(row);
    });
}
document.getElementById('multi-start-practice-btn').addEventListener('click', async () => {
    const interval = parseInt(document.getElementById('multi-interval').value, 10);
    const practices = multiPractices.filter(p => p.package_name);
    if (practices.length === 0) return alert('请选择至少一个图包');
    const resp = await apiPost('/api/multi-practice/start', { practices, interval });
    practiceImages = resp.image_urls;
    currentMultiSession = resp.session_id;
    currentIndex = 0;
    currentInterval = interval;
    showView('player');
    displayImage(currentIndex);
    startTimer(interval);
});
document.getElementById('back-from-multi').addEventListener('click', () => { showView('home'); loadPackages(); loadFavorites(); });

// ========== 管理模式切换 ==========
document.getElementById('manage-mode-btn').addEventListener('click', () => {
    manageMode = !manageMode;
    document.getElementById('manage-mode-btn').classList.toggle('active', manageMode);
    loadPackages();
    loadFavorites();
    if (document.getElementById('view-favorites-browser').style.display === 'block') {
        loadFavoritesBrowse();
    }
});

// ========== 插件系统（Obsidian 模式）==========
class PluginManager {
    constructor() {
        this.plugins = new Map();
        this.loaded = false;
    }
    
    async loadPlugins() {
        try {
            const resp = await fetch('/api/plugins/list');
            const data = await resp.json();
            for (const manifest of data.plugins) {
                await this.loadPlugin(manifest);
            }
            this.loaded = true;
            this.renderPluginList();
        } catch (e) {
            console.error('加载插件失败:', e);
        }
    }
    
    async loadPlugin(manifest) {
        try {
            const module = await import(`/plugins/${manifest.id}/${manifest.main}`);
            const PluginClass = module.default || module[manifest.id];
            if (!PluginClass) {
                console.error(`插件 ${manifest.id} 没有导出默认类`);
                return;
            }
            const plugin = new PluginClass(window.SketchApp);
            plugin.id = manifest.id;
            plugin.name = manifest.name;
            plugin.manifest = manifest;
            if (plugin.onload) {
                await plugin.onload();
            }
            this.plugins.set(manifest.id, plugin);
            console.log(`插件 ${manifest.name} 加载成功`);
        } catch (e) {
            console.error(`加载插件 ${manifest.id} 失败:`, e);
        }
    }
    
    unloadPlugin(id) {
        const plugin = this.plugins.get(id);
        if (plugin && plugin.onunload) {
            plugin.onunload();
        }
        this.plugins.delete(id);
    }
    
    getPlugin(id) {
        return this.plugins.get(id);
    }
    
    renderPluginList() {
        const listDiv = document.getElementById('plugin-list');
        if (!listDiv) return;
        if (this.plugins.size === 0) {
            listDiv.innerHTML = '<p style="color:gray;text-align:center;padding:20px;">暂无插件</p>';
            return;
        }
        listDiv.innerHTML = '';
        this.plugins.forEach((plugin, id) => {
            const item = document.createElement('div');
            item.className = 'plugin-list-item';
            item.innerHTML = `
                <div class="plugin-icon">${plugin.manifest.icon || '📦'}</div>
                <div class="plugin-info">
                    <div class="plugin-name">${plugin.manifest.name}</div>
                    <div class="plugin-desc">${plugin.manifest.description || ''}</div>
                </div>
                <div class="plugin-version">v${plugin.manifest.version}</div>
            `;
            item.addEventListener('click', () => {
                const panelId = `${id}-main`;
                const panel = window.SketchApp.ui._panels.get(panelId);
                if (panel) {
                    window.SketchApp.ui.showPanel(panelId);
                } else {
                    window.SketchApp.ui.notice(`插件 ${plugin.manifest.name} 已激活`);
                }
            });
            listDiv.appendChild(item);
        });
    }
}

window.pluginManager = new PluginManager();

// ========== 插件面板控制 ==========
const panel = document.getElementById('plugin-sidebar-panel');
const listView = document.getElementById('plugin-list-view');
const contentView = document.getElementById('plugin-content-view');
const closeBtn = document.getElementById('plugin-sidebar-close');

function openPluginSidebar() {
    panel.classList.add('open');
    document.body.classList.add('sidebar-open');
    listView.style.display = 'block';
    contentView.style.display = 'none';
    document.getElementById('plugin-sidebar-title').textContent = '插件';
    window.pluginManager.renderPluginList();
}

function closePluginSidebar() {
    panel.classList.remove('open');
    document.body.classList.remove('sidebar-open');
    listView.style.display = 'block';
    contentView.style.display = 'none';
    document.querySelectorAll('.ribbon-btn.plugin-btn').forEach(b => b.classList.remove('active'));
}

closeBtn.addEventListener('click', closePluginSidebar);

// ========== 返回首页 ==========
document.getElementById('back-to-home').addEventListener('click', () => {
    showView('home');
    loadPackages();
    loadFavorites();
});

// ========== 配置初始化 ==========
async function initConfig() {
    const config = await fetch('/api/config').then(r => r.json());
    const lanWrapper = document.getElementById('lan-toggle-wrapper');
    if (lanWrapper) lanWrapper.style.display = isLocalHost() ? '' : 'none';
    document.getElementById('toggle-lan').checked = config.lan_enabled;
    document.getElementById('toggle-theme').checked = config.theme === 'dark';
    document.body.setAttribute('data-theme', config.theme);

    document.getElementById('toggle-lan').addEventListener('change', function() {
        if (this.checked && !isMobile() && isLocalHost()) showQRModal(); else hideQRModal();
        saveCurrentConfig();
    });
    document.getElementById('toggle-theme').addEventListener('change', function() {
        document.body.setAttribute('data-theme', this.checked ? 'dark' : 'light');
        saveCurrentConfig();
    });
}

async function saveCurrentConfig() {
    const lan = document.getElementById('toggle-lan').checked;
    const theme = document.getElementById('toggle-theme').checked ? 'dark' : 'light';
    await apiPost('/api/config', {
        lan_enabled: lan,
        ai_enabled: false,
        theme: theme,
        default_count: parseInt(document.getElementById('input-count').value, 10),
        default_interval: parseInt(document.getElementById('select-interval').value, 10),
        default_upload_package: ''
    });
}

// ========== 二维码弹窗 ==========
async function showQRModal() {
    if (!isLocalHost() || isMobile()) return;
    const modal = document.getElementById('qr-modal');
    const img = document.getElementById('qr-modal-image');
    const urlText = document.getElementById('qr-modal-url');
    if (!modal || !img || !urlText) return;
    try {
        const netResp = await fetch('/api/network-info');
        const netData = await netResp.json();
        const fullURL = `http://${netData.ip}:${netData.port}/static/index.html`;
        urlText.innerHTML = `地址：${fullURL}<br><small>请用手机浏览器扫码<br>（微信可能拦截，建议用 Safari/Chrome）</small>`;
        img.src = '/api/qrcode?t=' + Date.now();
    } catch (e) {
        img.src = '';
        urlText.textContent = '获取二维码失败';
    }
    modal.style.display = 'flex';
}
function hideQRModal() { const m = document.getElementById('qr-modal'); if (m) m.style.display = 'none'; }
document.getElementById('close-qr-modal').addEventListener('click', hideQRModal);

// ========== 默认设置弹窗 ==========
document.getElementById('open-defaults-btn').addEventListener('click', async () => {
    try {
        const config = await fetch('/api/config').then(r => r.json());
        document.getElementById('default-count-input').value = config.default_count || 5;
        document.getElementById('default-interval-select').value = config.default_interval || 60;

        let pkgSelect = document.getElementById('default-upload-package-select');
        if (!pkgSelect) {
            const field = document.createElement('div');
            field.className = 'field';
            field.innerHTML = '<label>图片上传默认图包：</label><select id="default-upload-package-select"><option value="">-- 无 --</option></select>';
            const modalContent = document.querySelector('#defaults-modal .modal-content');
            const actionsDiv = document.querySelector('#defaults-modal .modal-actions');
            if (modalContent && actionsDiv) {
                modalContent.insertBefore(field, actionsDiv);
                pkgSelect = document.getElementById('default-upload-package-select');
            } else if (modalContent) {
                modalContent.appendChild(field);
                pkgSelect = document.getElementById('default-upload-package-select');
            }
        }

        const resp = await fetch('/api/packages');
        const data = await resp.json();
        if (pkgSelect) {
            pkgSelect.innerHTML = '<option value="">-- 无 --</option>';
            data.packages.forEach(pkg => {
                const opt = document.createElement('option');
                opt.value = pkg.name;
                opt.textContent = pkg.name;
                if (pkg.name === (config.default_upload_package || '')) opt.selected = true;
                pkgSelect.appendChild(opt);
            });
        }
        document.getElementById('defaults-modal').style.display = 'flex';
    } catch (err) {
        console.error('打开默认设置失败：', err);
    }
});
document.getElementById('close-defaults-btn').addEventListener('click', () => {
    document.getElementById('defaults-modal').style.display = 'none';
});
document.getElementById('save-defaults-btn').addEventListener('click', async () => {
    const count = parseInt(document.getElementById('default-count-input').value, 10);
    const interval = parseInt(document.getElementById('default-interval-select').value, 10);
    const defaultUploadPkg = document.getElementById('default-upload-package-select')?.value || '';
    await apiPost('/api/config', {
        lan_enabled: document.getElementById('toggle-lan').checked,
        ai_enabled: false,
        theme: document.getElementById('toggle-theme').checked ? 'dark' : 'light',
        default_count: count,
        default_interval: interval,
        default_upload_package: defaultUploadPkg
    });
    document.getElementById('defaults-modal').style.display = 'none';
});

// ========== 移动图片模态框 ==========
async function openMoveImageModal() {
    const modal = document.getElementById('move-image-modal');
    const select = document.getElementById('target-category-select');
    const resp = await apiPost('/api/favorites/list_all_categories', {});
    select.innerHTML = '';
    resp.categories.forEach(cat => {
        if (cat.path !== pendingMoveCategory) {
            const opt = document.createElement('option');
            opt.value = cat.path;
            opt.textContent = cat.path || '根目录';
            select.appendChild(opt);
        }
    });
    modal.style.display = 'flex';
}

function closeMoveImageModal() {
    document.getElementById('move-image-modal').style.display = 'none';
    pendingMoveFile = null;
    pendingMoveCategory = null;
}

document.getElementById('cancel-move-btn').addEventListener('click', closeMoveImageModal);
document.getElementById('confirm-move-btn').addEventListener('click', async () => {
    const target = document.getElementById('target-category-select').value;
    if (!target || !pendingMoveFile || !pendingMoveCategory) return;
    await apiPost('/api/manage/move_favorite_image', {
        category: pendingMoveCategory,
        filename: pendingMoveFile,
        new_category: target
    });
    closeMoveImageModal();
    loadFavoritesBrowse();
});

// 播放器模式下左侧边缘触发
document.addEventListener('mousemove', (e) => {
    if (!document.body.classList.contains('player-active')) return;
    const ribbon = document.getElementById('plugin-ribbon');
    if (e.clientX < 10) {
        ribbon.classList.add('active');
    } else if (!ribbon.matches(':hover') && !document.getElementById('plugin-sidebar-panel').matches(':hover')) {
        ribbon.classList.remove('active');
    }
});

// ========== 页面启动 ==========
window.loadPackages = loadPackages;
window.addEventListener('DOMContentLoaded', async () => {
    await initConfig();
    showView('home');
    loadPackages();
    loadFavorites();
    await window.pluginManager.loadPlugins();
    closePluginSidebar();
    if (document.getElementById('toggle-lan').checked && !isMobile() && isLocalHost()) showQRModal();
});