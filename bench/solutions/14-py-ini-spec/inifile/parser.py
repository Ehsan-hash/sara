import re

_INLINE_COMMENT = re.compile(r"\s[;#].*$")
_KEY_VALUE = re.compile(r"([^=:]+?)\s*[=:](.*)$")


class ParseError(ValueError):
    pass


def _value(text):
    return _INLINE_COMMENT.sub("", text).strip()


def parse(text):
    data = {"": {}}
    section = ""
    last = None  # (section, key) that a continuation line adds to
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line:
            last = None
            continue
        if line[0] in ";#":
            continue
        if raw[0] in " \t" and last is not None:
            sec, key = last
            data[sec][key] += "\n" + _value(line)
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip()
            data.setdefault(section, {})
            last = None
            continue
        m = _KEY_VALUE.match(line)
        if m:
            key = m.group(1).strip().lower()
            data[section][key] = _value(m.group(2))
            last = (section, key)
            continue
        raise ParseError(f"line {n}: cannot read {raw!r}")
    return data
