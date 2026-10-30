"""Pure functions for the command-line tool."""

from collections import Counter
import re


def count(text):
    """Count lines, words and characters in text, like ``wc``."""
    lines = 0 if text == "" else len(text.splitlines())
    words = len(re.findall(r"\S+", text))
    return {"lines": lines, "words": words, "chars": len(text)}


def top_words(text, n=5):
    """Return the most common words, lower case and letters first."""
    words = re.findall(r"[^\W\d_][\w'-]*", text.lower(), flags=re.UNICODE)
    counts = Counter(words)
    return [{"word": word, "times": times} for word, times in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:n]]
