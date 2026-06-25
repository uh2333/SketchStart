"""
main.py —— 后端路由胶水层（Obsidian 模式完整版）
包含：所有原有 API + 管理、多图包练习、上传限制、Obsidian 模式插件系统

修改说明：
- 新增全局常量 ROOT_DIR（从 config 文件读取，默认当前目录）
- 所有数据存储子目录统一放在 ROOT_DIR/data 下
- 使用 pathlib 进行路径管理，支持灵活配置
- 修复：子模块路径同步问题（import 后立即调用 set_paths）
"""

import os
import sys
import base64
import socket
import mimetypes
from io import BytesIO
from pathlib import Path
import qrcode

# ========== 修复打包后 MIME 类型问题 ==========
# 强制注册 .js 文件的 MIME 类型，确保打包后也能正确识别
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/css', '.css')

from fastapi import FastAPI, File, UploadFile, Request, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, Response, FileResponse
import uvicorn
import webbrowser
import shutil
import json
import uuid
import time
import zipfile
import pathlib
import random
import unicodedata
import re

# ========== 第一步：加载配置，定义根目录 ==========
import config_manager

# 从 config 读取根目录，若不存在则默认使用程序根目录
_config = config_manager.load_config()
ROOT_DIR = Path(_config.get("root_dir", ".")).resolve()

# 数据存储根目录：ROOT_DIR/data
DATA_ROOT = ROOT_DIR / "data"

# 各业务子目录（统一放在 DATA_ROOT 下）
SKETCH_PACKAGES_DIR = DATA_ROOT / "sketch_packages"
TEMP_PREVIEW_DIR    = DATA_ROOT / "temp_preview"
METADATA_DIR        = DATA_ROOT / "metadata"
FAVORITES_DIR       = DATA_ROOT / "favorites"
PLUGINS_DIR         = DATA_ROOT / "plugins"
PLUGINS_DATA_DIR    = DATA_ROOT / "data"  # 插件配置数据目录

# 静态资源目录（保持独立，不放入 data）
STATIC_DIR = Path("static").resolve()

# 目录路径字符串（供需要字符串的地方使用）
SKETCH_PACKAGES_STR = str(SKETCH_PACKAGES_DIR)
TEMP_PREVIEW_STR    = str(TEMP_PREVIEW_DIR)
METADATA_STR        = str(METADATA_DIR)
FAVORITES_STR       = str(FAVORITES_DIR)
PLUGINS_STR         = str(PLUGINS_DIR)
PLUGINS_DATA_STR    = str(PLUGINS_DATA_DIR)
STATIC_STR          = str(STATIC_DIR)

# 安全目录列表（供 Vault API 访问控制使用）
SAFE_DIRS = [
    SKETCH_PACKAGES_STR,
    FAVORITES_STR,
    TEMP_PREVIEW_STR,
    METADATA_STR,
    PLUGINS_STR,
    PLUGINS_DATA_STR,
]

# ========== 第二步：导入子模块并同步路径（关键修复）==========
import package_scanner
import practice_manager

# 立即覆盖子模块的默认路径，确保后续函数调用使用正确的目录
package_scanner.set_paths(SKETCH_PACKAGES_STR, TEMP_PREVIEW_STR)
practice_manager.set_paths(METADATA_STR, TEMP_PREVIEW_STR, FAVORITES_STR, SKETCH_PACKAGES_STR)

# 从 plugin_loader 导入（必须在路径设置之后）
from plugin_loader import load_plugins, router as plugin_router

app = FastAPI(title="本地速写练习管理器")
multi_sessions = {}

# 确保必要目录存在（基于 DATA_ROOT）
SKETCH_PACKAGES_DIR.mkdir(parents=True, exist_ok=True)
TEMP_PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
METADATA_DIR.mkdir(parents=True, exist_ok=True)
FAVORITES_DIR.mkdir(parents=True, exist_ok=True)
PLUGINS_DIR.mkdir(parents=True, exist_ok=True)
PLUGINS_DATA_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR.mkdir(parents=True, exist_ok=True)

# 挂载静态资源
app.mount("/temp", StaticFiles(directory=TEMP_PREVIEW_STR), name="temp")
app.mount("/static", StaticFiles(directory=STATIC_STR, html=True), name="static")
app.mount("/favorites", StaticFiles(directory=FAVORITES_STR), name="favorites")



# 挂载插件静态资源（由 plugin_loader 动态挂载每个插件子目录）
# 注意：这里不再全局挂载 /plugins，改由 plugin_loader 为每个插件单独挂载

