from .grades import letter, weighted_average


def rank(students, weights):
    """students: dict name -> list of scores. Returns a list of (place, name, average, letter)."""
    rows = sorted(((weighted_average(s, weights), n) for n, s in students.items()), key=lambda r: (-round(r[0], 2), r[1]))
    out = []
    place = 0
    previous = None
    for i, (avg, name) in enumerate(rows):
        if round(avg, 2) != previous:
            place = i + 1
            previous = round(avg, 2)
        out.append((place, name, round(avg, 1), letter(avg)))
    return out
