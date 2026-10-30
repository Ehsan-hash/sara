import unittest

from lib import count, top_words


class CountTests(unittest.TestCase):
    def test_count(self):
        self.assertEqual(count("hello world\nhello\n"), {"lines": 2, "words": 3, "chars": 18})

    def test_empty_text(self):
        self.assertEqual(count(""), {"lines": 0, "words": 0, "chars": 0})


class TopWordsTests(unittest.TestCase):
    def test_top_words(self):
        self.assertEqual(top_words("Red blue red green red blue", 2), [
            {"word": "red", "times": 3},
            {"word": "blue", "times": 2},
        ])


if __name__ == "__main__":
    unittest.main()
