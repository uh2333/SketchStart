"""
sketch_image_transform 后端
仅负责预设的读写
"""

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


router = APIRouter(prefix="/api/plugins/image_transform", tags=["image_transform"])


class PresetData(BaseModel):
    presets: list
    updatedAt: Optional[int] = None


@router.post("/presets")
async def save_presets(data: PresetData):
    """保存预设到插件目录"""
    try:
        presets_file = Path(__file__).parent / "presets.json"
        with open(presets_file, 'w', encoding='utf-8') as f:
            json.dump(data.dict(), f, ensure_ascii=False, indent=2)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存预设失败: {str(e)}")


@router.get("/presets")
async def load_presets():
    """加载预设"""
    try:
        presets_file = Path(__file__).parent / "presets.json"
        if not presets_file.exists():
            return {"presets": []}
        with open(presets_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"加载预设失败: {str(e)}")