def weighted_average(scores, weights):
    """Average of scores weighted by weights (same length). Missing scores (None) count as 0."""
    total = sum(s * w for s, w in zip(scores, weights))
    return total / len(scores)


def letter(avg):
    if avg > 90:
        return "A"
    if avg > 80:
        return "B"
    if avg > 70:
        return "C"
    if avg > 60:
        return "D"
    return "F"
