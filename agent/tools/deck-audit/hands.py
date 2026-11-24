#!/usr/bin/env python3
"""Reproducible shuffled hands, not a game engine or optimal mulligan solver."""
import argparse,json,pathlib,random

def sample(report,seed=17,count=6):
    library=[]
    for card in report['cards']:
        if card['board']=='main':library.extend([card]*card['quantity'])
    rng=random.Random(seed);out=[]
    for i in range(count):
        order=library[:];rng.shuffle(order)
        first=order[:7];lands=lambda hand:sum(bool(c['front_land'] or c['mdfc_land']) for c in hand)
        mull=not 2<=lands(first)<=4
        if mull:order=library[:];rng.shuffle(order)
        hand=order[:7]
        out.append({'sample':i+1,'first_hand':[c['name'] for c in first],'free_mulligan':mull,'kept_hand':[c['name'] for c in hand],'land_options_in_kept_hand':lands(hand),'draws_turns_1_to_5':[c['name'] for c in order[7:12]]})
    return {'seed':seed,'count':count,'deck_sha256':report['deck_sha256'],'policy':'Keep 2-4 front-land/MDFC options; otherwise one free shuffle and redraw seven, then keep regardless. Diagnostic only; no further London mulligan, scry, casting, opponents or sequencing. MDFC always counted as a land option, not as both choices.','hands':out}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('report');p.add_argument('--seed',type=int,default=17);p.add_argument('--count',type=int,default=6);a=p.parse_args();print(json.dumps(sample(json.loads(pathlib.Path(a.report).read_text()),a.seed,a.count),indent=2))
