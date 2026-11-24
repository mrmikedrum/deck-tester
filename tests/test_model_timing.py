"""Observe retries separately from successful requests; no real provider calls."""
import socket
import unittest
from unittest.mock import patch, MagicMock
from deckmaster import model

class ModelTimingTest(unittest.TestCase):
    def test_retry_timeout_is_not_hidden_by_success(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"answers": {"pick": {"choice": "pass"}}}'
        usage = model.Usage()
        with patch.object(model, 'key', return_value='not-a-real-key'), patch.object(model, 'provider', return_value=model.PROVIDERS[0]), patch.object(model.urllib.request, 'urlopen', side_effect=[socket.timeout('timed out'), response]), patch.object(model.time, 'sleep'):
            answer = model.call('state', {}, usage, retries=1)
            summary = usage.summary()
        self.assertEqual(answer['pick']['choice'], 'pass')
        self.assertEqual(summary['calls'], 1)
        self.assertEqual(summary['api_retries'], 1)
        self.assertEqual(summary['api_timeouts'], 1)
        self.assertGreaterEqual(summary['api_wall_seconds'], 0)

    def test_exhausted_timeout_is_counted_without_a_retry(self):
        usage = model.Usage()
        with patch.object(model, 'key', return_value='not-a-real-key'), patch.object(model, 'provider', return_value=model.PROVIDERS[0]), patch.object(model.urllib.request, 'urlopen', side_effect=socket.timeout('timed out')):
            with self.assertRaises(model.ModelError):
                model.call('state', {}, usage, retries=0)
        self.assertEqual(usage.api_timeouts, 1)
        self.assertEqual(usage.api_retries, 0)
