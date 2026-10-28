def get(cfg, path, default=None):
    section, key = path.split(".")
    return cfg.get(section, {}).get(key, default)


def get_bool(cfg, path, default=None):
    value = get(cfg, path)
    if value is None:
        return default
    return value == "true"


def get_int(cfg, path, default=None):
    value = get(cfg, path)
    return default if value is None else int(value)
