import unittest

from textstats import tokenize, word_counts


class TokenizeTest(unittest.TestCase):
    def test_simple(self):
        self.assertEqual(tokenize("The cat sat"), ["the", "cat", "sat"])

    def test_counts(self):
        self.assertEqual(word_counts("a b a")["a"], 2)


if __name__ == "__main__":
    unittest.main()
