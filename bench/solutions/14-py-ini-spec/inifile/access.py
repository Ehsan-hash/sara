_TRUE = {"1", "yes", "true", "on"}
_FALSE = {"0", "no", "false", "off"}


def get(cfg, path, default=None):
    section, _, key = path.rpartition(".")
    return cfg.get(section, {}).get(key.lower(), default)


def get_bool(cfg, path, default=None):
    value = get(cfg, path)
    if value is None:
        return default
    v = value.strip().lower()
    if v in _TRUE:
        return True
    if v in _FALSE:
        return False
    raise ValueError(f"{path}: not a yes/no value: {value!r}")


def get_int(cfg, path, default=None):
    value = get(cfg, path)
    return default if value is None else int(value)
