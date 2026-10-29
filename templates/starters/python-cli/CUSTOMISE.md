# Notes for customising (for the assistant)

- Put the real work in `lib.py` as pure functions with tests; keep `cli.py` to options, input and
  output.
- Update the argparse help text whenever an option changes, and keep the exit codes (0 ok, 1
  runtime problem, 2 bad usage).
- Use only Python's standard library unless the owner asks for a package.
- Run `python3 -m unittest` after every change (on Windows, use `python -m unittest`).
