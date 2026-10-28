class ParseError(ValueError):
    pass


def parse(text):
    data = {"": {}}
    section = ""
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip()
            data.setdefault(section, {})
            continue
        if "=" in line:
            key, value = line.split("=", 1)
            data[section][key.strip()] = value.strip()
            continue
        raise ParseError(f"line {n}: cannot read {raw!r}")
    return data
