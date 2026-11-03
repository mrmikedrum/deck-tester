"""Install tracked card scripts into Forge's normal reader, without modifying its engine."""
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def fingerprint(root=ROOT):
    files = sorted((root / 'cards').glob('*'))
    return hashlib.sha256(b''.join(p.name.encode() + p.read_bytes() for p in files if p.is_file())).hexdigest()


def prepare(root=ROOT):
    vendor = root / 'vendor/forge'
    manifest = json.loads((root / 'cards/manifest.json').read_text())
    names = [entry['name'] for entry in manifest.values()]
    if len(names) != len(set(names)):
        raise ValueError('duplicate local card name')
    # Search committed upstream objects, not our installed local files or unrelated working patches.
    command = ['git', '-C', str(vendor), 'grep', '-n', '-E',
               '^Name:(' + '|'.join(re.escape(name) for name in names) + ')$']
    result = subprocess.run(command + ['HEAD', '--', 'forge-gui/res/cardsfolder'], capture_output=True, text=True)
    if result.returncode not in (0, 1):
        raise ValueError('cannot inventory upstream cards: ' + result.stderr)
    if result.stdout:
        raise ValueError('Upstream now defines local cards; compare, retire their cards/ entries and rerun:\n' + result.stdout)
    destination = vendor / 'forge-gui/res/cardsfolder/goldfish-local'
    state_path = root / '.goldfish/card-resources.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    previous = state.get('files', {})
    contents = {}
    for filename, entry in manifest.items():
        if Path(filename).name != filename or not filename.endswith('.txt'):
            raise ValueError('invalid card filename: ' + filename)
        data = (root / 'cards' / filename).read_bytes()
        if ('Name:' + entry['name']) not in data.decode().splitlines():
            raise ValueError('manifest/card name mismatch: ' + filename)
        contents[filename] = data
    # Validate every destination before any mutation; never overwrite an unowned or edited file.
    if destination.exists():
        for path in destination.iterdir():
            if not path.is_file() or previous.get(path.name) != hashlib.sha256(path.read_bytes()).hexdigest():
                raise ValueError('Unmanaged or edited Forge resource; preserve/reconcile first: ' + str(path))
    destination.mkdir(parents=True, exist_ok=True)
    for filename in previous.keys() - contents.keys():
        path = destination / filename
        if path.exists():
            retired = root / '.goldfish/retired-cards' / previous[filename] / filename
            retired.parent.mkdir(parents=True, exist_ok=True)
            if retired.exists():
                raise ValueError('Retirement backup already exists: ' + str(retired))
            shutil.move(str(path), str(retired))
    for filename, data in contents.items():
        (destination / filename).write_bytes(data)
    state_path.parent.mkdir(exist_ok=True)
    state_path.write_text(json.dumps({'fingerprint': fingerprint(root), 'files': {
        name: hashlib.sha256(data).hexdigest() for name, data in contents.items()}}, indent=2) + '\n')
    return names


if __name__ == '__main__':
    print('Installed local Forge scripts: ' + ', '.join(prepare()))
