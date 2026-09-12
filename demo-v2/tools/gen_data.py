"""Совместимая точка входа: импорт реального архива вместо синтетических данных."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).resolve().parents[2]/'tools/import_social_objects.py'),run_name='__main__')
