"""Export a downloaded ManaBox schema-12 catalog to a separate SQLite file."""
import json,sys,subprocess,sqlite3
from pathlib import Path
source,target,binary=map(Path,sys.argv[1:])
if target.exists():raise SystemExit('Refusing to replace an existing catalog export')
a,b=json.loads((Path(__file__).parent/'catalog_key.json').read_text())
# Public catalog key recovered from the app's two XOR lists. Not account credentials.
key=''.join(chr(x^y) for x,y in zip(a,b))
quote=lambda s:"'"+str(s).replace("'","''")+"'"
sql='.bail on\nPRAGMA key='+quote(key)+';\nSELECT count(*) FROM sqlite_master;\nATTACH DATABASE '+quote(target)+" AS readable KEY '';\nSELECT sqlcipher_export('readable');\nDETACH DATABASE readable;\n"
r=subprocess.run([str(binary),str(source)],input=sql,text=True,capture_output=True,timeout=180)
if r.returncode:raise SystemExit('SQLCipher could not open/export the catalog. Catalog format/key may have changed.')
with sqlite3.connect(target.as_uri()+'?mode=ro',uri=True) as db:
 if db.execute('pragma quick_check').fetchone()[0]!='ok':raise SystemExit('Catalog integrity check failed')
 print(db.execute('select updated_at from metadata').fetchone()[0])
