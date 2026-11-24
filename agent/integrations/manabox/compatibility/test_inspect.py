import hashlib,importlib.util,json,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('manabox_compat',Path(__file__).with_name('inspect.py'))
compat=importlib.util.module_from_spec(spec);spec.loader.exec_module(compat)
class CompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.dir=Path(self.tmp.name)
        self.before=self.dir/'before.db';self.after=self.dir/'after.db'
        for p in [self.before,self.after]:
            with sqlite3.connect(p) as c:
                c.executescript('''create table metadata(updated_at integer);insert into metadata values(1);
                  create table cards(c_oracle_id text,c_name text);insert into cards values('o','Example');
                  create table card_versions(cv_id integer,cv_oracle_id text,cv_scryfall_id text,cv_set_id text,cv_collector_number text,cv_non_foil integer,cv_foil integer,cv_etched integer);
                  insert into card_versions values(1,'o','scryfall-original','set','1',1,1,0);
                  create table card_inconsistencies_migrations(cim_broken_cv_id integer,cim_broken_variant integer,cim_correct_cv_id integer,cim_correct_variant integer);''')
    def tearDown(self):self.tmp.cleanup()
    def test_identity_reuse_is_reported_and_catalogs_remain_unchanged(self):
        with sqlite3.connect(self.after) as c:c.execute("update card_versions set cv_scryfall_id='different-card'")
        before={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [self.before,self.after]}
        r=compat.compare(self.before,self.after,[{'id':1,'finish':0,'scryfall_id':'scryfall-original'}],25)
        self.assertEqual(r['status'],'review_needed');self.assertEqual(r['identity_changes']['count'],1)
        self.assertIn('identity_differs_from_saved_deck',r['affected_references']['sample'][0]['reasons'])
        self.assertEqual(before,{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [self.before,self.after]})
    def test_finish_and_explicit_correction_candidates_do_not_get_applied(self):
        with sqlite3.connect(self.after) as c:
            c.execute('update card_versions set cv_foil=0');c.execute('insert into card_inconsistencies_migrations values(1,1,2,0)')
        r=compat.compare(self.before,self.after,[{'id':1,'finish':1}],25)
        reasons=r['affected_references']['sample'][0]['reasons']
        self.assertIn('finish_no_longer_advertised',reasons);self.assertIn('explicit_correction_candidate',reasons)
        with sqlite3.connect(self.after) as c:self.assertEqual(c.execute('select cv_id from card_versions').fetchone()[0],1)
    def test_snapshot_inventory_preserves_empty_table_uncertainty_and_omits_values(self):
        p=self.dir/'snapshot.json';p.write_text(json.dumps({'uid':'PRIVATE_MARKER','tables':{'decks':[{'id':'PRIVATE_MARKER','d_name':'PRIVATE_MARKER','future_field':1}],'binders':[]},'untyped_tables':{'new_table':[{'id':'PRIVATE_MARKER'}]}}))
        baseline=self.dir/'baseline.json';baseline.write_text(json.dumps({'sync_columns':{'decks':['d_name'],'binders':[]}}))
        r=compat.inventory(p,baseline)
        self.assertNotIn('PRIVATE_MARKER',json.dumps(r));self.assertIn('future_field',r['tables']['decks']['unmapped_columns']);self.assertIn('cannot be inferred',r['tables']['binders']['visibility']);self.assertEqual(r['untyped_tables']['new_table'],1)
    def test_missing_catalog_is_not_created_and_no_references_is_explicit(self):
        missing=self.dir/'missing.db'
        with self.assertRaises(sqlite3.OperationalError):compat.opened(missing)
        self.assertFalse(missing.exists())
        r=compat.compare(self.before,self.after,[],1);self.assertEqual(r['status'],'catalog_difference_only_no_reference_coverage')
    def test_removed_reference_and_new_table_are_reported(self):
        with sqlite3.connect(self.after) as c:c.execute('delete from card_versions');c.execute('create table added(x text)')
        r=compat.compare(self.before,self.after,[{'id':1,'finish':0}],1)
        self.assertEqual(r['removed_ids']['count'],1);self.assertIn('added',r['tables_changed']);self.assertIn('missing_reference',r['affected_references']['sample'][0]['reasons'])
if __name__=='__main__':unittest.main()
