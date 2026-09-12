import unittest

import shogi

from tools.reason_additional_search import REQUIRED, TOP10, branch_search, reply_multipv


class FakeEngine:
    def analyze(self, sfen, nodes, searchmoves=None):
        return {"score": ("cp", -123), "pv": ["3c3d"], "bestmove": "3c3d",
                "nodes": nodes + 7, "timeMs": 12, "wallTimeMs": 14, "nps": 2500000}

    def analyze_multipv(self, sfen, nodes, multipv=2, searchmoves=None):
        return {"bestmove": "3c3d", "lines": [
            {"rank": 1, "score": ("cp", 10), "pv": ["3c3d"]},
            {"rank": 2, "score": ("cp", 5), "pv": ["8c8d"]},
        ], "nodes": nodes, "timeMs": 20, "wallTimeMs": 22, "nps": 3000000}


class ReasonAdditionalSearchTest(unittest.TestCase):
    def setUp(self):
        self.fixture = {
            "requestId": "test-1", "position": {"sfen": shogi.Board().sfen()},
            "userSide": "sente", "actualMove": "7g7f", "actualMoveJa": "▲7六歩",
            "bestMove": "2g2f", "bestMoveJa": "▲2六歩",
        }

    def test_scope_is_top10_plus_three_unique_required_fixtures(self):
        self.assertEqual(len(TOP10), 10)
        self.assertEqual(len(dict.fromkeys([*TOP10, *REQUIRED])), 13)

    def test_fixed_branch_keeps_move_and_cost(self):
        result = branch_search(FakeEngine(), self.fixture, "actual", 30000)
        self.assertEqual(result["fixedMove"], "7g7f")
        self.assertEqual(result["pv"][0], "7g7f")
        self.assertEqual(result["nodesReported"], 30007)
        self.assertEqual(result["score"], {"type": "cp", "value": 123})
        self.assertEqual(result["bestReply"], "3c3d")

    def test_multipv_is_after_each_fixed_move(self):
        result = reply_multipv(FakeEngine(), self.fixture, "recommended", 60000)
        self.assertEqual(len(result["lines"]), 2)
        self.assertEqual(result["lines"][0]["fullPv"][:2], ["2g2f", "3c3d"])


if __name__ == "__main__":
    unittest.main()
