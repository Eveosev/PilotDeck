"""n3: fractional --model-ms must survive into the mock delay."""
from __future__ import annotations

import unittest

from mock_backend import configured_model_delay_ms


class ModelDelayTests(unittest.TestCase):
    def test_fractional_model_ms_is_not_truncated(self) -> None:
        self.assertEqual(configured_model_delay_ms({"modelMs": 200.5}), 200.5)
        self.assertNotEqual(configured_model_delay_ms({"modelMs": 200.5}), 200)
        self.assertEqual(configured_model_delay_ms({"modelMs": 200}), 200.0)
        self.assertEqual(configured_model_delay_ms({"modelMs": 0}), 0.0)
        self.assertEqual(configured_model_delay_ms({}), 0.0)
        self.assertEqual(configured_model_delay_ms(None), 0.0)


if __name__ == "__main__":
    unittest.main()
