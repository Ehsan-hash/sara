from collections import Counter

from .tokenize import tokenize


def word_counts(text):
    return Counter(tokenize(text))


def top_words(text, n=10, stopwords=None):
    skip = {w.lower() for w in (stopwords or ())}
    counts = [(w, c) for w, c in word_counts(text).items() if w not in skip]
    return sorted(counts, key=lambda wc: (-wc[1], wc[0]))[:n]


def summary(text):
    words = tokenize(text)
    return {
        "words": len(words),
        "unique": len(set(words)),
        "top": top_words(text, 3),
        "avg_word_length": round(sum(len(w) for w in words) / len(words), 2) if words else 0.0,
    }
