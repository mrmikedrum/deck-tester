#!/usr/bin/env python3
"""Read-only ManaBox compatibility evidence. Never changes catalogs, decks or credentials."""
import argparse,gzip,json,sqlite3
from pathlib import Path

IDENTITY=('cv_scryfall_id','cv_oracle_id','cv_set_id','cv_collector_number')
def load(path):
    p=Path(path)
    return json.loads(gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_text())
def opened(path):
    c=sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)
    c.execute('pragma query_only=ON');c.row_factory=sqlite3.Row
    if c.execute('pragma quick_check').fetchone()[0]!='ok':
        c.close();raise ValueError('Catalog integrity check failed')
    return c
def schema(c):
    return {r['name']:r['sql'] for r in c.execute("select name,sql from sqlite_master where type='table' and name not like 'sqlite_%'")}
def catalog_rows(c):
    return {r['cv_id']:dict(r) for r in c.execute('select v.*,c.c_name from card_versions v join cards c on c.c_oracle_id=v.cv_oracle_id')}
def references(library=None,snapshot=None):
    refs=[]
    if library:
        root=Path(library).resolve();index=load(root/'library.json')
        for entry in index['decks']:
            p=(root/entry['file']).resolve()
            if not p.is_relative_to(root):raise ValueError('Library path outside library directory')
            for card in load(p)['cards']:
                refs.append({'id':card['cv_id'],'finish':card['finish'],'scryfall_id':card.get('scryfall_id'),'source':'library'})
    if snapshot:
        s=load(snapshot)
        for row in s['tables'].get('deck_cards',[]):refs.append({'id':row['dc_cv_id'],'finish':row['dc_foil'],'source':'snapshot'})
        for table,cols in [('decks',['d_cv_id_image']),('decks_folders',['df_cv_id_image_1','df_cv_id_image_2']),('inventory_cards',['ic_cv_id'])]:
            for row in s['tables'].get(table,[]):
                for col in cols:
                    if row.get(col) is not None:refs.append({'id':row[col],'source':'snapshot-'+table})
    return refs

def compare(before,after,refs,limit):
    a=opened(before);b=opened(after)
    try:
        old,new=catalog_rows(a),catalog_rows(b);sa,sb=schema(a),schema(b)
        changed=[key for key in sorted(set(sa)|set(sb)) if sa.get(key)!=sb.get(key)]
        removed=sorted(set(old)-set(new));identity=sorted(k for k in set(old)&set(new) if any(old[k].get(f)!=new[k].get(f) for f in IDENTITY))
        names=sorted(k for k in set(old)&set(new) if old[k]['c_name']!=new[k]['c_name'])
        corrections=[dict(r) for r in b.execute('select * from card_inconsistencies_migrations')] if 'card_inconsistencies_migrations' in sb else []
        affected=[];seen=set()
        for ref in refs:
            key=(ref['id'],ref.get('finish'),ref.get('scryfall_id'))
            if key in seen:continue
            seen.add(key);cv=ref['id'];row=new.get(cv);reasons=[]
            if row is None:reasons.append('missing_reference')
            if cv in identity:reasons.append('identity_changed_between_catalogs')
            if row and ref.get('scryfall_id') and row.get('cv_scryfall_id')!=ref['scryfall_id']:reasons.append('identity_differs_from_saved_deck')
            finish=ref.get('finish');flag={0:'cv_non_foil',1:'cv_foil',2:'cv_etched'}.get(finish)
            if row and flag and row.get(flag)!=1:reasons.append('finish_no_longer_advertised')
            maps=[m for m in corrections if m['cim_broken_cv_id']==cv and (finish is None or m.get('cim_broken_variant') in (None,finish))]
            if maps:reasons.append('explicit_correction_candidate')
            if reasons:affected.append({'cv_id':cv,'finish':finish,'reasons':reasons,'corrections':maps})
        return {'before_data_version':a.execute('select updated_at from metadata').fetchone()[0],
                'after_data_version':b.execute('select updated_at from metadata').fetchone()[0],
                'tables_changed':changed,'card_versions_added':len(set(new)-set(old)),
                'removed_ids':{'count':len(removed),'sample':removed[:limit]},
                'identity_changes':{'count':len(identity),'sample':identity[:limit]},
                'name_changes':{'count':len(names),'sample':names[:limit]},
                'correction_rows':len(corrections),'referenced_rows_checked':len(refs),
                'affected_references':{'count':len(affected),'sample':affected[:limit]},
                'sample_limit':limit,'status':'review_needed' if changed or affected else 'no_review_findings_in_checked_references' if refs else 'catalog_difference_only_no_reference_coverage',
                'scope':'Compares local read-only catalogs and supplied references. Correction matches are candidates, not instructions to remap. Does not prove cloud/API semantics or unobserved account coverage.'}
    finally:a.close();b.close()
def inventory(snapshot,baseline):
    s=load(snapshot);known=load(baseline)['sync_columns'];tables={}
    for table,rows in s['tables'].items():
        observed=sorted({key for row in rows for key in row})
        tables[table]={'rows':len(rows),'observed_columns':observed,'unmapped_columns':sorted(set(observed)-set(known.get(table,[]))-{'id'}),'visibility':'observed rows' if rows else 'empty; column presence cannot be inferred'}
    return {'tables':tables,'untyped_tables':{k:len(v) for k,v in s.get('untyped_tables',{}).items()},
            'scope':'Inventories delivered fields without row values, account IDs or deck names. New fields may be harmless, required for creation, or semantically significant; investigate in context.'}
def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='mode',required=True)
    q=sub.add_parser('catalogs');q.add_argument('--before',required=True);q.add_argument('--after',required=True);q.add_argument('--library');q.add_argument('--snapshot');q.add_argument('--limit',type=int,default=25)
    q=sub.add_parser('snapshot');q.add_argument('file');q.add_argument('--baseline',default=str(Path(__file__).with_name('baseline-2026-10-16.json')))
    args=p.parse_args()
    if args.mode=='snapshot':result=inventory(args.file,args.baseline)
    else:
        if args.limit<1:p.error('--limit must be positive')
        result=compare(args.before,args.after,references(args.library,args.snapshot),args.limit)
    print(json.dumps(result,indent=2))
    return 2 if result.get('status')=='review_needed' else 0
if __name__=='__main__':
    try:raise SystemExit(main())
    except (OSError,ValueError,sqlite3.Error,KeyError) as e:
        print(json.dumps({'error':str(e),'scope':'Inspection incomplete; no files or cloud data changed.'}));raise SystemExit(1)
