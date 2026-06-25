"""
plugin-manager 后端
负责插件管理器配置（disabled_plugins 等）的读写
"""

import json
from pathlib import Path
from typing import List, Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# 动态获取插件 ID（与 manifest.json 保持一致）
_current_dir = Path(__file__).parent
_manifest_path = _current_dir / "manifest.json"
if _manifest_path.exists():
    with open(_manifest_path, 'r', encoding='utf-8') as f:
        _manifest = json.load(f)
    _plugin_id = _manifest.get("id", _current_dir.name)
else:
    _plugin_id = _current_dir.name

router = APIRouter(prefix=f"/api/plugins/{_plugin_id}", tags=[_plugin_id])


class ConfigData(BaseModel):
    disabled_plugins: List[str] = []
    plugin_settings: Dict[str, Any] = {}


@router.get("/config")
async def load_config():
    """加载插件管理器配置"""
    try:
        config_file = _current_dir / "config.json"
        if not config_file.exists():
            return {"disabled_plugins": [], "plugin_settings": {}}
        with open(config_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"加载配置失败: {str(e)}")


@router.post("/config")
async def save_config(data: ConfigData):
    """保存插件管理器配置"""
    try:
        config_file = _current_dir / "config.json"
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(data.dict(), f, ensure_ascii=False, indent=2)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存配置失败: {str(e)}")