# ---------- 本机 IP ----------
def get_local_ip():
    try:
        import netifaces
        gateways = netifaces.gateways()
        default_iface = gateways['default'][netifaces.AF_INET][1]
        addrs = netifaces.ifaddresses(default_iface)
        ip = addrs[netifaces.AF_INET][0]['addr']
        return ip
    except:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(('10.254.254.254', 1))
            ip = s.getsockname()[0]
        except:
            ip = '127.0.0.1'
        finally:
            s.close()
        return ip

PORT = 8443

def generate_qr_image(ip):
    url = f"http://{ip}:{PORT}/static/index.html"
    qr = qrcode.QRCode(version=1, box_size=5, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.getvalue()

# ---------- 动态局域网访问控制中间件 ----------
@app.middleware("http")
async def lan_access_control(request: Request, call_next):
    if request.url.path.startswith("/static") or request.url.path.startswith("/api"):
        config = config_manager.load_config()
        lan_enabled = config.get("lan_enabled", False)
        if not lan_enabled:
            client_host = request.client.host
            if client_host not in ("127.0.0.1", "::1"):
                return JSONResponse(status_code=403, content={"detail": "局域网访问未开启"})
    response = await call_next(request)
    return response

# ---------- Vault API（文件系统访问，供插件使用）----------
# @app.get("/api/file")
# async def get_file(path: str):
#     """读取文件（供 Vault API 使用）"""
#     full_path = os.path.abspath(path)
#     is_safe = any(full_path.startswith(d) for d in SAFE_DIRS)

#     if not is_safe:
#         return JSONResponse(status_code=403, content={"detail": "访问被拒绝"})

#     if not os.path.exists(full_path) or not os.path.isfile(full_path):
#         return JSONResponse(status_code=404, content={"detail": "文件不存在"})

#     content_type, _ = mimetypes.guess_type(full_path)
#     return FileResponse(full_path, media_type=content_type)
@app.get("/api/file")
async def get_file(path: str = ""):
    print(f"[FILE] 收到请求, path={path}")
    if not path:
        return JSONResponse(status_code=400, content={"detail": "缺少 path 参数"})

    # 如果前端传入虚拟路径 /data/... ，映射到真实的 DATA_ROOT
    if path.startswith("/data/"):
        rel_path = path[len("/data/"):].lstrip("/")
        full_path = os.path.join(DATA_ROOT, rel_path)
    else:
        full_path = os.path.abspath(path)

    # 安全检查（映射后的物理路径会匹配 SAFE_DIRS）
    is_safe = any(full_path.startswith(d) for d in SAFE_DIRS)
    if not is_safe:
        return JSONResponse(status_code=403, content={"detail": "访问被拒绝"})

    if not os.path.exists(full_path):
        return JSONResponse(status_code=404, content={"detail": "文件不存在"})

    return FileResponse(full_path)

@app.get("/api/list")
async def list_directory(dir: str = ""):
    if not dir:
        target = str(SKETCH_PACKAGES_DIR)  # 默认图包目录
    else:
        target = os.path.abspath(dir)
    is_safe = any(target.startswith(d) for d in SAFE_DIRS) or target == os.path.abspath(".")
    if not is_safe:
        return JSONResponse(status_code=403, content={"detail": "访问被拒绝"})
    if not os.path.isdir(target):
        return {"files": [], "dirs": []}
    items = os.listdir(target)
    files = [f for f in items if os.path.isfile(os.path.join(target, f))]
    dirs = [d for d in items if os.path.isdir(os.path.join(target, d))]
    return {"files": files, "dirs": dirs, "path": dir}

@app.get("/api/exists")
async def check_exists(path: str):
    """检查文件是否存在"""
    return {"exists": os.path.exists(path)}


# ---------- Vault API：文件写入（供插件使用）----------
# @app.post("/api/upload")
# async def upload_file(request: Request, path: str = ""):
#     """写入文件（供 Vault API 使用）"""
#     if not path:
#         return JSONResponse(status_code=400, content={"detail": "缺少 path 参数"})

#     full_path = os.path.abspath(path)
#     is_safe = any(full_path.startswith(d) for d in SAFE_DIRS)

#     if not is_safe:
#         return JSONResponse(status_code=403, content={"detail": "访问被拒绝"})

#     # 自动创建中间目录（修复：处理无目录的情况）
#     parent_dir = os.path.dirname(full_path)
#     if parent_dir:
#         os.makedirs(parent_dir, exist_ok=True)

#     body = await request.body()
#     with open(full_path, "wb") as f:
#         f.write(body)

#     return {"status": "ok", "path": path}
@app.post("/api/upload")
async def upload_file(request: Request, path: str = ""):
    if not path:
        return JSONResponse(status_code=400, content={"detail": "缺少 path 参数"})

    # 如果前端传入虚拟路径 /data/... ，映射到真实的 DATA_ROOT
    if path.startswith("/data/"):
        rel_path = path[len("/data/"):].lstrip("/")   # "plugins/plugin-manager/config.json"
        full_path = os.path.join(DATA_ROOT, rel_path)
    else:
        full_path = os.path.abspath(path)

    # 安全检查（现在 full_path 已经是实际路径，能匹配 SAFE_DIRS 中的 PLUGINS_STR 等）
    is_safe = any(full_path.startswith(d) for d in SAFE_DIRS)
    if not is_safe:
        return JSONResponse(status_code=403, content={"detail": "访问被拒绝"})

    # 自动创建父目录
    parent_dir = os.path.dirname(full_path)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)

    body = await request.body()
    with open(full_path, "wb") as f:
        f.write(body)

    return {"status": "ok", "path": path}
