# inifile

Reads settings files. The format and the helpers are described in [SPEC.md](SPEC.md).

```python
from inifile import parse, get, get_bool, get_int
cfg = parse(open("app.ini").read())
get_int(cfg, "server.port", 80)
```

Run the tests with `python -m unittest discover -s tests`.
