# bypy_manager.py
# 重构版本：手动 OAuth + 直接 API 调用（列表部分使用 bypy.list）

import os
import json
import time
import re
import requests
from pathlib import Path
from typing import List, Dict, Optional
from urllib.parse import urlencode

from bypy import const  # 导入 bypy 内部常量

# ========== 配置 ==========
ALLOWED_EXTENSIONS = {'.zip', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'}
TOKEN_URL = 'https://openapi.baidu.com/oauth/2.0/token'
AUTHORIZE_URL = 'https://openapi.baidu.com/oauth/2.0/authorize'
PCS_API_BASE = 'https://pan.baidu.com/rest/2.0/xpan'

# 全局路径（由 set_paths 设置）
SKETCH_PACKAGES_DIR = None
BYPY_CONFIG_DIR = None


def set_paths(packages_dir: str, plugin_dir: str):
    """设置路径，必须在导入 bypy 之前调用"""
    global SKETCH_PACKAGES_DIR, BYPY_CONFIG_DIR
    SKETCH_PACKAGES_DIR = Path(packages_dir)
    SKETCH_PACKAGES_DIR.mkdir(parents=True, exist_ok=True)

    BYPY_CONFIG_DIR = Path(plugin_dir) / ".bypy"
    BYPY_CONFIG_DIR.mkdir(parents=True, exist_ok=True)


class AuthExpiredError(Exception):
    pass


class BypyManager:
    """百度网盘管理器（手动 OAuth + 直接 API）"""

    def __init__(self):
        self._bp = None          # ByPy 实例（懒加载）
        self._token_data = None  # 缓存的 token 数据
        self._token_path = BYPY_CONFIG_DIR / "bypy.json"
        self._api_key = const.ApiKey
        self._secret_key = const.SecretKey

    # ---------- Token 管理 ----------
    def _load_token(self) -> Optional[Dict]:
        """从文件加载 token"""
        if self._token_path.exists():
            try:
                with open(self._token_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                return data
            except Exception:
                return None
        return None

    def _save_token(self, data: Dict):
        """保存 token 到文件（bypy 兼容格式）"""
        with open(self._token_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.chmod(self._token_path, 0o600)

    def _refresh_token(self, refresh_token: str) -> Dict:
        """刷新 access_token（设置了超时避免长时间阻塞）"""
        params = {
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token,
            'client_id': self._api_key,
            'client_secret': self._secret_key,
        }
        resp = requests.post(TOKEN_URL, data=params, timeout=10)  # 缩短超时
        resp.raise_for_status()
        token_data = resp.json()
        # 转换为 bypy 格式
        return {
            'access_token': token_data['access_token'],
            'refresh_token': token_data.get('refresh_token', refresh_token),
            'expires_at': time.time() + token_data['expires_in'] - 300,  # 提前 5 分钟
        }

    def _ensure_token(self) -> Dict:
        """确保 token 有效，必要时刷新（刷新失败则抛出异常）"""
        token = self._load_token()
        if not token:
            raise AuthExpiredError("未授权或 token 文件不存在")

        if token.get('expires_at', 0) < time.time() + 60:
            # token 即将过期，尝试刷新
            try:
                new_token = self._refresh_token(token['refresh_token'])
                self._save_token(new_token)
                return new_token
            except Exception as e:
                raise AuthExpiredError(f"刷新 token 失败: {e}")

        return token

    def is_authorized(self) -> bool:
        """
        检查是否已授权且 token 未过期（仅本地检查，不触发刷新，避免阻塞）
        """
        token = self._load_token()
        if not token:
            return False
        # 如果过期时间在未来（或未设置），认为有效
        if token.get('expires_at', 0) > time.time() + 60:
            return True
        # 过期则返回 False，实际使用时由 _ensure_token 刷新
        return False

    # ---------- 授权流程 ----------
    def start_auth(self) -> Dict:
        """
        启动授权流程，返回授权 URL
        """
        if self.is_authorized():
            return {"success": True, "url": None, "message": "已经授权"}

        # 清除旧 token（避免干扰）
        if self._token_path.exists():
            self._token_path.unlink()

        params = {
            'client_id': self._api_key,
            'response_type': 'code',
            'redirect_uri': 'oob',
            'scope': 'basic netdisk',
        }
        url = AUTHORIZE_URL + '?' + urlencode(params)
        return {"success": True, "url": url, "message": "请访问链接完成授权"}

    def submit_auth_code(self, code: str) -> Dict:
        """
        提交授权码，换取 token 并保存
        """
        params = {
            'grant_type': 'authorization_code',
            'code': code.strip(),
            'client_id': self._api_key,
            'client_secret': self._secret_key,
            'redirect_uri': 'oob',
        }
        try:
            resp = requests.post(TOKEN_URL, data=params, timeout=10)
            resp.raise_for_status()
            token_data = resp.json()
            saved_data = {
                'access_token': token_data['access_token'],
                'refresh_token': token_data['refresh_token'],
                'expires_at': time.time() + token_data['expires_in'] - 300,
            }
            self._save_token(saved_data)

            # 清除缓存的 ByPy 实例（将重新读取新 token）
            self._bp = None
            self._token_data = None

            return {"success": True, "message": "授权成功", "verifying": False}
        except requests.RequestException as e:
            return {"success": False, "message": f"授权失败: {e}", "verifying": False}
        except KeyError as e:
            return {"success": False, "message": f"返回数据缺少字段: {e}", "verifying": False}

    def logout(self):
        """断开连接，删除 token 文件"""
        if self._token_path.exists():
            self._token_path.unlink()
        self._bp = None
        self._token_data = None

    # ---------- 获取 ByPy 实例 ----------
    def _get_bypy(self):
        """延迟创建 ByPy 实例（用于下载和列表）"""
        if self._bp is None:
            if not self.is_authorized():
                raise AuthExpiredError("未授权")
            from bypy import ByPy
            self._bp = ByPy(configdir=str(BYPY_CONFIG_DIR), verbose=0, debug=0)
        return self._bp

    # ---------- 配额信息 ----------
    def get_quota(self) -> Dict:
        """获取配额信息（使用 bypy 的 quota 方法）"""
        bp = self._get_bypy()  # 获取 ByPy 实例（已授权）
        bp.quota()             # 调用 quota，结果存入 bp.jsonq
        
        # 从 jsonq 中取最新一条数据
        if bp.jsonq:
            latest = bp.jsonq[-1]  # 最新一条
            return {
                "total": latest.get("quota", 0),
                "used": latest.get("used", 0),
            }
        return {"total": 0, "used": 0}

    # ---------- 文件列表 ----------
    def list_files(self, remote_path: str = "/") -> List[Dict]:
        """
        列出远程目录内容（使用 bypy.list 并解析其 file_list）
        remote_path: 相对于 /apps/bypy 的路径（以 / 开头）
        """
        # 先确保 token 有效（可能刷新）
        self._ensure_token()
        bp = self._get_bypy()

        # 转换路径：bypy 的 list 参数是相对于 /apps/bypy 的路径，空字符串表示根
        if remote_path == "/":
            bypy_path = ""
        else:
            bypy_path = remote_path.lstrip("/")

        # 调用 bypy.list()，它会将解析结果存入 bp.file_list
        bp.list(bypy_path)  # verbose=0 已设，不会打印

        lines = bp.file_list  # 列表，每个元素形如 'F 文件名 大小 日期 MD5'
        result = []

        # 正则匹配一行：类型(1字符) + 空格 + 文件名(可能含空格) + 空格 + 大小(数字) + 空格 + 日期时间 + 空格 + MD5
        #pattern = re.compile(r'^([FD])\s+(.+?)\s+(\d+)\s+(\d{4}-\d{2}-\d{2},\s+\d{2}:\d{2}:\d{2})\s+(\S+)$')
        pattern = re.compile(r'^([FD])\s+(.+?)\s+(\d+)\s+(\d{4}-\d{2}-\d{2},\s+\d{2}:\d{2}:\d{2})\s*(\S*)$')
        for line in lines:
            m = pattern.match(line)
            if not m:
                continue
            isdir_char, name, size_str, datetime_str, md5 = m.groups()
            is_dir = (isdir_char == 'D')
            size = int(size_str)
            ext = Path(name).suffix.lower()

            # 检查本地是否存在同名文件（仅对文件）
            downloaded = False
            if not is_dir and SKETCH_PACKAGES_DIR is not None:
                local_file = SKETCH_PACKAGES_DIR / name
                if local_file.exists():
                    downloaded = True

            # 构建相对路径
            if remote_path == "/":
                relative_path = "/" + name
            else:
                relative_path = remote_path.rstrip("/") + "/" + name

            result.append({
                'name': name,
                'path': relative_path,
                'isdir': is_dir,
                'size': size,
                'md5': md5,
                'is_allowed': is_dir or ext in ALLOWED_EXTENSIONS,
                'ext': ext,
                'datetime': datetime_str,
                'downloaded': downloaded,          # 新增字段
            })
        return result

    # ---------- 下载文件 ----------
    def download_file(self, remote_path: str, local_filename: str) -> str:
        """
        下载文件到本地图包目录（使用 bypy 的下载功能）
        remote_path: 相对于 /apps/bypy 的路径（以 / 开头）
        local_filename: 不含扩展名的文件名
        """
        if SKETCH_PACKAGES_DIR is None:
            raise RuntimeError("图包目录未设置")

        ext = Path(remote_path).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise ValueError(f"不支持的文件类型: {ext}")

        # 确保扩展名正确
        safe_name = Path(local_filename).stem + ext
        local_path = SKETCH_PACKAGES_DIR / safe_name

        if local_path.exists():
            raise FileExistsError(f"图包 {safe_name} 已存在")

        # 使用 bypy 下载
        bp = self._get_bypy()
        # remote_path 必须不带 /apps/bypy 前缀，且相对路径去掉前导 /
        bypy_remote = remote_path.lstrip("/")
        result = bp.download(bypy_remote, str(local_path))

        if result != 0:  # 非零表示错误
            # 清理可能产生的空文件
            if local_path.exists():
                local_path.unlink()
            raise RuntimeError(f"下载失败，错误码 {result}")

        if local_path.exists() and local_path.stat().st_size > 0:
            return str(local_path)
        else:
            raise RuntimeError("下载完成但文件不存在或为空")
    def upload_package(self, local_path: str, remote_filename: str = None) -> Dict:
        """
        上传本地图包到百度网盘根目录（/apps/bypy）
        - local_path: 相对于图包目录的路径（如 "my.zip"）
        - remote_filename: 云端文件名（可选，默认使用本地文件名）
        - 返回: {'success': bool, 'message': str, 'remote_path': str}
        """
        # 安全检查：禁止路径遍历
        if '..' in local_path or os.path.isabs(local_path):
            return {"success": False, "message": "路径不合法，请使用相对路径"}

        full_path = SKETCH_PACKAGES_DIR / local_path
        print(f'fullpath={full_path}')
        if not full_path.exists():
            return {"success": False, "message": f"本地文件不存在: {full_path}"}

        if not full_path.is_file():
            return {"success": False, "message": "路径不是文件"}

        # 检查扩展名
        ext = full_path.suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            return {"success": False, "message": f"不支持的文件类型: {ext}"}

        # 确定远程文件名
        if remote_filename is None:
            remote_filename = full_path.name
        else:
            # 确保扩展名一致
            if Path(remote_filename).suffix.lower() != ext:
                remote_filename = Path(remote_filename).stem + ext
        
        # 检查云端是否已存在同名文件
        bp = self._get_bypy()
        bp.list("")
        import re
        existing_names = set()
        for line in bp.file_list:
            if line.startswith("F "):
                m = re.match(r'^F\s+(.+?)\s+\d+\s+\d{4}-\d{2}-\d{2}', line)
                if m:
                    existing_names.add(m.group(1))
        if remote_filename in existing_names:
            return {"success": False, "message": f"云端已存在文件: {remote_filename}"}
        print('检查完毕准备上传。。')
        # 执行上传
        try:
            result = bp.upload(str(full_path), remote_filename)
            if result == 0:
                return {
                    "success": True,
                    "message": f"上传成功: {remote_filename}",
                    "remote_path": "/" + remote_filename
                }
            else:
                return {"success": False, "message": f"上传失败，错误码: {result},本地路径：{str(full_path)}"}
        except Exception as e:
            return {"success": False, "message": f"上传异常: {str(e)}"}
    # ---------- 检查授权状态（含详细信息） ----------
    def check_auth_status(self) -> Dict:
        """返回详细授权状态（不阻塞，若 token 过期则标记未授权）"""
        # 只检查本地，不触发刷新
        if not self.is_authorized():
            return {
                "authorized": False,
                "verifying": False,
                "message": "未授权或 token 已过期"
            }
        # 尝试获取配额（可能触发刷新，但这里为了显示信息，允许短时阻塞）
        try:
            quota = self.get_quota()
            return {
                "authorized": True,
                "verifying": False,
                "quota": str(quota['total']),
                "used": str(quota['used']),
                "message": "已授权"
            }
        except AuthExpiredError as e:
            return {
                "authorized": False,
                "verifying": False,
                "quota": "unknown",
                "used": "unknown",
                "message": str(e)
            }
        except Exception as e:
            return {
                "authorized": True,
                "verifying": False,
                "quota": "unknown",
                "used": "unknown",
                "message": f"获取容量失败: {e}"
            }
    