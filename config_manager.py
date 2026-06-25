"""
config_manager.py —— 配置读写层
负责读取和保存用户设置（主题、开关、默认练习参数、root_dir）。
配置文件默认存放在程序根目录下的 config.json 中。
若文件不存在，会自动用默认值创建。

修改说明：
- CONFIG_PATH 改为基于程序根目录的绝对路径
- 默认 root_dir 使用程序根目录，支持 exe 打包环境
- 新增 get_base_dir() 供外部模块获取程序根目录
"""

import json
import os
import sys
from pathlib import Path


def _get_base_dir():
    """
    获取 exe 或脚本所在目录（即程序根目录）。
    - 打包后：返回 exe 所在目录
    - 开发环境：返回当前脚本所在目录
    """
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    else:
        return os.path.dirname(os.path.abspath(__file__))


# 程序根目录（配置和数据文件的基准路径）
BASE_DIR = Path(_get_base_dir())

# 配置文件路径：固定放在程序根目录下
CONFIG_PATH = str(BASE_DIR / "config.json")

# 默认配置字典
DEFAULT_CONFIG = {
    "lan_enabled": False,
    "ai_enabled": False,
    "theme": "light",
    "default_count": 5,
    "default_interval": 60,
    "root_dir": str(BASE_DIR)  # 默认使用程序根目录
}


def load_config():
    """
    从 config.json 读取配置并返回字典。
    如果文件不存在，则自动创建并写入默认配置。
    """
    if not os.path.exists(CONFIG_PATH):
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)
    return config


def save_config(config_dict):
    """
    将传入的配置字典写入 config.json 文件。
    参数 config_dict 应包含所有必要的键。
    """
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config_dict, f, indent=2, ensure_ascii=False)


def get_base_dir():
    """返回程序根目录的 Path 对象（供外部模块使用）"""
    return BASE_DIR


def get_config_path():
    """返回配置文件路径（供外部模块使用）"""
    return CONFIG_PATH