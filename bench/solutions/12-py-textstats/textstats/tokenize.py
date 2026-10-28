import re

_WORD = re.compile(r"[^\W_]+(?:'[^\W_]+)*")


def tokenize(text):
    """The words of a text, lowercased (rules in README.md)."""
    return _WORD.findall(text.replace("\u2019", "'").lower())
