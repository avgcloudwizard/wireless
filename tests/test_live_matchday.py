import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import unittest
from datetime import datetime, timezone
from live_matchday import interval, match_window, score_team

class MatchdayTests(unittest.TestCase):
    def test_weekend_interval_uses_indian_date(self):
        self.assertEqual(interval(datetime(2026,10,9,20,tzinfo=timezone.utc)),60)
        self.assertEqual(interval(datetime(2026,10,12,12,tzinfo=timezone.utc)),900)

    def test_no_worker_for_finished_or_old_matches(self):
        now=datetime(2026,10,10,15,tzinfo=timezone.utc)
        fixture={'kickoff_time':'2026-10-10T14:00:00Z','finished':False}
        self.assertTrue(match_window([fixture],now))
        self.assertFalse(match_window([{**fixture,'finished':True}],now))
        self.assertFalse(match_window([{**fixture,'kickoff_time':'2026-10-10T09:00:00Z'}],now))

    def test_hits_once_captain_and_bench_multipliers(self):
        team={'players':[{'id':1,'multiplier':3},{'id':2,'multiplier':0},{'id':3,'multiplier':1}],
              'entry_history':{'total_points':340,'points':44,'event_transfers_cost':4}}
        result,gross,total=score_team(team,{1:10,2:12,3:4})
        self.assertEqual(gross,34)
        self.assertEqual(total,330)
        self.assertEqual(result['players'][1]['earned'],0)
        self.assertNotIn('earned',team['players'][0])
        with self.assertRaises(ValueError):score_team(team,{1:10})
