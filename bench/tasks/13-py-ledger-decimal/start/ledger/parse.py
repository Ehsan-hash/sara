from datetime import date


def parse_line(line):
    """'2026-01-05, deposit, 100.10' -> (date(2026, 1, 5), 'deposit', 100.1)."""
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    day, kind, amount = [p.strip() for p in line.split(",")]
    return date.fromisoformat(day), kind.lower(), float(amount)
