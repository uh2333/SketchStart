"""
package_scanner.py —— 压缩包扫描与解压层（修复中文文件名乱码）

修改说明：
- 保留默认路径（向后兼容），但支持通过 set_paths() 从外部覆盖
- 所有路径操作使用 Path 对象，支持灵活配置
"""

import os
import shutil
import zipfile
import unicodedata
import pathlib
from pathlib import Path

# 尝试导入 rarfile
try:
    import rarfile
    RARFILE_AVAILABLE = True
except ImportError:
    RARFILE_AVAILABLE = False

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}

# 默认路径（向后兼容，可被 set_paths 覆盖）
PACKAGES_DIR = Path("./sketch_packages")
TEMP_DIR = Path("./temp_preview")


def set_paths(packages_dir=None, temp_dir=None):
    """
    覆盖默认路径。由 main.py 在启动时调用。
    参数为 None 时保持默认值（向后兼容）。
    """
    global PACKAGES_DIR, TEMP_DIR
    if packages_dir is not None:
        PACKAGES_DIR = Path(packages_dir).resolve()
        PACKAGES_DIR.mkdir(parents=True, exist_ok=True)
    if temp_dir is not None:
        TEMP_DIR = Path(temp_dir).resolve()
        TEMP_DIR.mkdir(parents=True, exist_ok=True)


def _decode_filename(raw_bytes, possible_encodings=('gbk', 'utf-8')):
    """尝试解码字节为字符串，并统一为 NFC 规范化"""
    for enc in possible_encodings:
        try:
            decoded = raw_bytes.decode(enc)
            return unicodedata.normalize('NFC', decoded)
        except UnicodeDecodeError:
            continue
    return unicodedata.normalize('NFC', raw_bytes.decode('utf-8', errors='replace'))


def _is_image(filename: str) -> bool:
    ext = pathlib.Path(filename).suffix.lower()
    return ext in IMAGE_EXTENSIONS


def get_all_packages() -> list[str]:
    """扫描素材包目录，返回文件名列表"""
    if not PACKAGES_DIR.is_dir():
        return []
    packages = []
    for fname in os.listdir(PACKAGES_DIR):
        if fname.lower().endswith(".zip") or fname.lower().endswith(".rar"):
            packages.append(fname)
    return packages


def list_package_contents(package_name: str) -> list[str]:
    """列出压缩包内所有图片文件名（解码为可读字符串）"""
    full_path = PACKAGES_DIR / package_name
    if not full_path.exists():
        return []

    if package_name.lower().endswith(".zip"):
        try:
            with zipfile.ZipFile(full_path, 'r') as zf:
                namelist = zf.namelist()
                images = []
                for name in namelist:
                    try:
                        raw_name = name.encode('cp437')
                    except UnicodeEncodeError:
                        raw_name = name.encode('utf-8', errors='replace')
                    decoded = _decode_filename(raw_name)
                    if _is_image(decoded):
                        images.append(decoded)
                return images
        except Exception as e:
            print(f"读取 ZIP 内容时出错：{e}")
            return []

    elif package_name.lower().endswith(".rar"):
        if not RARFILE_AVAILABLE:
            print("警告：跳过RAR（未安装 rarfile 库或导入失败）")
            return []
        try:
            with rarfile.RarFile(full_path, 'r') as rf:
                namelist = rf.namelist()
                images = []
                for name in namelist:
                    if _is_image(name):
                        images.append(name)
                    else:
                        try:
                            raw = name.encode('cp437')
                            decoded = _decode_filename(raw)
                            if _is_image(decoded):
                                images.append(decoded)
                        except:
                            pass
                return images
        except Exception as e:
            print(f"读取 RAR 内容时出错：{e}")
            return []
    else:
        return []


