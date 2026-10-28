import os
import sys
import unittest
from datetime import date
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ledger import Book, InsufficientFunds, money, parse_line  # noqa: E402


class Hidden(unittest.TestCase):
    def test_parse_gives_decimal(self):
        self.assertEqual(parse_line("2026-01-05, deposit, 100.10"), (date(2026, 1, 5), "deposit", Decimal("100.10")))
        self.assertIsInstance(parse_line("2026-01-05, deposit, 3")[2], Decimal)
        self.assertIsNone(parse_line("   "))
        self.assertIsNone(parse_line("# a comment"))

    def test_exact_sums(self):
        book = Book().load("2026-01-01, deposit, 0.10\n2026-01-02, deposit, 0.20\n")
        self.assertIsInstance(book.balance, Decimal)
        self.assertEqual(book.balance, Decimal("0.30"))
        many = Book().load("\n".join("2026-01-01, deposit, 0.01" for _ in range(1000)))
        self.assertEqual(many.balance, Decimal("10.00"))

    def test_interest_rounds_half_up(self):
        book = Book().load("2026-01-01, deposit, 53.50\n2026-02-01, interest, 5\n")
        self.assertEqual(book.history[-1][2], Decimal("2.68"))
        self.assertEqual(book.balance, Decimal("56.18"))
        for _, _, change, after in book.history:
            self.assertIsInstance(change, Decimal)
            self.assertIsInstance(after, Decimal)

    def test_withdraw_too_much(self):
        book = Book().load("2026-01-01, deposit, 10\n")
        with self.assertRaises(InsufficientFunds):
            book.apply(date(2026, 1, 2), "withdraw", Decimal("10.01"))
        self.assertEqual(book.balance, Decimal("10"))
        self.assertEqual(len(book.history), 1)
        book.apply(date(2026, 1, 3), "withdraw", Decimal("10"))
        self.assertEqual(book.balance, Decimal("0"))

    def test_fee_may_overdraw(self):
        book = Book().load("2026-01-01, deposit, 5\n2026-01-31, fee, 7.50\n")
        self.assertEqual(book.balance, Decimal("-2.50"))
        self.assertEqual(money(book.balance), "-2.50")

    def test_unknown_kind(self):
        with self.assertRaises(ValueError):
            Book().load("2026-01-01, gift, 5\n")

    def test_money(self):
        self.assertEqual(money(Decimal("1234.5")), "1,234.50")
        self.assertEqual(money(Decimal("1000000")), "1,000,000.00")


if __name__ == "__main__":
    unittest.main()
