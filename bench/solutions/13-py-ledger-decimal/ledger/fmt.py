from decimal import ROUND_HALF_UP, Decimal


def money(x):
    return f"{Decimal(x).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):,.2f}"
