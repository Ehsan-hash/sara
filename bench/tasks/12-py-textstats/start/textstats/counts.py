from collections import Counter

from .tokenize import tokenize


def word_counts(text):
    return Counter(tokenize(text))
