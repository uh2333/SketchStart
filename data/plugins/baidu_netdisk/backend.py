"""
backend.py —— 百度网盘插件后端
插件路径: data/plugins/baidu_netdisk

参照 color 插件模式：
router = APIRouter(prefix="/api/plugins/baidu_netdisk", tags=["baidu-netdisk"])
"""

import os
import sys
from pathlib import Path

# 将插件目录加入 sys.path（用于动态加载时能找到 bypy_manager）
_plugin_dir = Path(__file__).parent.resolve()
if str(_plugin_dir) not in sys.path:
    sys.path.insert(0, str(_plugin_dir))

if str(_plugin_dir.parent) not in sys.path:
    sys.path.insert(0, str(_plugin_dir.parent))

# 导入 bypy_manager（同级目录）
from bypy_manager import BypyManager, set_paths, AuthExpiredError, ALLOWED_EXTENSIONS

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel


# ========== 路由 ==========
# 参照 color 插件：prefix="/api/plugins/color"
router = APIRouter(prefix="/api/plugins/baidu_netdisk", tags=["baidu-netdisk"])

@router.get("/static/style.css")
async def get_plugin_css():
    """返回插件自己的样式文件"""
    css_path = Path(__file__).parent / "style.css"
    if not css_path.exists():
        raise HTTPException(status_code=404, detail="style.css not found")
    return FileResponse(css_path, media_type="text/css")

# ========== 延迟初始化 ==========
_bypy = None
_packages_dir = None
_init_done = False

def _init():
    global _bypy, _packages_dir, _init_done
    if _init_done:
        return

    try:
        plugin_dir = Path(__file__).parent
        base_dir = plugin_dir.parent.parent.parent
        _packages_dir = base_dir / "data" / "sketch_packages"

        set_paths(str(_packages_dir), str(plugin_dir))
        _bypy = BypyManager()
        _init_done = True
    except Exception as e:
        print(f"[BaiduNetdisk] 初始化失败: {e}")
        raise


# ========== 数据模型 ==========
class AuthStatusResponse(BaseModel):
    authorized: bool
    verifying: bool = False
    user_name: str = None
    quota: str = None
    used: str = None
    message: str = ""


class AuthUrlResponse(BaseModel):
    success: bool
    url: str = None
    message: str


class AuthCodeRequest(BaseModel):
    code: str


class AuthCodeResponse(BaseModel):
    success: bool
    message: str
    verifying: bool = False


class FileListRequest(BaseModel):
    path: str = "/"


class FileItem(BaseModel):
    name: str
    path: str
    isdir: bool
    size: int = 0
    md5: str = ""
    is_allowed: bool = True
    ext: str = ""
    downloaded: bool = False 


class FileListResponse(BaseModel):
    list: list[FileItem]
    current_path: str = "/"


class DownloadRequest(BaseModel):
    remote_path: str
    package_name: str


class DownloadResponse(BaseModel):
    success: bool
    message: str
    local_path: str = None


# ========== API 路由 ==========

@router.get("/auth/status")
async def auth_status():
    """检查授权状态（用于前端轮询）"""
    try:
        _init()
        status = _bypy.check_auth_status()
        return AuthStatusResponse(**status)
    except Exception as e:
        print(f"[BaiduNetdisk] auth_status error: {e}")
        return AuthStatusResponse(authorized=False, verifying=False, message=str(e))


@router.post("/auth/start", response_model=AuthUrlResponse)
async def start_auth():
    """步骤1：启动授权流程，返回授权 URL"""
    try:
        _init()
        result = _bypy.start_auth()
        return AuthUrlResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/auth/code", response_model=AuthCodeResponse)
async def submit_auth_code(request: AuthCodeRequest):
    """步骤2：提交授权码，后台异步验证"""
    try:
        _init()
        result = _bypy.submit_auth_code(request.code.strip())
        return AuthCodeResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/auth/disconnect")
async def disconnect():
    """断开连接"""
    try:
        _init()
        _bypy.logout()
        return {"success": True, "message": "已断开连接"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/files")
async def list_files(request: FileListRequest):
    """列出网盘文件"""
    try:
        _init()

        if not _bypy.is_authorized():
            raise HTTPException(status_code=401, detail="未授权")

        files = _bypy.list_files(request.path)
        return FileListResponse(
            list=[FileItem(**f) for f in files],
            current_path=request.path
        )
    except AuthExpiredError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取文件列表失败: {str(e)}")

class UploadRequest(BaseModel):
    local_path: str
    remote_filename: str = None

@router.post("/upload")
async def upload_package(request: UploadRequest):
    """上传本地图包到百度网盘"""
    try:
        _init()
        if not _bypy.is_authorized():
            raise HTTPException(status_code=401, detail="未授权")
        
        # # 安全验证：确保 local_path 在合法目录内（图包目录）
        # if not os.path.exists(request.local_path):
        #     raise HTTPException(status_code=404, detail="本地文件不存在")
        
        # # 检查是否在图包目录下（防止任意文件上传）
        # abs_path = os.path.abspath(request.local_path)
        # if not abs_path.startswith(str(_packages_dir)):
        #     raise HTTPException(status_code=403, detail="只能上传图包目录中的文件")
        
        result = _bypy.upload_package(request.local_path, request.remote_filename)
        if result["success"]:
            return {"success": True, "message": result["message"], "remote_path": result["remote_path"]}
        else:
            raise HTTPException(status_code=400, detail=result["message"])
    except AuthExpiredError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(request.local_path)
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")
    
@router.post("/download")
async def download_file(request: DownloadRequest):
    """下载文件到本地图包目录"""
    try:
        _init()

        if not _bypy.is_authorized():
            raise HTTPException(status_code=401, detail="未授权")

        ext = Path(request.remote_path).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}")

        safe_name = Path(request.package_name).stem + ext
        local_path = _packages_dir / safe_name
        if local_path.exists():
            raise HTTPException(status_code=400, detail=f"图包 {safe_name} 已存在")

        result_path = _bypy.download_file(request.remote_path, request.package_name)

        return DownloadResponse(
            success=True,
            message="下载完成",
            local_path=result_path
        )

    except AuthExpiredError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except FileExistsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"下载失败: {str(e)}")