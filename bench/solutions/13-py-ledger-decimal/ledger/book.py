from decimal import ROUND_HALF_UP, Decimal

from .parse import parse_line

CENT = Decimal("0.01")


class InsufficientFunds(Exception):
    pass


class Book:
    def __init__(self):
        self.balance = Decimal("0")
        self.history = []

    def apply(self, day, kind, amount):
        amount = Decimal(amount)
        if kind == "deposit":
            change = amount
        elif kind == "withdraw":
            if amount > self.balance:
                raise InsufficientFunds(f"{day}: need {amount}, have {self.balance}")
            change = -amount
        elif kind == "fee":
            change = -amount
        elif kind == "interest":
            change = (self.balance * amount / 100).quantize(CENT, rounding=ROUND_HALF_UP)
        else:
            raise ValueError(f"unknown kind: {kind}")
        self.balance += change
        self.history.append((day, kind, change, self.balance))

    def load(self, text):
        for line in text.splitlines():
            entry = parse_line(line)
            if entry:
                self.apply(*entry)
        return self