# ---------- 原有 API ----------
@app.get("/api/qrcode")
async def get_qrcode(request: Request):
    config = config_manager.load_config()
    if not config.get("lan_enabled", False):
        return JSONResponse(status_code=403, content={"detail": "请先开启局域网"})
    ip = get_local_ip()
    img_bytes = generate_qr_image(ip)
    return Response(content=img_bytes, media_type="image/png")

@app.get("/api/network-info")
async def network_info():
    return {"ip": get_local_ip(), "port": PORT}

@app.get("/api/config")
async def get_config():
    return config_manager.load_config()

@app.post("/api/config")
async def update_config(request: Request):
    data = await request.json()
    config_manager.save_config(data)
    # 注意：修改 root_dir 后需要重启服务才能生效
    return {"status": "ok", "message": "配置已保存，修改 root_dir 需重启服务生效"}

@app.get("/api/packages")
async def list_packages():
    packages = package_scanner.get_all_packages()
    result = []
    for pkg in packages:
        meta = practice_manager.get_metadata(pkg)
        total = len(package_scanner.list_package_contents(pkg))
        practiced_count = len(meta.get("practiced_list", []))
        is_completed = (total > 0) and (practiced_count >= total)
        all_images = package_scanner.list_package_contents(pkg)
        preview_images = []
        for img_name in all_images[:3]:
            img_bytes = package_scanner.get_file_bytes(pkg, img_name)
            if img_bytes:
                b64 = base64.b64encode(img_bytes).decode("utf-8")
                preview_images.append(b64)
        result.append({
            "name": pkg,
            "total": total,
            "practiced_count": practiced_count,
            "is_completed": is_completed,
            "preview_images": preview_images
        })
    return {"packages": result}

# ---------- 上传限制 + 图片自动打包 ----------
ALLOWED_EXTENSIONS = {'.zip', '.rar', '.jpg', '.jpeg', '.png', '.webp'}
@app.post("/api/upload_package")
async def upload_package(file: UploadFile = File(...), target_package: str = Form(None), create_new: bool = Form(False)):
    original_name = file.filename
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return JSONResponse(status_code=400, content={"detail": f"不支持的文件类型：{ext}"})

    content = await file.read()

    if ext in ('.jpg', '.jpeg', '.png', '.webp'):
        if create_new:
            if not target_package:
                return JSONResponse(status_code=400, content={"detail": "新建图包需要提供名称"})
            if not target_package.lower().endswith('.zip'):
                target_package += '.zip'
            zip_path = SKETCH_PACKAGES_DIR / target_package
            if zip_path.exists():
                with zipfile.ZipFile(zip_path, 'a') as zf:
                    zf.writestr(original_name, content)
            else:
                with zipfile.ZipFile(zip_path, 'w') as zf:
                    zf.writestr(original_name, content)
            return {"status": "ok", "filename": target_package}
        else:
            if not target_package:
                return JSONResponse(status_code=400, content={"detail": "请选择要添加的图包"})
            zip_path = SKETCH_PACKAGES_DIR / target_package
            if not zip_path.exists():
                return JSONResponse(status_code=404, content={"detail": "图包不存在"})
            with zipfile.ZipFile(zip_path, 'a') as zf:
                zf.writestr(original_name, content)
            return {"status": "ok", "filename": target_package}
    else:
        file_path = SKETCH_PACKAGES_DIR / original_name
        with open(file_path, "wb") as f:
            f.write(content)
        return {"status": "ok", "filename": original_name}

