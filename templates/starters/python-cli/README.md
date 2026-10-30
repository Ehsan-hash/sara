# __PROJECT_NAME__

A command-line tool in plain Python (standard library only). It counts lines, words and
characters from files or standard input and can list the most common words. Use it as the
starting point for your own tool: argument parsing, help text, exit codes, JSON output and tests
are already there.

## Use it

```sh
python3 cli.py notes.txt
python3 cli.py --top 5 --json notes.txt
cat notes.txt | python3 cli.py
```

On Windows, use `python` instead of `python3` in these commands.

## Test it

```sh
python3 -m unittest
```

On Windows, run `python -m unittest`.

## Files

- `cli.py`: `argparse` options, help, exit codes, and reading files or standard input.
- `lib.py`: the actual work as pure functions.
- `test_lib.py`: standard-library `unittest` coverage for the pure functions.
