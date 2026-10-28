import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from inifile import ParseError, get, get_bool, get_int, parse  # noqa: E402

SAMPLE = """; settings for the demo
# another comment
name = demo
[server]
Host: example.org   ; the public name
port = 8080
debug = Yes
motd = Welcome
    to the server ; inline
    ; a comment between
    and enjoy

path = C:\\data#1
empty =
port = 9090
[Paths.Win]
root = D:\\x
"""


class Hidden(unittest.TestCase):
    def setUp(self):
        self.cfg = parse(SAMPLE)

    def test_top_level_and_sections(self):
        self.assertEqual(self.cfg[""], {"name": "demo"})
        self.assertIn("server", self.cfg)
        self.assertIn("Paths.Win", self.cfg)

    def test_colon_lowercase_and_inline_comment(self):
        self.assertEqual(self.cfg["server"]["host"], "example.org")
        self.assertEqual(get(self.cfg, "server.HOST"), "example.org")

    def test_last_one_wins_and_empty(self):
        self.assertEqual(get_int(self.cfg, "server.port"), 9090)
        self.assertEqual(get(self.cfg, "server.empty"), "")

    def test_continuation(self):
        self.assertEqual(self.cfg["server"]["motd"], "Welcome\nto the server\nand enjoy")

    def test_hash_without_space_is_kept(self):
        self.assertEqual(get(self.cfg, "server.path"), "C:\\data#1")

    def test_dotted_sections_are_case_sensitive(self):
        self.assertEqual(get(self.cfg, "Paths.Win.root"), "D:\\x")
        self.assertIsNone(get(self.cfg, "paths.win.root"))
        self.assertEqual(get(self.cfg, "name"), "demo")

    def test_bools(self):
        self.assertIs(get_bool(self.cfg, "server.debug"), True)
        cfg = parse("a = off\nb = 1\nc = TRUE\nd = maybe\n")
        self.assertIs(get_bool(cfg, "a"), False)
        self.assertIs(get_bool(cfg, "b"), True)
        self.assertIs(get_bool(cfg, "c"), True)
        self.assertIs(get_bool(cfg, "missing", False), False)
        with self.assertRaises(ValueError):
            get_bool(cfg, "d")

    def test_ints(self):
        self.assertEqual(get_int(self.cfg, "server.nothing", 5), 5)
        with self.assertRaises(ValueError):
            get_int(parse("x = abc"), "x")

    def test_errors_name_the_line(self):
        with self.assertRaises(ParseError) as e:
            parse("[ok]\na = 1\nthis is not valid\n")
        self.assertTrue(str(e.exception).startswith("line 3:"), str(e.exception))
        self.assertTrue(issubclass(ParseError, ValueError))
        with self.assertRaises(ParseError):
            parse("[unclosed\n")

    def test_section_line_ends_continuation(self):
        cfg = parse("[a]\nk = 1\n[b]\n  x = 2\n")
        self.assertEqual(cfg["a"]["k"], "1")
        self.assertEqual(cfg["b"]["x"], "2")


if __name__ == "__main__":
    unittest.main()