# ---------- 原有练习 API ----------
@app.post("/api/list_package_contents")
async def list_contents(request: Request):
    data = await request.json()
    pkg_name = data.get("package_name")
    exclude_practiced = data.get("exclude_practiced", False)
    all_files = package_scanner.list_package_contents(pkg_name)
    if exclude_practiced:
        meta = practice_manager.get_metadata(pkg_name)
        practiced = set(meta.get("practiced_list", []))
        all_files = [f for f in all_files if os.path.basename(f) not in practiced]
    return {"files": all_files}

@app.post("/api/start_practice")
async def start_practice(request: Request):
    practice_manager.clear_temp_folder()
    data = await request.json()
    source_type = data.get("source_type", "package")
    if source_type == "favorite":
        category = data.get("category", "未分类")
        selected = data.get("selected_files", [])
        image_urls = practice_manager.copy_favorites_to_temp(category, selected)
        return {"image_urls": image_urls}
    else:
        pkg_name = data.get("package_name")
        selected = data.get("selected_files", [])
        package_scanner.extract_selected_files(pkg_name, selected)
        image_urls = [f"/temp/{os.path.basename(f)}" for f in selected]
        return {"image_urls": image_urls}

@app.post("/api/finish_practice")
async def finish_practice(request: Request):
    data = await request.json()
    pkg_name = data.get("package_name", "")
    practiced_files = data.get("practiced_files", [])
    if pkg_name:
        total = len(package_scanner.list_package_contents(pkg_name))
        practice_manager.update_metadata(pkg_name, practiced_files, total)
    practice_manager.clear_temp_folder()
    return {"status": "ok"}

@app.post("/api/favorite")
async def add_favorite(request: Request):
    data = await request.json()
    practice_manager.save_to_favorites(data.get("temp_file_path"), data.get("category", "未分类"))
    return {"status": "ok"}



@app.get("/api/favorites")
async def get_favorites():
    return {"categories": practice_manager.get_favorites_categories()}

@app.post("/api/favorites/list")
async def list_favorites_files(request: Request):
    data = await request.json()
    category = data.get("category", "未分类")
    files = practice_manager.list_favorites_files(category)
    return {"files": files}

@app.post("/api/reset_package")
async def reset_package(request: Request):
    data = await request.json()
    practice_manager.reset_package(data.get("package_name"))
    return {"status": "ok"}

@app.post("/api/delete_package")
async def delete_package(request: Request):
    data = await request.json()
    practice_manager.delete_package(data.get("package_name"))
    return {"status": "ok"}

# ---------- 管理 API ----------
@app.get("/api/manage/list")
async def manage_list():
    packages = package_scanner.get_all_packages()
    fav_categories = practice_manager.get_favorites_categories()
    return {"packages": packages, "categories": fav_categories}

@app.post("/api/manage/delete_package")
async def manage_delete_package(request: Request):
    data = await request.json()
    practice_manager.delete_package(data.get("package_name"))
    return {"status": "ok"}

@app.post("/api/manage/reset_package")
async def manage_reset_package(request: Request):
    data = await request.json()
    practice_manager.reset_package(data.get("package_name"))
    return {"status": "ok"}

@app.post("/api/manage/delete_category")
async def manage_delete_category(request: Request):
    data = await request.json()
    practice_manager.delete_favorite_category(data.get("category"))
    return {"status": "ok"}

@app.post("/api/manage/move_category")
async def manage_move_category(request: Request):
    data = await request.json()
    practice_manager.move_favorite_category(data.get("old_path"), data.get("new_path"))
    return {"status": "ok"}

@app.post("/api/manage/pack_category")
async def manage_pack_category(request: Request):
    data = await request.json()
    try:
        new_pkg = practice_manager.pack_category_to_zip(data.get("category"))
        return {"status": "ok", "package_name": new_pkg}
    except Exception as e:
        return JSONResponse(status_code=400, content={"detail": str(e)})

