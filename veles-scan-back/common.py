from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


PIPELINE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT_DIR = PIPELINE_DIR.parent
DEFAULT_ROOT_ENV_FILE = PROJECT_ROOT_DIR / ".env"


def _resolve_env_file() -> Path:
    explicit = os.getenv("PIPELINE_ENV_FILE", "").strip()
    if explicit:
        return Path(explicit).expanduser()
    local = PIPELINE_DIR / ".env"
    if local.exists():
        return local
    return DEFAULT_ROOT_ENV_FILE


PIPELINE_ENV_FILE = _resolve_env_file()
ARTIFACTS_DIR = Path(os.getenv("PIPELINE_ARTIFACTS_DIR", str(PIPELINE_DIR / "artifacts")))
CHECKO_RUNTIME_CONFIG_FILE = PIPELINE_DIR / "checko_runtime_config.py"
CHECKO_RAW_DIR = ARTIFACTS_DIR / "checko_raw"


def ensure_artifacts_dirs() -> None:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    CHECKO_RAW_DIR.mkdir(parents=True, exist_ok=True)


def run_python(script_path: Path, *args: str, cwd: Path | None = None) -> None:
    cmd = [sys.executable, str(script_path), *args]
    print(f"[RUN] {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def require_file(path: Path) -> Path:
    if not path.exists():
        raise FileNotFoundError(f"Required file not found: {path}")
    return path


def _read_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        values[key] = value
    return values


def ensure_checko_config() -> None:
    require_file(CHECKO_RUNTIME_CONFIG_FILE)
    content = CHECKO_RUNTIME_CONFIG_FILE.read_text(encoding="utf-8", errors="ignore")
    if "USER_AGENTS_PROXY_LIST" not in content:
        raise ValueError(
            f"Config {CHECKO_RUNTIME_CONFIG_FILE} does not contain USER_AGENTS_PROXY_LIST."
        )


def ensure_infoscraper_env(
    require_openai: bool = False,
) -> None:
    local_env: dict[str, str] = {}
    if PIPELINE_ENV_FILE.exists():
        local_env = _read_env_file(PIPELINE_ENV_FILE)
    effective_key = local_env.get("OPENAI_API_KEY", "") or os.getenv("OPENAI_API_KEY", "")
    if require_openai and not str(effective_key).strip():
        raise ValueError(f"{PIPELINE_ENV_FILE} or environment missing OPENAI_API_KEY.")


def get_env_var(name: str, default: str | None = None) -> str | None:
    if name in os.environ:
        return os.getenv(name, default)
    if PIPELINE_ENV_FILE.exists():
        values = _read_env_file(PIPELINE_ENV_FILE)
        return values.get(name, default)
    return default
