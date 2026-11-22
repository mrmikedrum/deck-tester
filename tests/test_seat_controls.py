"""Browser state-machine checks, without launching or driving a browser."""
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
CLIENT = ROOT / 'seat-aesthetics/client/live.js'


@unittest.skipUnless(CLIENT.exists() and shutil.which('node'), 'requires Seat client and Node')
class ManaControlsTest(unittest.TestCase):
    def test_mana_stays_clickable_but_is_not_a_response_or_auto_pass_blocker(self):
        js = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(process.argv[1],'utf8');
const refs=src.slice(src.indexOf('  const refs ='),src.indexOf('  const onBoard ='));
const timer=src.slice(src.indexOf('  function autoContinue()'),src.indexOf('\n  function hold()'));
function state(extra=[],danger=false){
 const scheduled=[];
 const ctx={d:{kind:'play',refs:[{}, {card:1,mana:true},{card:2,mana:true},...extra]},
  G:{stack:[{controller:'ana'}]}, autoTimer:null,held:false,busy:false,dkey:'current',
  threat:()=>danger,clearTimeout:()=>{},setTimeout:(fn,ms)=>{scheduled.push({fn,ms});return 1;},answer:()=>{}};
 vm.createContext(ctx);vm.runInContext(refs+timer,ctx);ctx.autoContinue();
 return {ctx,scheduled,opts:vm.runInContext('JSON.stringify(playOptions())',ctx)};
}
let a=state();assert.equal(a.opts,'[]');assert.equal(a.scheduled.length,1);assert.equal(a.scheduled[0].ms,3200);
assert.equal(vm.runInContext('JSON.stringify(optsFor(1))',a.ctx),'[2]');
a=state([{card:3,spell:true}]);assert.equal(a.opts,'[4]');assert.equal(a.scheduled.length,0);
a=state([{card:4}]);assert.equal(a.opts,'[4]');assert.equal(a.scheduled.length,0);
a=state([],true);assert.equal(a.scheduled.length,0);
assert(src.includes('offer(playOptions(), "Everything you can play", false)'));
assert(src.includes('offer(playOptions(), "Respond")'));
'''
        subprocess.run(['node', '-e', js, str(CLIENT)], check=True, capture_output=True, text=True)
