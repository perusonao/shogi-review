"""Audit the 90-game boundary using existing KIFs in isolated temporary roots."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from import_new_games import discover, install_results, Candidate
from kif_to_game import parse
from queue_common import canonical_fingerprint


class CatalogBoundaryTests(unittest.TestCase):
    def test_all_saved_kifs_have_distinct_fingerprints(self):
        fingerprints = [canonical_fingerprint(parse(p, p.stem, 'sonao81')) for p in (ROOT / 'games').glob('*.kif')]
        self.assertEqual(len(fingerprints), len(set(fingerprints)))

    def test_discovery_at_90_does_not_skip_unseen_game_or_repeat_it(self):
        # Existing real KIF is unseen in this isolated catalog; no production KIF is invented.
        source = ROOT / 'games/20260919_hryopiyo.kif'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'games/inbox').mkdir(parents=True)
            (root / 'analysis').mkdir()
            shutil.copy2(source, root / 'games/inbox/new.kif')
            catalog_ids = {f'fixture-{i}' for i in range(90)}
            candidates, duplicates = discover(root, 'sonao81', catalog_ids)
            self.assertEqual(len(candidates), 1)
            self.assertEqual(duplicates, [])
            candidate = candidates[0]
            shutil.copy2(source, root / f'games/{candidate.game_id}.kif')
            (root / f'games/{candidate.game_id}.json').write_text('{}')
            (root / f'analysis/{candidate.game_id}.json').write_text('{}')
            candidates, duplicates = discover(root, 'sonao81', catalog_ids | {candidate.game_id})
            self.assertEqual(candidates, [])
            self.assertEqual(len(duplicates), 1)

    def test_install_preserves_90_entries_and_adds_91st(self):
        catalog = json.loads((ROOT / 'games/index.json').read_text(encoding='utf8'))
        previous = list(catalog['games'])
        source_id = '20260919_hryopiyo'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'target'
            output = Path(directory) / 'output'
            (root / 'games').mkdir(parents=True)
            for category in ['games', 'analysis', 'analysis/metrics']:
                (output / category).mkdir(parents=True, exist_ok=True)
                value = json.loads((ROOT / category / f'{source_id}.json').read_text(encoding='utf8'))
                if category == 'games':
                    value['game']['id'] = 'fixture-only-91'
                (output / category / 'fixture-only-91.json').write_text(json.dumps(value), encoding='utf8')
            source = ROOT / 'games' / f'{source_id}.kif'
            parsed = parse(source, 'fixture-only-91', 'sonao81')
            candidate = Candidate(source, 'fixture-only-91', parsed, canonical_fingerprint(parsed))
            install_results(root, output, [candidate], catalog)
            updated = json.loads((root / 'games/index.json').read_text(encoding='utf8'))['games']
            self.assertEqual(len(updated), len(previous) + 1)
            self.assertEqual(updated[1:], previous)
            self.assertEqual(updated[0]['id'], 'fixture-only-91')

if __name__ == '__main__':
    unittest.main()
