"""
practice_manager.py —— 进度与收藏管理层
保存文件名时使用可读名称，无乱码

修改说明：
- 移除硬编码 METADATA_DIR、TEMP_DIR、FAVORITES_DIR、PACKAGES_DIR
- 改为通过 set_paths() 从 main.py 传入，支持灵活配置
- 使用 pathlib 进行路径管理
"""

import os
import json
import shutil
import uuid
import time
import zipfile
import unicodedata
from pathlib import Path

# 路径常量：由 main.py 在启动时通过 set_paths() 设置
METADATA_DIR = Path("./metadata")
TEMP_DIR = Path("./temp_preview")
FAVORITES_DIR = Path("./favorites")
PACKAGES_DIR = Path("./sketch_packages")


def set_paths(metadata_dir: str | Path, temp_dir: str | Path, 
              favorites_dir: str | Path, packages_dir: str | Path):
    """
    设置工作目录路径。由 main.py 在启动时调用。

    Args:
        metadata_dir: 元数据存储目录
        temp_dir: 临时预览目录
        favorites_dir: 收藏目录
        packages_dir: 图包存储目录
    """
    global METADATA_DIR, TEMP_DIR, FAVORITES_DIR, PACKAGES_DIR
    METADATA_DIR = Path(metadata_dir).resolve()
    TEMP_DIR = Path(temp_dir).resolve()
    FAVORITES_DIR = Path(favorites_dir).resolve()
    PACKAGES_DIR = Path(packages_dir).resolve()
    # 确保目录存在
    METADATA_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    FAVORITES_DIR.mkdir(parents=True, exist_ok=True)
    PACKAGES_DIR.mkdir(parents=True, exist_ok=True)


def _ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def get_metadata(package_name: str) -> dict:
    _ensure_dir(METADATA_DIR)
    meta_path = METADATA_DIR / f"{package_name}.json"
    if not meta_path.exists():
        return {"package_name": package_name, "total_count": 0, "practiced_list": []}
    with open(meta_path, "r", encoding="utf-8") as f:
        return json.load(f)


def update_metadata(package_name: str, practiced_files: list[str], total_count: int):
    """
    更新练习记录，将文件名 NFC 规范化后合并去重，保留完整路径（不截取 basename）。
    """
    _ensure_dir(METADATA_DIR)
    meta = get_metadata(package_name)

    new_set = {unicodedata.normalize('NFC', f) for f in practiced_files}
    old_set = {unicodedata.normalize('NFC', f) for f in meta.get("practiced_list", [])}

    combined = list(old_set | new_set)
    meta["practiced_list"] = combined
    meta["total_count"] = total_count

    meta_path = METADATA_DIR / f"{package_name}.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


def clear_temp_folder():
    if TEMP_DIR.exists():
        shutil.rmtree(TEMP_DIR)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)


def save_to_favorites(source_filename: str, category_path: str):
    src = TEMP_DIR / source_filename
    if not src.exists():
        print(f"收藏失败：源文件不存在 {src}")
        return
    dest_dir = FAVORITES_DIR / category_path
    _ensure_dir(dest_dir)
    dest = dest_dir / source_filename
    shutil.copy2(src, dest)
    print(f"已收藏到：{dest}")


def get_favorites_categories() -> list[dict]:
    if not FAVORITES_DIR.is_dir():
        return []
    categories = []
    root_files = [f for f in os.listdir(FAVORITES_DIR) 
                  if (FAVORITES_DIR / f).is_file() and f.lower().endswith(('.jpg','.jpeg','.png','.webp'))]
    if root_files:
        categories.append({"name": "未分类", "count": len(root_files)})

    for item in os.listdir(FAVORITES_DIR):
        item_path = FAVORITES_DIR / item
        if item_path.is_dir():
            count = 0
            for root, dirs, files in os.walk(item_path):
                count += len([f for f in files if f.lower().endswith(('.jpg','.jpeg','.png','.webp'))])
            if count > 0:
                categories.append({"name": item, "count": count})
    return categories


def list_favorites_files(category: str) -> list[str]:
    cat_path = category.replace("/", os.sep)
    full_dir = FAVORITES_DIR / cat_path
    if not full_dir.is_dir():
        return []
    return [f for f in os.listdir(full_dir) if f.lower().endswith(('.jpg','.jpeg','.png','.webp'))]


def copy_favorites_to_temp(category: str, filenames: list[str]) -> list[str]:
    clear_temp_folder()
    cat_path = category.replace("/", os.sep)
    src_dir = FAVORITES_DIR / cat_path
    urls = []
    for fname in filenames:
        src = src_dir / fname
        if src.exists():
            dest = TEMP_DIR / fname
            shutil.copy2(src, dest)
            urls.append(f"/temp/{fname}")
        else:
            print(f"警告：收藏文件不存在 {src}")
    return urls