def get_file_bytes(package_name: str, filename: str) -> bytes | None:
    """从压缩包中读取指定文件的二进制数据（用于预览 Base64）"""
    full_path = PACKAGES_DIR / package_name
    if not full_path.exists():
        return None

    if package_name.lower().endswith(".zip"):
        try:
            with zipfile.ZipFile(full_path, 'r') as zf:
                for info in zf.infolist():
                    try:
                        raw_name = info.filename.encode('cp437')
                    except:
                        raw_name = info.filename.encode('utf-8', errors='replace')
                    decoded = _decode_filename(raw_name)
                    if decoded == filename:
                        return zf.read(info.filename)
        except Exception:
            return None
    elif package_name.lower().endswith(".rar"):
        if not RARFILE_AVAILABLE:
            return None
        try:
            with rarfile.RarFile(full_path, 'r') as rf:
                if filename in rf.namelist():
                    return rf.read(filename)
                for member in rf.infolist():
                    if member.filename == filename:
                        return rf.read(member)
        except Exception:
            return None
    return None


def extract_selected_files(package_name: str, selected_filenames: list[str]):
    """
    解压用户选中的图片文件到临时预览目录。
    selected_filenames 中的文件名应该是 list_package_contents 返回的可读文件名。
    """
    # 清空临时目录
    if TEMP_DIR.exists():
        shutil.rmtree(TEMP_DIR)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    full_path = PACKAGES_DIR / package_name
    if not full_path.exists():
        return

    if package_name.lower().endswith(".zip"):
        try:
            with zipfile.ZipFile(full_path, 'r') as zf:
                for info in zf.infolist():
                    try:
                        raw_name = info.filename.encode('cp437')
                    except:
                        raw_name = info.filename.encode('utf-8', errors='replace')
                    decoded = _decode_filename(raw_name)
                    if decoded in selected_filenames:
                        target = TEMP_DIR / os.path.basename(decoded)
                        with zf.open(info.filename) as src, open(target, 'wb') as dst:
                            shutil.copyfileobj(src, dst)
        except Exception as e:
            print(f"解压 ZIP 时出错：{e}")

    elif package_name.lower().endswith(".rar"):
        if not RARFILE_AVAILABLE:
            print("警告：跳过RAR解压（rarfile 不可用）")
            return
        try:
            with rarfile.RarFile(full_path, 'r') as rf:
                for member in rf.infolist():
                    decoded = member.filename
                    if decoded in selected_filenames:
                        target = TEMP_DIR / os.path.basename(decoded)
                        with rf.open(member) as src, open(target, 'wb') as dst:
                            shutil.copyfileobj(src, dst)
        except Exception as e:
            print(f"解压 RAR 时出错：{e}")


def extract_single(package_name: str, filename: str, save_as: str):
    full_path = PACKAGES_DIR / package_name
    if not full_path.exists():
        raise Exception("包不存在")
    if package_name.lower().endswith(".zip"):
        with zipfile.ZipFile(full_path, 'r') as zf:
            for info in zf.infolist():
                try:
                    raw = info.filename.encode('cp437')
                except:
                    raw = info.filename.encode('utf-8', errors='replace')
                decoded = _decode_filename(raw)
                if os.path.normpath(decoded) == os.path.normpath(filename):
                    target = TEMP_DIR / save_as
                    with zf.open(info.filename) as src, open(target, 'wb') as dst:
                        shutil.copyfileobj(src, dst)
                    return
        raise Exception(f"文件 {filename} 在 ZIP 中未找到")
    elif package_name.lower().endswith(".rar"):
        if not RARFILE_AVAILABLE:
            raise Exception("rarfile 库不可用")
        with rarfile.RarFile(full_path, 'r') as rf:
            for member in rf.infolist():
                if os.path.normpath(member.filename) == os.path.normpath(filename):
                    target = TEMP_DIR / save_as
                    with rf.open(member) as src, open(target, 'wb') as dst:
                        shutil.copyfileobj(src, dst)
                    return
        raise Exception(f"文件 {filename} 在 RAR 中未找到")
    else:
        raise Exception("不支持的格式")