# ---------- 多图包练习 ----------
@app.post("/api/multi-practice/start")
async def multi_start(request: Request):
    practice_manager.clear_temp_folder()
    data = await request.json()
    practices = data.get("practices", [])
    interval = data.get("interval", 60)

    selected_images = []
    package_totals = {}

    for p in practices:
        pkg = p["package_name"]
        count = p.get("count", 1)
        all_files = package_scanner.list_package_contents(pkg)
        if not all_files:
            continue
        meta = practice_manager.get_metadata(pkg)
        practiced = set(meta.get("practiced_list", []))
        available = [f for f in all_files if os.path.basename(f) not in practiced]
        if len(available) < count:
            count = len(available)
        picked = random.sample(available, count) if available else []
        package_totals[pkg] = len(all_files)
        for f in picked:
            selected_images.append({"package": pkg, "filename": f})

    if not selected_images:
        return JSONResponse(status_code=400, content={"detail": "没有可练习的图片"})

    session_id = str(uuid.uuid4())
    multi_sessions[session_id] = {
        "images": selected_images,
        "package_totals": package_totals
    }

    practice_manager.clear_temp_folder()
    urls = []
    for img in selected_images:
        try:
            save_as = os.path.basename(img["filename"])
            package_scanner.extract_single(img["package"], img["filename"], save_as)
            urls.append(f"/temp/{save_as}")
        except Exception as e:
            print(f"解压失败：{img['filename']}，错误：{e}")

    return {"image_urls": urls, "session_id": session_id}

@app.post("/api/multi-practice/finish")
async def multi_finish(request: Request):
    data = await request.json()
    session_id = data.get("session_id")
    practiced_files = data.get("practiced_files", [])

    session = multi_sessions.pop(session_id, None)
    if not session:
        return JSONResponse(status_code=404, content={"detail": "会话不存在或已过期"})

    images = session["images"]
    package_totals = session["package_totals"]

    pkg_to_files = {}
    for img in images:
        pkg = img["package"]
        pkg_to_files.setdefault(pkg, []).append(os.path.basename(img["filename"]))
    for pkg, flist in pkg_to_files.items():
        total = package_totals.get(pkg, 0)
        practice_manager.update_metadata(pkg, flist, total)

    return {"status": "ok"}

@app.post("/api/manage/merge_packages")
async def merge_packages(request: Request):
    data = await request.json()
    source = data.get("source")
    target = data.get("target")
    if not source or not target:
        return JSONResponse(status_code=400, content={"detail": "参数错误"})
    source_path = SKETCH_PACKAGES_DIR / source
    target_path = SKETCH_PACKAGES_DIR / target
    if not source_path.exists() or not target_path.exists():
        return JSONResponse(status_code=404, content={"detail": "图包不存在"})
    with zipfile.ZipFile(source_path, 'r') as zf_src:
        with zipfile.ZipFile(target_path, 'a') as zf_tgt:
            for member in zf_src.infolist():
                zf_tgt.writestr(member, zf_src.read(member.filename))
    os.remove(source_path)
    practice_manager.delete_package(source)
    return {"status": "ok"}

@app.post("/api/favorites/browse")
async def browse_favorites(request: Request):
    data = await request.json()
    path = data.get("path", "")
    result = practice_manager.browse_favorites(path)
    return result

@app.post("/api/manage/move_category_to_parent")
async def move_category_to_parent(request: Request):
    data = await request.json()
    practice_manager.move_category_to_parent(data.get("path"))
    return {"status": "ok"}

@app.post("/api/manage/delete_favorite_item")
async def delete_favorite_item(request: Request):
    data = await request.json()
    practice_manager.delete_favorite_item(data.get("path"))
    return {"status": "ok"}

@app.post("/api/manage/move_favorite_image")
async def move_favorite_image(request: Request):
    data = await request.json()
    practice_manager.move_favorite_image(
        data.get("category"), data.get("filename"), data.get("new_category")
    )
    return {"status": "ok"}

@app.post("/api/manage/delete_favorite_image")
async def delete_favorite_image(request: Request):
    data = await request.json()
    practice_manager.delete_favorite_image(
        data.get("category"), data.get("filename")
    )
    return {"status": "ok"}

@app.post("/api/favorites/list_all_categories")
async def list_all_categories():
    return {"categories": practice_manager.list_all_categories()}



# ---------- 插件加载（Obsidian 模式）----------
load_plugins(app, str(PLUGINS_DIR))
# 注册插件路由（必须在挂载 /plugins 静态文件之前）
app.include_router(plugin_router)
# ---------- 启动 ----------
if __name__ == "__main__":
    host = "0.0.0.0"
    print(f"启动 HTTP 服务器，端口 {PORT}")
    print(f"工作根目录: {ROOT_DIR}")
    print(f"数据目录: {DATA_ROOT}")
    print(f"图包目录: {SKETCH_PACKAGES_DIR}")
    print(f"元数据目录: {METADATA_DIR}")
    print(f"收藏目录: {FAVORITES_DIR}")
    print(f"插件目录: {PLUGINS_DIR}")
    print('当前可用后端路由:')
    for route in app.routes:
        print(route.path)
    webbrowser.open(f"http://127.0.0.1:{PORT}/static/index.html")
    uvicorn.run(app, host=host, port=PORT)
 