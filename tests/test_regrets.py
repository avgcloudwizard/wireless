import unittest
from scripts.regrets import untouched_score, original_lineup

class FrozenSquadTests(unittest.TestCase):
    def setUp(self):
        # 3-4-3, with GK / MID / DEF / DEF in bench order.
        self.roles = dict(enumerate([1,2,2,2,3,3,3,3,4,4,4,1,3,2,2], 1))
        self.lineup = [{'element':i,'position':i,'is_captain':i==9,'is_vice_captain':i==5} for i in range(1,16)]
        self.stats = {i:{'minutes':90,'total_points':2} for i in range(1,16)}

    def test_normal_no_chip_multiplier(self):
        self.assertEqual(untouched_score(self.lineup,self.stats,self.roles),24)

    def test_defender_absent_skips_first_bench_midfielder(self):
        self.stats[2]={'minutes':0,'total_points':0}
        self.stats[13]['total_points']=20
        self.stats[14]['total_points']=7
        self.assertEqual(untouched_score(self.lineup,self.stats,self.roles),29)

    def test_goalkeeper_and_vice_fallback(self):
        self.stats[1]={'minutes':0,'total_points':0}
        self.stats[9]={'minutes':0,'total_points':0}
        self.stats[12]['total_points']=6
        self.stats[5]['total_points']=8
        self.assertEqual(untouched_score(self.lineup,self.stats,self.roles),40)

    def test_live_pending_starters_and_captain_wait_for_remaining_fixtures(self):
        self.stats[1]={'minutes':0,'total_points':0}
        self.stats[9]={'minutes':0,'total_points':0}
        self.stats[12]['total_points']=6
        self.stats[5]['total_points']=8
        # Neither GK sub nor vice fallback happens while their clubs can still play.
        self.assertEqual(untouched_score(self.lineup,self.stats,self.roles,{1,9}),24)
        self.assertEqual(untouched_score(self.lineup,self.stats,self.roles,set()),40)

    def test_live_comparison_extends_both_sides_once(self):
        from scripts.regrets import build_untouched_live
        saved={'through_gw':1,'rows':[{'id':1,'actual':30,'frozen':{'points':24,'weeks':[{'gw':1,'points':24}], 'lineup':self.lineup}}]}
        elements={i:{'element_type':self.roles[i],'team':1} for i in self.stats}
        team={'gw':2,'entry_history':{'event_transfers_cost':4},'players':[{'id':i,'multiplier':2 if i==9 else 1 if i<=11 else 0} for i in self.stats]}
        managers=[{'id':1,'public_team':team}]
        live=build_untouched_live(saved,2,self.stats,elements,[],managers)
        self.assertEqual(live['through_gw'],2)
        self.assertEqual(live['rows'][0]['frozen']['points'],48)
        self.assertEqual(live['rows'][0]['actual'],50)
        self.assertEqual(saved['rows'][0]['frozen']['points'],24)
        self.assertEqual(build_untouched_live(saved,2,self.stats,elements,[],managers),live)
        self.assertIsNone(build_untouched_live(saved,3,self.stats,elements,[],managers))
        self.assertIsNone(build_untouched_live(live,2,self.stats,elements,[],managers))

    def test_blank_all_zero(self):
        self.stats={i:{'minutes':0,'total_points':0} for i in range(1,16)}
        self.assertEqual(untouched_score(self.lineup,self.stats,self.roles),0)

    def test_negative_captain_points(self):
        self.stats[9]['total_points']=-2
        self.assertEqual(untouched_score(self.lineup,self.stats,self.roles),16)

    def test_restore_original_autosub_order(self):
        self.lineup[1]['position'],self.lineup[13]['position']=14,2
        d={'lineup':self.lineup,'automatic_subs':[{'element_out':2,'element_in':14}]}
        restored=original_lineup(d)
        self.assertEqual([p['element'] for p in restored],list(range(1,16)))
        self.assertEqual(self.lineup[1]['position'],14)

    def test_missing_player_fails_instead_of_inventing_zero(self):
        del self.stats[12]
        with self.assertRaises(ValueError):untouched_score(self.lineup,self.stats,self.roles)

class RegretComparisonTests(unittest.TestCase):
    def test_captain_bonus_receipt_hits_and_bench_boost(self):
        from scripts.regrets import build_regrets
        base=FrozenSquadTests();base.setUp()
        elements={i:{'web_name':str(i),'element_type':base.roles[i]} for i in range(1,16)}
        elements[16]={'web_name':'Sold','element_type':4}
        lineup=[dict(p,multiplier=3 if p['is_captain'] else 1 if p['position']<=11 else 0) for p in base.lineup]
        details={'1:1':{'lineup':lineup,'automatic_subs':[]}}
        m={'id':1,'history':[{'gw':1,'net':40,'chip':'3xc','hits':4}]}
        stats={i:{'total_points':2,'minutes':90} for i in range(1,17)}
        stats[5]['total_points']=10
        def fetch(path):
            if path.endswith('/live/'):
                return {'elements':[{'id':i,'stats':s} for i,s in stats.items()]}
            return [{'event':1,'element_in':5,'element_out':16},{'event':1,'element_in':6,'element_out':16}]
        row=build_regrets([m],details,elements,{1},{},fetch)['rows'][0]
        self.assertEqual(row['captains'][0]['delta'],16) # (10-2) × two TC bonus copies
        self.assertEqual(row['receipts'][0]['delta'],4) # (10-2)+(2-2)-4, hit counted once
        self.assertEqual(row['receipts'][0]['weeks'],[1])
        self.assertEqual(row['bench'][0]['points'],2)
        m['history'][0]['chip']='bboost'
        row=build_regrets([m],details,elements,{1},{},fetch)['rows'][0]
        self.assertEqual(row['bench'],[])
        m['history'][0]['chip']='wildcard'
        row=build_regrets([m],details,elements,{1},{},fetch)['rows'][0]
        self.assertEqual(row['receipts'],[])

class PermaCaptainTests(unittest.TestCase):
    def test_fixed_choices_unowned_player_and_triple_bonus(self):
        from scripts.regrets import perma_captains
        elements={1:{'web_name':'Haaland'},2:{'web_name':'B.Fernandes'},3:{'web_name':'Palmer','first_name':'Cole'},4:{'web_name':'Saka'},5:{'web_name':'João Pedro'},6:{'web_name':'Palmer','first_name':'Other'}}
        history=[{'gw':1,'chip':None},{'gw':2,'chip':'3xc'}]
        details={1:{'lineup':[{'element':1,'multiplier':2}]},2:{'lineup':[{'element':1,'multiplier':3}]}}
        live={gw:{pid:{'total_points':pid} for pid in elements} for gw in [1,2]}
        result=perma_captains(history,details,live,elements)
        self.assertEqual([r['id'] for r in result],[1,2,3,4,5])
        self.assertEqual(result[0]['delta'],0)
        self.assertEqual(result[2]['delta'],6) # (3-1) + (3-1)*2, even while not owned
        self.assertEqual(result[4]['delta'],12)
