import importlib.util
import pathlib
import unittest

root = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('audit', root / 'audit.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class DeckStructureTests(unittest.TestCase):
    def test_full_deck_without_project_artifacts(self):
        cards = [
            {'name': 'Leader', 'board': 'commander', 'quantity': 1},
            {'name': 'Land', 'board': 'main', 'quantity': 37},
            {'name': 'Spell', 'board': 'main', 'quantity': 61},
            {'name': 'Modal', 'board': 'main', 'quantity': 1},
            {'name': 'Spell', 'board': 'side', 'quantity': 5},
        ]
        facts = []
        annotations = {'deck_id': 'fixture', 'cards': {}}
        for name, type_line in [('Leader', 'Creature'), ('Land', 'Land'), ('Spell', 'Sorcery'), ('Modal', 'Creature')]:
            card = {'name': name, 'oracle_id': name, 'type_line': type_line, 'layout': 'normal', 'cmc': 2}
            if name == 'Modal':
                card.update(layout='modal_dfc', card_faces=[{'type_line': 'Creature'}, {'type_line': 'Land'}])
            facts.append({'card': card, 'retrieved_at': 'fixture', 'source_url': 'fixture'})
            annotations['cards'][name] = {'oracle_id': name, 'reason': 'Synthetic fixture', 'roles': [{'role': 'fixture', 'access': 'standalone', 'mana': 2}]}
        annotations['land_sources'] = {name: {'direct_color': 'U', 'access': 'untapped', 'note': 'Synthetic source'} for name in ['Land', 'Modal']}
        result = audit.audit({'id': 'fixture', 'name': 'Fixture', 'cards': cards}, annotations, facts)
        self.assertEqual((result['playing_slots'], result['library_slots']), (100, 99))
        self.assertEqual((result['front_lands'], result['land_mdfcs']), (37, 1))
        self.assertEqual(result['annotated_rows'], 4)
        self.assertEqual(result['land_source_slot_counts']['U / untapped'], 38)

    def test_invalid_signed_proxy_quantity_is_not_hidden(self):
        with self.assertRaises(ValueError):
            audit.audit({'id': 'fixture', 'cards': [{'name': 'Spell', 'board': 'main', 'quantity': 1, 'proxies': -1}]}, {'deck_id': 'fixture', 'cards': {}}, [])


if __name__ == '__main__':
    unittest.main()
