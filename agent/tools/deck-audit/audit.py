#!/usr/bin/env python3
"""Read-only, human-annotated Commander structural auditor. No live mutations."""
import argparse, collections, hashlib, json, math, pathlib

BOARDS = {'main', 'commander'}
EXCLUDED = {'token', 'double_faced_token', 'emblem'}

def resolve(name, cache, oracle_id=None):
    matches = [r for r in cache if r['card']['name'] == name and r['card'].get('layout') not in EXCLUDED]
    if oracle_id:
        matches = [r for r in matches if r['card']['oracle_id'] == oracle_id]
    ids = {r['card']['oracle_id'] for r in matches}
    if len(ids) != 1:
        raise ValueError(f'Missing/ambiguous Oracle identity: {name}')
    return max(matches, key=lambda r: r['retrieved_at'])

def access(n, hits, seen, minimum=1):
    """Hypergeometric P(at least minimum hits); no mulligans or card effects."""
    if not (0 <= hits <= n and 0 <= seen <= n and minimum >= 0):
        raise ValueError('invalid hypergeometric population')
    return sum(math.comb(hits,k)*math.comb(n-hits,seen-k)
               for k in range(max(minimum,seen-(n-hits)), min(hits,seen)+1))/math.comb(n,seen)

def front(card):
    return card.get('card_faces', [card])[0]

def audit(deck, annotations, cache):
    if annotations['deck_id'] != deck['id']:
        raise ValueError('annotation deck identity mismatch')
    rows=[]; role_counts={}; curve=collections.Counter(); lands=0; mdfc=0
    for r in deck['cards']:
        if r['board'] not in BOARDS | {'side','maybe'}: raise ValueError('unknown board')
        if r['board'] not in BOARDS: continue
        parts=(r['quantity'],r.get('proxies',0))
        if any(type(v) is not int or v < 0 for v in parts): raise ValueError('invalid quantity')
        q=sum(parts)
        if q == 0: continue
        a=annotations['cards'].get(r['name'])
        if not a or not a.get('reason') or not a.get('roles'): raise ValueError(f'Unannotated card: {r["name"]}')
        fact=resolve(r['name'], cache, a['oracle_id']); c=fact['card']; f=front(c)
        is_land='Land' in f.get('type_line','').split(' — ')[0].split()
        is_mdfc=not is_land and c.get('layout')=='modal_dfc' and any('Land' in x.get('type_line','').split(' — ')[0].split() for x in c.get('card_faces',[])[1:])
        mv=c['cmc']; roles=a['roles']; seen_roles=set()
        for role in roles:
            name=role['role']
            if name in seen_roles: raise ValueError(f'Duplicate role on {r["name"]}')
            seen_roles.add(name)
            if role['access'] not in ('standalone','conditional'): raise ValueError('unknown access class')
            if role['access']=='conditional' and not role.get('condition'): raise ValueError('conditional role needs condition')
            if not isinstance(role['mana'],int) or role['mana']<0: raise ValueError('role mana must be nonnegative integer')
            # Commander shown per-card but never treated as random library coverage.
            if r['board']=='commander': continue
            bucket=role_counts.setdefault(name,{'unique_slots':0,'standalone':0,'conditional':0,'role_mana':{},'cards':[]})
            bucket['unique_slots']+=q;bucket[role['access']]+=q
            key=str(role['mana']);bucket['role_mana'][key]=bucket['role_mana'].get(key,0)+q
            bucket['cards'].append({'name':r['name'],'quantity':q,**role})
        if r['board']=='main':
            lands+=q*is_land;mdfc+=q*is_mdfc
            if not is_land: curve[str(mv)]+=q
        rows.append({'name':r['name'],'quantity':q,'board':r['board'],'mv':mv,'mana_cost':f.get('mana_cost',''),'front_land':is_land,'mdfc_land':is_mdfc,'roles':roles,'reason':a['reason'],'oracle_id':c['oracle_id'],'facts_retrieved_at':fact['retrieved_at'],'source_url':fact['source_url']})
    n=sum(r['quantity'] for r in rows if r['board']=='main')
    land_access={}
    for turn in (3,4,5):
        seen=min(n,7+turn) # multiplayer Commander draws on turn 1
        land_access[f'at_least_{turn}_lands_seen_by_turn_{turn}']={
            'front_only':round(access(n,lands,seen,turn),5),
            'including_land_mdfcs':round(access(n,lands+mdfc,seen,turn),5)}
    windows={}
    for name,role in role_counts.items():
        windows[name]={str(t):round(access(n,role['unique_slots'],min(n,7+t)),5) for t in (3,5,7)}
    mana=annotations.get('land_sources',{})
    if mana:
        actual={r['name'] for r in rows if r['board']=='main' and (r['front_land'] or r['mdfc_land'])}
        if set(mana)!=actual: raise ValueError('land-source annotations incomplete/stale')
        if any(not v.get('note') or v.get('access') not in ('untapped','conditional','tapped','colorless') for v in mana.values()): raise ValueError('invalid land-source annotation')
    source_counts=collections.Counter()
    for row in rows:
        if row['board']=='main' and row['name'] in mana:
            v=mana[row['name']];key=f"{v.get('direct_color') or 'no-direct-colored-mana'} / {v['access']}"
            source_counts[key]+=row['quantity']
    return {'schema':'deck-audit/v1','name':deck['name'],'deck_id':deck['id'],
            'deck_sha256':hashlib.sha256(json.dumps(deck,sort_keys=True).encode()).hexdigest(),
            'playing_slots':sum(r['quantity'] for r in rows),'library_slots':n,
            'annotated_rows':len(rows),'front_lands':lands,'land_mdfcs':mdfc,
            'printed_nonland_mv_curve':dict(sorted(curve.items(),key=lambda x:float(x[0]))),
            'roles':role_counts,'land_source_slot_counts':dict(source_counts),'land_sources':mana,'draw_window_access':windows,'land_draw_access':land_access,
            'limits':['Human role annotations are judgments, not verified rules.',
                      'Standalone means no external setup, not immune to removal or summoning sickness.',
                      'Role mana is minimum mana investment in the stated use, not a castable turn or total engine cost.',
                      'Access is exact random-card visibility: seven cards plus one draw per turn; no mulligans, scry, extra draw or opponents.',
                      'Land availability is NOT land drops or mana availability; tapped, bounce, filtering, MDFC spell choice and colors require sequencing.',
                      'Role overlaps do not add to deck size. Commander roles excluded from library probabilities.',
                      'No game, fun, win-rate or bracket simulation.'], 'cards':rows}

def main():
    p=argparse.ArgumentParser();p.add_argument('deck');p.add_argument('annotations');p.add_argument('--cache',default='.card-cache/oracle');a=p.parse_args()
    records=[json.loads(f.read_text()) for f in pathlib.Path(a.cache).glob('*.json')]
    print(json.dumps(audit(json.loads(pathlib.Path(a.deck).read_text()),json.loads(pathlib.Path(a.annotations).read_text()),records),indent=2))
if __name__=='__main__':main()
