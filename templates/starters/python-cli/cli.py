#!/usr/bin/env python3
"""__PROJECT_NAME__: count lines, words and characters from files or standard input."""

import argparse
import json
import sys

from lib import count, top_words


def make_parser():
    parser = argparse.ArgumentParser(
        description="Count lines, words and characters. Reads standard input when no file is given."
    )
    parser.add_argument("--top", type=int, help="also list the n most common words")
    parser.add_argument("--json", action="store_true", help="print JSON instead of text")
    parser.add_argument("-v", "--version", action="version", version="0.1.0")
    parser.add_argument("files", nargs="*", help="input files")
    return parser


def main(argv=None):
    parser = make_parser()
    args = parser.parse_args(argv)
    if args.top is not None and args.top < 0:
        parser.error("--top needs a whole number")

    inputs = []
    try:
        if args.files:
            for filename in args.files:
                with open(filename, encoding="utf-8") as source:
                    inputs.append({"file": filename, "text": source.read()})
        else:
            inputs.append({"file": "-", "text": sys.stdin.read()})
    except OSError as error:
        name = getattr(error, "filename", None) or "input"
        detail = "no such file" if getattr(error, "errno", None) == 2 else str(error)
        print(f"Can't read {name}: {detail}", file=sys.stderr)
        return 1

    results = []
    for item in inputs:
        result = {"file": item["file"], **count(item["text"])}
        if args.top:
            result["top"] = top_words(item["text"], args.top)
        results.append(result)

    if args.json:
        print(json.dumps(results[0] if len(results) == 1 else results, indent=2))
    else:
        for result in results:
            print(f'{result["lines"]}\t{result["words"]}\t{result["chars"]}\t{result["file"]}')
            for word in result.get("top", []):
                print(f'  {word["times"]}\t{word["word"]}')
    return 0


if __name__ == "__main__":
    sys.exit(main())
