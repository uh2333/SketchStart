"""
sketch_color_adjust 后端
仅负责预设的读写
"""

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# ========== 动态获取插件 ID ==========
_current_dir = Path(__file__).parent
_manifest_path = _current_dir / "manifest.json"
if _manifest_path.exists():
    with open(_manifest_path, 'r', encoding='utf-8') as f:
        _manifest = json.load(f)
    _plugin_id = _manifest.get("id", _current_dir.name)
else:
    _plugin_id = _current_dir.name

router = APIRouter(prefix=f"/api/plugins/{_plugin_id}", tags=[_plugin_id])
# =====================================


class PresetData(BaseModel):
    presets: list
    updatedAt: Optional[int] = None


@router.post("/presets")
async def save_presets(data: PresetData):
    """保存预设到插件目录"""
    try:
        print('color插件保存中。。。')
        presets_file = _current_dir / "presets.json"
        with open(presets_file, 'w', encoding='utf-8') as f:
            json.dump(data.dict(), f, ensure_ascii=False, indent=2)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存预设失败: {str(e)}")


@router.get("/presets")
async def load_presets():
    """加载预设"""
    try:
        presets_file = _current_dir / "presets.json"
        if not presets_file.exists():
            return {"presets": []}
        with open(presets_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"加载预设失败: {str(e)}")