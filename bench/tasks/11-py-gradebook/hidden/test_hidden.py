import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gradebook.grades import letter, weighted_average  # noqa: E402
from gradebook.report import rank  # noqa: E402


class Hidden(unittest.TestCase):
    def test_weighted(self):
        self.assertAlmostEqual(weighted_average([90, 80], [3, 1]), 87.5)
        self.assertAlmostEqual(weighted_average([100, 50, 0], [1, 2, 1]), 50.0)

    def test_missing_counts_as_zero(self):
        self.assertAlmostEqual(weighted_average([None, 100], [1, 1]), 50.0)

    def test_letters(self):
        self.assertEqual(letter(90), "A")
        self.assertEqual(letter(89.99), "B")
        self.assertEqual(letter(80), "B")
        self.assertEqual(letter(70), "C")
        self.assertEqual(letter(60), "D")
        self.assertEqual(letter(59.9), "F")

    def test_shared_places(self):
        students = {"Dee": [95, 85], "Cy": [70, 70], "Ben": [80, 100], "Ana": [90, 90], "Eve": [65, 66]}
        self.assertEqual(
            rank(students, [1, 1]),
            [(1, "Ana", 90.0, "A"), (1, "Ben", 90.0, "A"), (1, "Dee", 90.0, "A"), (4, "Cy", 70.0, "C"), (5, "Eve", 65.5, "D")],
        )

    def test_weighted_rank(self):
        students = {"Zoe": [100, 70], "Al": [80, 100], "Mo": [60, 60], "Ty": [None, 90]}
        self.assertEqual(
            rank(students, [2, 1]),
            [(1, "Zoe", 90.0, "A"), (2, "Al", 86.7, "B"), (3, "Mo", 60.0, "D"), (4, "Ty", 30.0, "F")],
        )

    def test_tie_after_rounding(self):
        students = {"B": [70, 80, 90], "A": [80, 80, 80.000001]}
        out = rank(students, [1, 1, 1])
        self.assertEqual([(p, n) for p, n, _, _ in out], [(1, "A"), (1, "B")])


if __name__ == "__main__":
    unittest.main()
