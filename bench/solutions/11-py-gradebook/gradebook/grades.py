def weighted_average(scores, weights):
    """Sum of score * weight over the sum of the weights. Missing scores (None) count as 0."""
    total = sum((s or 0) * w for s, w in zip(scores, weights))
    return total / sum(weights)


def letter(avg):
    if avg >= 90:
        return "A"
    if avg >= 80:
        return "B"
    if avg >= 70:
        return "C"
    if avg >= 60:
        return "D"
    return "F"
