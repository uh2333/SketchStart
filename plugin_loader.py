"""
plugin_loader.py —— 插件加载器
扫描 plugins/ 目录下的 manifest.json，提供插件元数据
并自动加载每个插件的后端路由（文件名由 manifest.json 中的 "backend" 字段指定）

修改说明：
- 将插件目录动态加入 sys.path，解决打包后找不到插件的问题
- 使用 importlib.import_module 替代 spec_from_file_location
- 支持插件内部的相对导入和跨文件依赖
"""

import os
import json
import sys
import importlib
from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

router = APIRouter()

# 插件目录由外部传入（main.py 调用 load_plugins 时传入）
_plugins_dir = None

def load_plugins(app, plugin_dir: str):
    """
    扫描插件目录，注册静态文件路由，并加载各插件的后端路由。
    
    Args:
        app: FastAPI 应用实例
        plugin_dir: 插件根目录路径（字符串或 Path 对象），由 main.py 传入
    """
    global _plugins_dir
    _plugins_dir = str(plugin_dir)
    
    plugin_path = Path(plugin_dir)
    if not plugin_path.exists():
        plugin_path.mkdir(parents=True, exist_ok=True)
        return
    
    if not plugin_path.is_dir():
        return
    
    # ========== 关键改动：将插件目录加入 sys.path ==========
    if str(plugin_path) not in sys.path:
        sys.path.insert(0, str(plugin_path))
        print(f"[Plugin] 已添加插件目录到 sys.path: {plugin_path}")
    # ========================================================
    
    # 为每个插件目录挂载静态文件路由，并尝试加载后端
    for name in os.listdir(plugin_dir):
        full_path = os.path.join(plugin_dir, name)
        if not os.path.isdir(full_path):
            continue
        
        manifest_path = os.path.join(full_path, "manifest.json")
        if not os.path.exists(manifest_path):
            continue
        
        # 读取 manifest.json 获取 backend 字段
        manifest = None
        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
        except Exception as e:
            print(f"[Plugin] 读取 {name} 的 manifest.json 失败: {e}")
            continue
        
        # 获取后端文件名，默认为 "backend.py"
        backend_filename = manifest.get("backend", "backend.py")
        if not backend_filename:
            backend_filename = "backend.py"
        
        # 1. 挂载静态文件
        try:
            app.mount(f"/plugins/{name}", StaticFiles(directory=full_path), name=f"plugin_{name}")
            print(f"[Plugin] 已挂载静态资源: {name}")
        except Exception as e:
            print(f"[Plugin] 挂载插件 {name} 静态资源失败: {e}")
        
        # ========== 关键改动：使用标准 import 方式加载 ==========
        backend_file = os.path.join(full_path, backend_filename)
        if os.path.exists(backend_file):
            try:
                # 移除 .py 后缀，得到模块名
                module_name = backend_filename.replace('.py', '')
                # 使用 import_module 导入（此时插件目录已在 sys.path 中）
                # 模块路径格式：插件名.模块名（如 "my_plugin.backend"）
                module = importlib.import_module(f"{name}.{module_name}")
                
                if hasattr(module, "router"):
                    app.include_router(module.router)
                    print(f"[Plugin] 已加载后端路由: {name} (文件: {backend_filename})")
                else:
                    print(f"[Plugin] {name} 的 {backend_filename} 缺少 router 对象，跳过")
            except Exception as e:
                print(f"[Plugin] 加载 {name} 后端失败 (文件: {backend_filename}): {e}")
        else:
            print(f"[Plugin] {name} 的后端文件不存在: {backend_filename}，跳过")

def get_plugins_list():
    """获取所有可用插件列表"""
    plugins = []
    if _plugins_dir is None or not os.path.isdir(_plugins_dir):
        return plugins
    
    for name in os.listdir(_plugins_dir):
        manifest_path = os.path.join(_plugins_dir, name, "manifest.json")
        if os.path.exists(manifest_path):
            try:
                with open(manifest_path, 'r', encoding='utf-8') as f:
                    manifest = json.load(f)
                manifest['id'] = name
                plugins.append(manifest)
            except Exception as e:
                print(f"[Plugin] 读取 manifest {name} 失败: {e}")
    
    return plugins

@router.get("/api/plugins/list")
async def list_plugins():
    """返回所有可用插件列表"""
    return {"plugins": get_plugins_list()}

@router.get("/api/plugins/{plugin_id}/{path:path}")
async def serve_plugin_file(plugin_id: str, path: str):
    """提供插件文件访问"""
    if _plugins_dir is None:
        return JSONResponse(status_code=500, content={"detail": "插件目录未初始化"})
    file_path = os.path.join(_plugins_dir, plugin_id, path)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    return JSONResponse(status_code=404, content={"detail": "文件不存在"})

if __name__ == '__main__':
    # 测试时需要手动设置 _plugins_dir
    _plugins_dir = "plugins"
    print(get_plugins_list())