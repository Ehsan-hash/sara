from .parse import parse_line


class InsufficientFunds(Exception):
    pass


class Book:
    def __init__(self):
        self.balance = 0.0
        self.history = []

    def apply(self, day, kind, amount):
        if kind == "deposit":
            change = amount
        elif kind in ("withdraw", "fee"):
            if amount > self.balance:
                raise InsufficientFunds(f"{day}: need {amount}, have {self.balance}")
            change = -amount
        elif kind == "interest":
            change = round(self.balance * amount / 100, 2)
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
