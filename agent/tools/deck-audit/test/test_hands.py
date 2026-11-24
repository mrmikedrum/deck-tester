import importlib.util,pathlib,unittest
p=pathlib.Path(__file__).resolve().parents[1]/'hands.py';s=importlib.util.spec_from_file_location('hands',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class HandTests(unittest.TestCase):
 def test_repeatable_real_library_without_commanders(self):
  cards=[dict(name=str(i),board='main',quantity=1,front_land=i<37,mdfc_land=i==37) for i in range(99)]
  cards.append(dict(name='Commander',board='commander',quantity=1,front_land=False,mdfc_land=False))
  r={'deck_sha256':'fixture','cards':cards};a=m.sample(r,17,100);self.assertEqual(a,m.sample(r,17,100));self.assertTrue(any(h['free_mulligan'] for h in a['hands']))
  for h in a['hands']:
   seen=h['kept_hand']+h['draws_turns_1_to_5'];self.assertEqual(len(seen),12);self.assertEqual(len(set(seen)),12);self.assertNotIn('Commander',seen)
 def test_no_land_free_mulligan_still_records_bad_hand(self):
  r={'deck_sha256':'fixture','cards':[dict(name=str(i),board='main',quantity=1,front_land=False,mdfc_land=False) for i in range(99)]}
  h=m.sample(r)['hands'][0];self.assertTrue(h['free_mulligan']);self.assertEqual(h['land_options_in_kept_hand'],0)
if __name__=='__main__':unittest.main()
