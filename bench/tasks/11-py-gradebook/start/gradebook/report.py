from .grades import letter, weighted_average


def rank(students, weights):
    """students: dict name -> list of scores. Returns a list of (place, name, average, letter)."""
    rows = sorted(((weighted_average(s, weights), n) for n, s in students.items()), reverse=True)
    out = []
    for i, (avg, name) in enumerate(rows):
        out.append((i + 1, name, round(avg, 1), letter(avg)))
    return out
