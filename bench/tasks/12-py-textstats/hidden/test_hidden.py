import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from textstats import summary, tokenize, top_words, word_counts  # noqa: E402


class Hidden(unittest.TestCase):
    def test_tokenize_rules(self):
        self.assertEqual(
            tokenize("Don't stop—rock'n'roll! 'Quoted' well-known café 42"),
            ["don't", "stop", "rock'n'roll", "quoted", "well", "known", "café", "42"],
        )
        self.assertEqual(tokenize("It’s snake_case, ok?"), ["it's", "snake", "case", "ok"])
        self.assertEqual(tokenize("  "), [])

    def test_counts(self):
        self.assertEqual(word_counts("Hi, hi! HI.")["hi"], 3)

    def test_top_words(self):
        self.assertEqual(top_words("b a b c a b", 2), [("b", 3), ("a", 2)])
        self.assertEqual(top_words("x y z y x", 3), [("x", 2), ("y", 2), ("z", 1)])
        self.assertEqual(top_words("one"), [("one", 1)])

    def test_stopwords(self):
        self.assertEqual(top_words("The cat and the hat", 5, stopwords={"THE", "and"}), [("cat", 1), ("hat", 1)])

    def test_summary(self):
        self.assertEqual(
            summary("one two two three three three"),
            {"words": 6, "unique": 3, "top": [("three", 3), ("two", 2), ("one", 1)], "avg_word_length": 4.0},
        )
        self.assertEqual(summary("I am here."), {"words": 3, "unique": 3, "top": [("am", 1), ("here", 1), ("i", 1)], "avg_word_length": 2.33})

    def test_empty_summary(self):
        self.assertEqual(summary(""), {"words": 0, "unique": 0, "top": [], "avg_word_length": 0.0})


if __name__ == "__main__":
    unittest.main()
