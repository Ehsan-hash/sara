import unittest

from gradebook import rank, weighted_average


class GradesTest(unittest.TestCase):
    def test_equal_weights(self):
        self.assertEqual(weighted_average([80, 90], [1, 1]), 85)

    def test_weights(self):
        self.assertEqual(weighted_average([90, 80], [3, 1]), 87.5)

    def test_rank(self):
        self.assertEqual(rank({"Ana": [95, 95], "Ben": [75, 75]}, [1, 1]), [(1, "Ana", 95.0, "A"), (2, "Ben", 75.0, "C")])


if __name__ == "__main__":
    unittest.main()