def reset_package(package_name: str):
    meta = get_metadata(package_name)
    meta["practiced_list"] = []
    meta_path = METADATA_DIR / f"{package_name}.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


def delete_package(package_name: str):
    pkg_path = PACKAGES_DIR / package_name
    if pkg_path.exists():
        os.remove(pkg_path)
    meta_path = METADATA_DIR / f"{package_name}.json"
    if meta_path.exists():
        os.remove(meta_path)


def delete_favorite_category(category: str):
    """删除指定收藏分类目录及其所有文件"""
    cat_path = category.replace("/", os.sep)
    full_dir = FAVORITES_DIR / cat_path
    if full_dir.is_dir():
        shutil.rmtree(full_dir)


def pack_category_to_zip(category: str) -> str:
    """将收藏分类下的所有图片打包为 ZIP，使用分类名作为图包名"""
    cat_path = category.replace("/", os.sep)
    src_dir = FAVORITES_DIR / cat_path
    if not src_dir.is_dir():
        raise Exception("分类不存在")
    zip_name = category.replace("/", "_") + ".zip"
    zip_path = PACKAGES_DIR / zip_name
    if zip_path.exists():
        raise Exception("同名图包已存在，请先删除或重命名收藏夹")
    with zipfile.ZipFile(zip_path, 'w') as zf:
        for root, dirs, files in os.walk(src_dir):
            for f in files:
                if f.lower().endswith(('.jpg','.jpeg','.png','.webp')):
                    file_path = os.path.join(root, f)
                    arcname = os.path.relpath(file_path, src_dir)
                    zf.write(file_path, arcname)
    return zip_name


def browse_favorites(path: str = ""):
    """返回指定路径下的子文件夹和图片文件列表"""
    base_dir = FAVORITES_DIR / path.replace("/", os.sep)
    if not base_dir.is_dir():
        return {"folders": [], "files": []}
    items = os.listdir(base_dir)
    folders = []
    files = []
    for item in items:
        full = base_dir / item
        if full.is_dir():
            folders.append({"name": item, "path": (path + "/" + item).lstrip("/")})
        elif item.lower().endswith(('.jpg','.jpeg','.png','.webp')):
            files.append(item)
    return {"folders": folders, "files": files}


def move_category_to_parent(path: str):
    """将文件夹移动到父目录的同级（向上移动）"""
    if '/' not in path:
        raise Exception("已经是根目录")
    folder_name = path.split('/')[-1]
    new_path = folder_name
    move_favorite_category(path, new_path)


def delete_favorite_item(path: str):
    """删除指定收藏夹路径（文件夹）"""
    delete_favorite_category(path)


def move_favorite_image(category: str, filename: str, new_category: str):
    """将图片从一个收藏分类移动到另一个"""
    old_path = FAVORITES_DIR / category.replace("/", os.sep) / filename
    new_dir = FAVORITES_DIR / new_category.replace("/", os.sep)
    if not old_path.exists():
        raise Exception("文件不存在")
    os.makedirs(new_dir, exist_ok=True)
    new_path = new_dir / filename
    shutil.move(old_path, new_path)


def delete_favorite_image(category: str, filename: str):
    """删除指定收藏分类中的某个图片"""
    file_path = FAVORITES_DIR / category.replace("/", os.sep) / filename
    if file_path.exists():
        os.remove(file_path)


def move_favorite_category(old_path: str, new_path: str):
    """移动分类，并清理空旧目录"""
    old_dir = FAVORITES_DIR / old_path.replace("/", os.sep)
    new_dir = FAVORITES_DIR / new_path.replace("/", os.sep)
    if old_dir.is_dir():
        os.makedirs(os.path.dirname(new_dir), exist_ok=True)
        shutil.move(old_dir, new_dir)
    _remove_empty_dirs(os.path.dirname(old_dir))


def _remove_empty_dirs(path):
    """递归删除空文件夹"""
    if not os.path.isdir(path):
        return
    for root, dirs, files in os.walk(path, topdown=False):
        for d in dirs:
            full = os.path.join(root, d)
            if not os.listdir(full):
                os.rmdir(full)


def list_all_categories():
    """递归返回所有收藏分类路径（相对于 favorites 根目录）"""
    categories = []
    for root, dirs, files in os.walk(FAVORITES_DIR):
        rel_path = os.path.relpath(root, FAVORITES_DIR)
        if rel_path == ".":
            for d in dirs:
                categories.append({"path": d, "name": d})
        else:
            categories.append({"path": rel_path.replace(os.sep, "/"), "name": rel_path.split(os.sep)[-1]})
    return categories