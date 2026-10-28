import unittest

from inifile import get, get_int, parse


class ParseTest(unittest.TestCase):
    def test_sections(self):
        cfg = parse("name = demo\n[server]\nport = 8080\n")
        self.assertEqual(cfg[""]["name"], "demo")
        self.assertEqual(get_int(cfg, "server.port"), 8080)
        self.assertEqual(get(cfg, "server.host", "localhost"), "localhost")


if __name__ == "__main__":
    unittest.main()
