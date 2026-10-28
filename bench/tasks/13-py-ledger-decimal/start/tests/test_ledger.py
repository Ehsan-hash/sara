import unittest
from datetime import date

from ledger import Book, money, parse_line


class LedgerTest(unittest.TestCase):
    def test_parse(self):
        day, kind, amount = parse_line("2026-01-05, Deposit, 100.10")
        self.assertEqual((day, kind), (date(2026, 1, 5), "deposit"))

    def test_balance(self):
        book = Book().load("2026-01-01, deposit, 100\n2026-01-02, withdraw, 30\n")
        self.assertEqual(money(book.balance), "70.00")


if __name__ == "__main__":
    unittest.main()
