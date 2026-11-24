import importlib.util, pathlib, unittest
p=pathlib.Path(__file__).resolve().parents[1]/'audit.py';spec=importlib.util.spec_from_file_location('audit',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class AuditTests(unittest.TestCase):
 def fact(self,name='Spell',oid='s',**kw):
  return {'retrieved_at':'2026-10-17','source_url':'fixture','card':dict(name=name,oracle_id=oid,cmc=4,layout='normal',type_line='Creature',**kw)}
 def fixture(self):
  d={'id':'d','name':'fixture','cards':[{'name':'Spell','board':'main','quantity':1,'proxies':1},{'name':'Leader','board':'commander','quantity':1},{'name':'Spell','board':'maybe','quantity':10}]}
  roles=[{'role':'draw','access':'conditional','mana':2,'condition':'Needs a tapped creature'},{'role':'payoff','access':'standalone','mana':4}]
  a={'deck_id':'d','cards':{n:{'oracle_id':o,'reason':'Fixture','roles':roles} for n,o in [('Spell','s'),('Leader','l')]}}
  return d,a,[self.fact(),self.fact('Leader','l')]
 def test_slots_boards_proxies_overlap_and_commander(self):
  d,a,c=self.fixture();r=m.audit(d,a,c)
  self.assertEqual((r['playing_slots'],r['library_slots']),(3,2));self.assertEqual(r['roles']['draw']['unique_slots'],2);self.assertEqual(r['roles']['draw']['standalone'],0);self.assertEqual(r['roles']['draw']['role_mana'],{'2':2});self.assertEqual(r['printed_nonland_mv_curve'],{'4':2})
 def test_same_name_token_cannot_replace_real_card(self):
  token=self.fact(oid='token');token['card']['layout']='token';self.assertEqual(m.resolve('Spell',[token,self.fact()])['card']['oracle_id'],'s')
 def test_ambiguity_and_missing_fail_closed(self):
  with self.assertRaises(ValueError):m.resolve('Spell',[self.fact(),self.fact(oid='other')])
  with self.assertRaises(ValueError):m.resolve('Missing',[self.fact()])
 def test_mdfc_not_transform(self):
  d,a,c=self.fixture();c[0]['card'].update(layout='modal_dfc',card_faces=[{'type_line':'Creature','mana_cost':'{3}{U}'},{'type_line':'Land'}]);self.assertEqual(m.audit(d,a,c)['land_mdfcs'],2)
  c[0]['card']['layout']='transform';self.assertEqual(m.audit(d,a,c)['land_mdfcs'],0)
 def test_land_on_both_mdfc_faces_counts_once(self):
  d,a,c=self.fixture();c[0]['card'].update(layout='modal_dfc',card_faces=[{'type_line':'Land'},{'type_line':'Land'}])
  r=m.audit(d,a,c)
  self.assertEqual((r['front_lands'],r['land_mdfcs']),(2,0))
  for window in r['land_draw_access'].values():self.assertEqual(window['front_only'],window['including_land_mdfcs'])
 def test_missing_annotation_and_condition_fail_closed(self):
  d,a,c=self.fixture();a['cards']['Spell']['roles'][0].pop('condition')
  with self.assertRaises(ValueError):m.audit(d,a,c)
  del a['cards']['Spell']
  with self.assertRaises(ValueError):m.audit(d,a,c)
 def test_exact_access_known_urn(self):
  self.assertAlmostEqual(m.access(4,2,2),5/6);self.assertAlmostEqual(m.access(4,2,2,2),1/6);self.assertEqual(m.access(99,0,10),0);self.assertEqual(m.access(99,99,10),1)
if __name__=='__main__':unittest.main()
