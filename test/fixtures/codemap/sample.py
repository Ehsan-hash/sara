"""Fixture module.

def not_a_function():
    pass
"""
import os, sys
from collections import OrderedDict
from .utils import slugify as slug

MAX_ITEMS = 50


def top_level(a, b):
    return a + b


class Animal:
    """An animal."""

    def __init__(self, name):
        self.name = name

    def speak(self):
        return f"{self.name} speaks"

    def _private(self):
        pass


async def fetch_all(urls):
    return [u for u in urls]
